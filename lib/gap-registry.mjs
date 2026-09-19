/**
 * Gap Registry parsing and validation for execution-critique reports.
 * Pure functions — no I/O, no model judgment. The upstream skill
 * (stelow-workflow-execution-critique, criteria 7-9) requires the report
 * to start with YAML frontmatter carrying a structured `gaps:` list;
 * the narrative table alone is not machine-checkable, so a worker can
 * misclassify a high-impact gap as DOCUMENTED and close the loop
 * silently. These functions make misclassification a deterministic
 * verify/done failure with expected-vs-found lines.
 *
 * Unknown shapes never block: a report without frontmatter fails only
 * when it is a matched Execution Critique Report (the skill teaches
 * frontmatter, code enforces it) — never for unrecognized documents.
 */

const IMPACTS = new Set(["low", "medium", "high", "critical"]);
const RESOLUTIONS = new Set(["fixed", "documented", "escalate", "escalated"]);

function normalizeResolution(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "escalated") return "escalate";
  return normalized;
}

function stripQuotes(value) {
  const trimmed = String(value ?? "").trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Frontmatter block (between leading --- fences), or null. */
export function frontmatterBlock(text) {
  const lines = String(text ?? "").split("\n");
  if (lines.length < 2 || lines[0].trim() !== "---") return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---" || lines[i].trim() === "...") {
      return lines.slice(1, i).join("\n");
    }
  }
  return null;
}

/**
 * Minimal parse of the `gaps:` list inside frontmatter. Only the known
 * scalar keys are read (type/area/description/impact/resolution);
 * anything else is ignored so skill-side extensions never break us.
 */
export function parseGapFrontmatter(text) {
  const block = frontmatterBlock(text);
  if (block === null) return { found: false, gaps: [] };
  const lines = block.split("\n");
  let gapsIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*gaps\s*:\s*(\[|\{|#|$)/.test(lines[i]) || /^\s*gaps\s*:\s*$/.test(lines[i])) {
      gapsIndent = lines[i].search(/\S/);
      break;
    }
    if (/^gaps\s*:\s*\[\s*\]\s*$/.test(lines[i].trim())) return { found: true, gaps: [] };
  }
  if (gapsIndent < 0) return { found: false, gaps: [] };
  const gaps = [];
  let current = null;
  const flush = () => {
    if (current) gaps.push(current);
    current = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line) && !/^\s*gaps\s*:/.test(line)) break;
    const itemMatch = line.match(/^(\s*)-\s+(.*)$/);
    const itemIndent = itemMatch ? itemMatch[1].length : -1;
    if (itemMatch && itemIndent === gapsIndent + 2) {
      flush();
      current = { index: gaps.length + 1, type: null, area: null, description: null, impact: null, resolution: null };
      const rest = itemMatch[2].trim();
      if (rest && !rest.startsWith("#")) {
        const field = rest.match(/^([A-Za-z_]+)\s*:\s*(.*)$/);
        if (field) current[field[1]] = stripQuotes(field[2]);
      }
      continue;
    }
    if (current) {
      const field = line.match(/^\s+([A-Za-z_]+)\s*:\s*(.*)$/);
      if (field && line.search(/\S/) > gapsIndent + 2) current[field[1]] = stripQuotes(field[2]);
    }
  }
  flush();
  return { found: true, gaps };
}

/** Gaps with an escalate resolution (the rework loop input). */
export function escalatedGaps(text) {
  return parseGapFrontmatter(text).gaps.filter((gap) => normalizeResolution(gap.resolution) === "escalate");
}

/** Counts for UI/metrics. found:false means no parseable registry. */
export function summarizeGaps(text) {
  const parsed = parseGapFrontmatter(text);
  const summary = { found: parsed.found, total: 0, fixed: 0, documented: 0, escalated: 0 };
  for (const gap of parsed.gaps) {
    summary.total++;
    const resolution = normalizeResolution(gap.resolution);
    if (resolution === "fixed") summary.fixed++;
    else if (resolution === "documented") summary.documented++;
    else if (resolution === "escalate") summary.escalated++;
  }
  return summary;
}

/**
 * Deterministic Gap Registry failures. Empty registry passes (a clean
 * audit has no gaps); every listed row must carry a known impact and
 * resolution, and high/critical impact must escalate — anything else
 * is a misclassification, not a judgment call.
 */
export function validateGapRegistry(text) {
  const failures = [];
  const parsed = parseGapFrontmatter(text);
  if (!parsed.found) {
    return [{ code: "gap-missing-frontmatter", expected: "gaps: frontmatter registry", found: "no frontmatter gaps list", detail: "execution critique needs a `gaps:` frontmatter registry (impact + resolution per gap) — write it, then run verify again" }];
  }
  for (const gap of parsed.gaps) {
    const label = `gap #${gap.index}${gap.description ? ` (${String(gap.description).slice(0, 60)})` : ""}`;
    const impact = String(gap.impact ?? "").trim().toLowerCase();
    const resolution = normalizeResolution(gap.resolution);
    if (!IMPACTS.has(impact) || !RESOLUTIONS.has(resolution)) {
      failures.push({
        code: "gap-incomplete-row",
        expected: `${label}: impact low|medium|high|critical, resolution fixed|documented|escalate`,
        found: `${label}: impact ${gap.impact ?? "missing"}, resolution ${gap.resolution ?? "missing"}`,
        detail: `${label} needs impact and resolution — found impact ${gap.impact ?? "missing"}, resolution ${gap.resolution ?? "missing"}`,
      });
      continue;
    }
    if ((impact === "high" || impact === "critical") && resolution !== "escalate") {
      failures.push({
        code: "gap-misclassified",
        expected: `${label}: ${impact} impact resolves as escalate`,
        found: `${label}: resolved as ${resolution}`,
        detail: `${label} has ${impact} impact but resolves as ${resolution} — high/critical gaps become new scopes (escalate), never inline fixes or notes`,
      });
    }
  }
  return failures;
}

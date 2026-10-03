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
const EFFORTS = new Set(["trivial", "moderate", "significant"]);
const REVERSIBLES = new Set(["yes", "no", "unknown"]);

function normalizeResolution(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "escalated") return "escalate";
  return normalized;
}

/** The same normalisation, for callers that compare a resolution rather than
 * count it. The registry is written by a worker, so "escalated" and "escalate"
 * are the same verdict spelled two ways, and anything comparing resolutions
 * must fold them the same way this does. */
export function gapResolution(value) {
  return normalizeResolution(value);
}

function stripQuotes(value) {
  const trimmed = String(value ?? "").trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** A string or flow-style `[a, b]` list as an array of names. Anything else
 * reads empty — the caller decides whether emptiness is an error. */
function evidenceNames(value) {
  if (value === undefined || value === null) return [];
  const text = String(value).trim();
  if (text === "" || text === "[]") return [];
  const inner = text.startsWith("[") ? text.replace(/^\[/, "").replace(/\]$/, "") : text;
  return inner.split(",").map((part) => stripQuotes(part.trim())).filter(Boolean);
}

function evidenceCallers(value) {
  if (value === undefined || value === null || String(value).trim() === "") return { callers: null, error: null };
  if (/^\d+$/.test(String(value).trim())) return { callers: parseInt(String(value).trim(), 10), error: null };
  return { callers: null, error: `callers must be a non-negative integer — found ${value}` };
}

/**
 * Normalise a raw `evidence:` mapping. Absent keys read null/empty (the gap
 * is unmeasured, not malformed); wrong types fail, so the format is taught
 * rather than guessed. Unknown keys are ignored for forward compatibility.
 */
export function normalizeGapEvidence(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  if (!source) return { evidence: null, error: "evidence must be a mapping of symbols/files/callers/tests/reversible/check, not a scalar" };
  const { callers, error: callersError } = evidenceCallers(source.callers);
  if (callersError) return { evidence: null, error: callersError };
  const reversibleRaw = source.reversible === undefined || source.reversible === null || String(source.reversible).trim() === ""
    ? null
    : String(source.reversible).trim().toLowerCase();
  if (reversibleRaw && !REVERSIBLES.has(reversibleRaw)) {
    return { evidence: null, error: `reversible must be yes, no, or unknown — found ${source.reversible}` };
  }
  const checkRaw = source.check === undefined || source.check === null || String(source.check).trim() === "" ? null : String(source.check).trim();
  return {
    evidence: {
      symbols: evidenceNames(source.symbols),
      files: evidenceNames(source.files),
      callers,
      tests: evidenceNames(source.tests),
      reversible: reversibleRaw,
      check: checkRaw === "null" ? null : checkRaw,
    },
    error: null,
  };
}

/** Strict calendar dates for debt expiry: `YYYY-MM-DD` that exists on the
 * calendar (month 13 and February 30 fail). Lexicographic comparison works
 * because the format is zero-padded — `expires < today` is a string compare. */
export function parseGapDate(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { date: null, error: `expires must be YYYY-MM-DD — found ${value}` };
  const [year, month, day] = text.split("-").map(Number);
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  if (roundTrip.getUTCFullYear() !== year || roundTrip.getUTCMonth() !== month - 1 || roundTrip.getUTCDate() !== day) {
    return { date: null, error: `expires must be a real calendar date — found ${value}` };
  }
  return { date: text, error: null };
}

/** True only for a valid past date: malformed and absent read false, never
 * throw — the format failure is reported by validation, not smuggled into
 * the expiry verdict. Compares dates, not instants: debt due today is due,
 * not overdue. */
export function isDebtExpired(expires, nowMs) {
  const { date } = parseGapDate(expires);
  if (!date) return false;
  const today = new Date(nowMs).toISOString().slice(0, 10);
  return date < today;
}

/**
 * Documented debt past its date. Only `documented` rows qualify: expiry is
 * debt metadata, and an escalation or inline fix is worked or scoped, never
 * aging. Returns the rows a gate must refuse on, with owner attached so the
 * refusal can name who re-dates rather than just what expired.
 */
export function expiredDebts(rows, nowMs) {
  const list = Array.isArray(rows) ? rows : [];
  const expired = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    if (normalizeResolution(row.resolution) !== "documented") continue;
    const expires = String(row.expires ?? "").trim();
    if (!isDebtExpired(expires, nowMs)) continue;
    const description = String(row.description ?? "").trim();
    if (!description) continue;
    expired.push({ description, expires, owner: String(row.owner ?? "").trim() || null });
  }
  return expired;
}
/** A gap cites measurements only when at least one evidence field is set:
 * an empty block is present-but-vacuous, which counts as unmeasured. */
export function hasGapEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") return false;
  return (Array.isArray(evidence.symbols) && evidence.symbols.length > 0)
    || (Array.isArray(evidence.files) && evidence.files.length > 0)
    || (typeof evidence.callers === "number")
    || (Array.isArray(evidence.tests) && evidence.tests.length > 0)
    || (typeof evidence.reversible === "string")
    || (typeof evidence.check === "string");
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
 *
 * One nested block is understood: `evidence:` (symbols/files/callers/
 * tests/reversible/check). It is collected as raw strings and normalised
 * on close, so a gap without it parses byte-identically to before.
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
  const cursor = { current: null, evidenceRaw: null, evidenceIndent: -1, gapsIndent };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line) && !/^\s*gaps\s*:/.test(line)) break;
    const itemMatch = line.match(/^(\s*)-\s+(.*)$/);
    const itemIndent = itemMatch ? itemMatch[1].length : -1;
    if (itemMatch && itemIndent === gapsIndent + 2) {
      flushGapRow(cursor, gaps);
      cursor.current = { index: gaps.length + 1, type: null, area: null, description: null, impact: null, effort: null, resolution: null };
      const rest = itemMatch[2].trim();
      if (rest && !rest.startsWith("#")) {
        const field = rest.match(/^([A-Za-z_]+)\s*:\s*(.*)$/);
        if (field) cursor.current[field[1]] = stripQuotes(field[2]);
      }
      continue;
    }
    if (cursor.current) readGapField(cursor, line);
  }
  flushGapRow(cursor, gaps);
  return { found: true, gaps };
}

/** One `key: value` line inside a gap row. A dedented field ends an open
 * `evidence:` block first, so `resolution:` after `evidence:` is a gap key,
 * not a measurement. */
function readGapField(cursor, line) {
  const field = line.match(/^\s+([A-Za-z_]+)\s*:\s*(.*)$/);
  const indent = line.search(/\S/);
  if (!field || indent <= cursor.gapsIndent + 2) return;
  if (cursor.evidenceRaw && indent <= cursor.evidenceIndent) closeEvidenceIn(cursor);
  if (cursor.evidenceRaw) cursor.evidenceRaw[field[1]] = stripQuotes(field[2]);
  else if (field[1] === "evidence" && field[2].trim() === "") {
    cursor.evidenceRaw = {};
    cursor.evidenceIndent = indent;
  } else if (field[1] === "evidence") {
    cursor.current.evidenceError = "evidence must be a mapping of symbols/files/callers/tests/reversible/check, not a scalar";
  } else cursor.current[field[1]] = stripQuotes(field[2]);
}

function closeEvidenceIn(cursor) {
  if (cursor.current && cursor.evidenceRaw) {
    const { evidence, error } = normalizeGapEvidence(cursor.evidenceRaw);
    cursor.current.evidence = evidence;
    cursor.current.evidenceError = error;
  }
  cursor.evidenceRaw = null;
  cursor.evidenceIndent = -1;
}

function flushGapRow(cursor, gaps) {
  closeEvidenceIn(cursor);
  if (cursor.current) gaps.push(cursor.current);
  cursor.current = null;
}

/** Gaps with an escalate resolution (the rework loop input). */
export function escalatedGaps(text) {
  return parseGapFrontmatter(text).gaps.filter((gap) => normalizeResolution(gap.resolution) === "escalate");
}

/**
 * Every registry row, with its disposition — THE list, and the only counting
 * the card does.
 *
 * `summarizeGaps` used to count parsed rows on its own, which meant the header
 * tally and this list were two accountings of the same YAML: a placeholder row
 * (no description) counted in `total` but listed nowhere, a duplicated finding
 * counted twice and listed once, and the same finding re-audited in a second
 * critique round counted twice again. Every one of those is "N gaps" above a
 * shorter list — the exact symptom this module was split out to fix, in a new
 * place. The counts are now derived FROM this list, so they cannot disagree.
 *
 * Rows without a description are placeholders, not findings, and are dropped.
 * A duplicated description is one finding: the registry is a list of findings,
 * not a log of how many times each was typed.
 */
export function registryGaps(text) {
  const seen = new Set();
  const rows = [];
  for (const gap of parseGapFrontmatter(text).gaps) {
    const description = String(gap.description ?? "").trim();
    if (!description || seen.has(description)) continue;
    seen.add(description);
    rows.push({ description, resolution: normalizeResolution(gap.resolution) });
  }
  return rows;
}

/**
 * Counts for UI/metrics, derived from `registryGaps` so the tally and the list
 * are one accounting. `found:false` means no parseable registry, which is
 * different from a parseable registry with no findings.
 */
export function summarizeGaps(text) {
  const parsed = parseGapFrontmatter(text);
  const summary = { found: parsed.found, total: 0, fixed: 0, documented: 0, escalated: 0 };
  for (const gap of registryGaps(text)) {
    summary.total++;
    if (gap.resolution === "fixed") summary.fixed++;
    else if (gap.resolution === "documented") summary.documented++;
    else if (gap.resolution === "escalate") summary.escalated++;
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
  for (const gap of parsed.gaps) failures.push(...validateGapRow(gap));
  return failures;
}

/** One registry row's failures. Impact and resolution are the load-bearing
 * contract (a misclassified high-impact gap closes the loop silently);
 * effort and evidence are secondary dimensions with the same shape. */
function validateGapRow(gap) {
  const failures = [];
  const label = rowLabel(gap);
  const impact = String(gap.impact ?? "").trim().toLowerCase();
  const resolution = normalizeResolution(gap.resolution);
  const effortRaw = String(gap.effort ?? "").trim().toLowerCase();
  if (!IMPACTS.has(impact) || !RESOLUTIONS.has(resolution)) {
    failures.push({
      code: "gap-incomplete-row",
      expected: `${label}: impact low|medium|high|critical, resolution fixed|documented|escalate`,
      found: `${label}: impact ${gap.impact ?? "missing"}, resolution ${gap.resolution ?? "missing"}`,
      detail: `${label} needs impact and resolution — found impact ${gap.impact ?? "missing"}, resolution ${gap.resolution ?? "missing"}`,
    });
    return failures;
  }
  // Effort is fail-open when absent (legacy registries predate it) but
  // checked when present: a present-but-unknown value fails, and a
  // medium-plus-moderate effort resolved as an inline fix fails — that
  // is under-disposition, the direction that loses work. Over-disposition
  // (trivial work escalated) stays allowed: cheap, visible, never silent.
  if (effortRaw && !EFFORTS.has(effortRaw)) {
    failures.push({
      code: "gap-incomplete-row",
      expected: `${label}: effort trivial|moderate|significant`,
      found: `${label}: effort ${gap.effort}`,
      detail: `${label} needs effort trivial, moderate, or significant — found ${gap.effort}`,
    });
    return failures;
  }
  if ((impact === "high" || impact === "critical") && resolution !== "escalate") {
    failures.push({
      code: "gap-misclassified",
      expected: `${label}: ${impact} impact resolves as escalate`,
      found: `${label}: resolved as ${resolution}`,
      detail: `${label} has ${impact} impact but resolves as ${resolution} — high/critical gaps become new scopes (escalate), never inline fixes or notes`,
    });
  }
  if (impact === "medium" && (effortRaw === "moderate" || effortRaw === "significant") && resolution === "fixed") {
    failures.push({
      code: "gap-underfixed",
      expected: `${label}: medium impact with ${effortRaw} effort resolves as documented or escalate`,
      found: `${label}: resolved as fixed`,
      detail: `${label} needs more than an inline fix (medium impact, ${effortRaw} effort) — resolve as documented or escalate`,
    });
  }
  for (const failure of [validateGapEvidence(gap, label), validateDebtExpiry(gap, label)]) {
    if (failure) failures.push(failure);
  }
  return failures;
}

/** `gap #3 (Login rate limiter)` — the handle every failure names, so a
 * reader can find the row without counting fences. */
function rowLabel(gap) {
  const name = gap.description ? ` (${String(gap.description).slice(0, 60)})` : "";
  return `gap #${gap.index}${name}`;
}

/** Debt-expiry format: checked whenever present, on any resolution (cheap
 * teaching), enforced only for documented rows downstream. Reported
 * alongside the other dimensions — downstream compares strings, so a
 * malformed date must never pass silently. */
function validateDebtExpiry(gap, label) {
  const raw = String(gap.expires ?? "").trim();
  if (raw === "") return null;
  const { error } = parseGapDate(raw);
  if (!error) return null;
  return {
    code: "gap-incomplete-row",
    expected: `${label}: expires YYYY-MM-DD on documented debt`,
    found: `${label}: expires ${gap.expires}`,
    detail: `${label} sets debt expiry that does not parse — ${error}`,
  };
}

/** The evidence dimension: fail-open when absent (registries written before
 * it existed, and workers on hosts without measurement tools, never fail
 * for not citing it) but fail-closed when present, so the format is taught
 * rather than guessed. */
function validateGapEvidence(gap, label) {
  if (!gap.evidenceError) return null;
  return {
    code: "gap-evidence-shape",
    expected: `${label}: evidence mapping with symbols/files/callers/tests/reversible/check`,
    found: `${label}: ${gap.evidenceError}`,
    detail: `${label} cites evidence that does not parse — ${gap.evidenceError}`,
  };
}


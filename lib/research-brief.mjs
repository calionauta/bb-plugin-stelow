/**
 * Deterministic parsing for the research brief convention.
 *
 * A research worker writes brief.md in this shape:
 *
 *   ## Opportunities
 *   ### <Strategy label> — <date>
 *   - [ ] <opportunity> — <one-line why>
 *
 * Checked boxes mean "selected for fan-out". The parser is strict about the
 * section bounds and the checkbox shape so the fan-out dialog never invents
 * opportunities; a brief that ignores the convention parses as not-found
 * with a named exit instead of garbage.
 */

function slugTitle(title, index) {
  const slug = String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "opportunity";
  return `${slug}-${index + 1}`;
}

const HEADING2 = /^##\s+(.+?)\s*$/;
const HEADING3 = /^###\s+(.+?)\s*$/;
const CHECKBOX = /^\s*[-*]\s+\[( |x|X)\]\s+(.+?)\s*$/;

export function parseResearchBrief(markdown) {
  const lines = String(markdown ?? "").split("\n");
  const start = lines.findIndex((line) => {
    const match = line.match(HEADING2);
    return match !== null && match[1].trim().toLowerCase() === "opportunities";
  });
  if (start < 0) return { found: false, opportunities: [] };
  let group = null;
  const opportunities = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    // Any new h2 section ends the Opportunities block.
    if (HEADING2.test(line)) break;
    const sub = line.match(HEADING3);
    if (sub) {
      group = sub[1].trim() || null;
      continue;
    }
    const item = line.match(CHECKBOX);
    if (!item) continue;
    const title = item[2].trim();
    if (!title) continue;
    opportunities.push({
      id: slugTitle(title, opportunities.length),
      title,
      checked: item[1].toLowerCase() === "x",
      group,
      lineIndex: i,
    });
  }
  return { found: true, opportunities };
}

/**
 * Flip the given opportunity ids to checked. Matches only the exact lines
 * the parser produced and only when they are still unchecked — a worker
 * edit in between never gets clobbered into a false positive.
 */
export function checkBriefItems(markdown, ids) {
  const wanted = new Set(Array.isArray(ids) ? ids : []);
  if (wanted.size === 0) return { updated: String(markdown ?? ""), checked: [] };
  const { opportunities } = parseResearchBrief(markdown);
  const lines = String(markdown ?? "").split("\n");
  const checked = [];
  for (const item of opportunities) {
    if (!wanted.has(item.id) || item.checked) continue;
    const line = lines[item.lineIndex];
    const match = typeof line === "string" ? line.match(/^(\s*[-*]\s+\[)( \])/) : null;
    if (!match) continue;
    lines[item.lineIndex] = `${match[1]}x]${line.slice(match[0].length)}`;
    checked.push(item.id);
  }
  return { updated: lines.join("\n"), checked };
}

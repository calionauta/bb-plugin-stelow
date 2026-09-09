/**
 * Section parsing for the research index convention, complementary to
 * research-index.mjs (which owns the ## Opportunities contract).
 *
 * A research worker writes research-index.md in this shape (headings verbatim):
 *
 *   ## Summary
 *   <concise synthesis>
 *
 *   ## Outputs
 *   | Strategy | Round | Output | Path | Notes |
 *   | --- | --- | --- | --- | --- |
 *   | ... |
 *
 *   ## Opportunities
 *   ### <Strategy label> — <date>
 *   - [ ] <opportunity> — <one-line why>
 *
 * The card detail renders the Summary as prose and the Outputs table with its
 * Path column turned into clickable artifact buttons (same viewer as build
 * cards). The Opportunities section stays owned by parseResearchIndex, which
 * drives the interactive fan-out panel — so this parser never touches it.
 */

const HEADING2 = /^##\s+(.+?)\s*$/;
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|[\s:|-]+\|\s*$/;

function sectionStart(lines, name) {
  return lines.findIndex((line) => {
    const match = line.match(HEADING2);
    return match !== null && match[1].trim().toLowerCase() === name;
  });
}

function splitRow(line) {
  const inner = String(line).replace(/^\s*\|/, "").replace(/\|\s*$/, "").trim();
  return inner.split("|").map((cell) => cell.trim());
}

function parseOutputsTable(lines) {
  const headerIdx = lines.findIndex((line) => TABLE_ROW.test(line));
  if (headerIdx < 0) return [];
  if (!TABLE_SEPARATOR.test(lines[headerIdx + 1] ?? "")) return [];
  const header = splitRow(lines[headerIdx]).map((cell) => cell.toLowerCase());
  const column = (name) => header.indexOf(name);
  const strategy = column("strategy");
  const round = column("round");
  const output = column("output");
  const path = column("path");
  const notes = column("notes");
  const rows = [];
  for (let i = headerIdx + 2; i < lines.length; i++) {
    if (!TABLE_ROW.test(lines[i])) break; // table ends at the first non-row line
    const cells = splitRow(lines[i]);
    const p = path >= 0 ? cells[path] ?? "" : "";
    if (!p) continue;
    rows.push({
      strategy: strategy >= 0 ? cells[strategy] ?? "" : "",
      round: round >= 0 ? cells[round] ?? "" : "",
      output: output >= 0 ? cells[output] ?? "" : "",
      path: p,
      notes: notes >= 0 ? cells[notes] ?? "" : "",
    });
  }
  return rows;
}

/**
 * Split the index into its Summary prose and Outputs table rows. Either may
 * be absent (summary: null when no ## Summary heading; outputs: [] when no
 * table). The ## Opportunities section is deliberately not returned — the
 * interactive panel parses it separately via parseResearchIndex.
 */
export function parseResearchIndexSections(markdown) {
  const lines = String(markdown ?? "").split("\n");
  const summaryStart = sectionStart(lines, "summary");
  const outputsStart = sectionStart(lines, "outputs");
  const opportunitiesStart = sectionStart(lines, "opportunities");
  const summary = summaryStart >= 0
    ? lines.slice(summaryStart + 1, outputsStart >= 0 ? outputsStart : opportunitiesStart >= 0 ? opportunitiesStart : undefined).join("\n").trim()
    : null;
  const outputs = outputsStart >= 0
    ? parseOutputsTable(lines.slice(outputsStart + 1, opportunitiesStart >= 0 ? opportunitiesStart : undefined))
    : [];
  return { summary, outputs };
}

/**
 * Return the index markdown with the ## Opportunities section removed. Used
 * as a safe fallback when the index ignores the Summary/Outputs contract:
 * the raw body still renders, but never duplicates the interactive fan-out
 * panel (which is the only surface that may show opportunities).
 */
export function stripResearchOpportunities(markdown) {
  const lines = String(markdown ?? "").split("\n");
  const start = sectionStart(lines, "opportunities");
  if (start < 0) return String(markdown ?? "");
  return lines.slice(0, start).join("\n").trim();
}
/**
 * Match extraction for `ast-grep run --json`. Pure: parsed JSON in, compact
 * rows out. Null when the input is not an array or yields zero valid rows.
 * Never throws. Caps at `max` rows; extras are dropped.
 *
 * Expected shape: [{ file, range: { start: { line }, end: { line } },
 *   text, ... }]
 */

function lineOf(range, key) {
  if (!range || typeof range !== "object" || Array.isArray(range)) return null;
  const point = range[key];
  if (!point || typeof point !== "object" || Array.isArray(point)) return null;
  if (typeof point.line !== "number" || !Number.isFinite(point.line)) return null;
  return Math.floor(point.line);
}

/**
 * @param {unknown} json parsed `ast-grep run --json` output
 * @param {number} [max] row cap, defaults to 50
 * @returns {Array<{ file: string; startLine: number | null; endLine: number | null; text: string }> | null}
 */
export function summarizeAstGrepMatches(json, max = 50) {
  if (!Array.isArray(json)) return null;
  const limit = typeof max === "number" && Number.isFinite(max) && max > 0 ? Math.floor(max) : 50;
  const out = [];
  for (const row of json) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    if (typeof row.file !== "string" || !row.file) continue;
    const range = row.range && typeof row.range === "object" && !Array.isArray(row.range) ? row.range : null;
    out.push({
      file: row.file,
      startLine: lineOf(range, "start"),
      endLine: lineOf(range, "end"),
      text: typeof row.text === "string" ? row.text.slice(0, 500) : "",
    });
    if (out.length >= limit) break;
  }
  return out.length > 0 ? out : null;
}

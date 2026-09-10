/**
 * Changed-symbol extraction for `cymbal changed --base HEAD --json`. Pure:
 * parsed JSON in, compact per-symbol rows out. Anything off-shape yields
 * null — the Diff section simply renders no symbol list. Never throws.
 * Caps at MAX_SYMBOLS rows; extra symbols collapse into truncated=true.
 *
 * Expected shape (cymbal 0.14):
 *   { results: { results: [{ symbol, files[], impact: { total_callers,
 *     test_callers } }], truncated } }
 */

export const MAX_SYMBOLS = 20;

function num(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/**
 * @param {unknown} json parsed `cymbal changed --json` output
 * @returns {Array<{ symbol: string; files: string[]; callers: number;
 *   testCallers: number }> | null} null when empty or off-shape
 */
export function summarizeCymbalChanged(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const results = json.results;
  if (!results || typeof results !== "object" || Array.isArray(results)) return null;
  const rows = Array.isArray(results.results) ? results.results : [];
  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    if (typeof row.symbol !== "string" || !row.symbol) continue;
    const impact = row.impact && typeof row.impact === "object" && !Array.isArray(row.impact) ? row.impact : {};
    out.push({
      symbol: row.symbol,
      files: Array.isArray(row.files) ? row.files.filter((f) => typeof f === "string").slice(0, 5) : [],
      callers: num(impact.total_callers),
      testCallers: num(impact.test_callers),
    });
    if (out.length >= MAX_SYMBOLS) break;
  }
  return out.length > 0 ? out : null;
}

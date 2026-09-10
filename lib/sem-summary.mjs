/**
 * Entity-summary extraction for `sem diff --format json`. Pure: parsed JSON
 * in, compact summary out. Anything off-shape yields null — the Diff section
 * simply renders no summary line. Never throws.
 *
 * Expected shape (sem 0.20–0.24):
 *   { summary: { fileCount, added, modified, deleted, moved, renamed,
 *                reordered, binary, orphan, total },
 *     changes: [{ changeType, structuralChange, ... }], binaryChanges: [] }
 */

function num(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/**
 * @param {unknown} json parsed `sem diff --format json` output
 * @returns {{ total: number; fileCount: number; added: number; modified: number;
 *   deleted: number; renamed: number; moved: number; cosmeticOnly: boolean } | null}
 */
export function summarizeSemDiff(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const summary = json.summary;
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
  const total = num(summary.total);
  if (total === 0) return null;
  const changes = Array.isArray(json.changes) ? json.changes : [];
  const structural = changes.filter((c) => c && typeof c === "object" && c.structuralChange !== false);
  return {
    total,
    fileCount: num(summary.fileCount),
    added: num(summary.added),
    modified: num(summary.modified),
    deleted: num(summary.deleted),
    renamed: num(summary.renamed),
    moved: num(summary.moved),
    cosmeticOnly: changes.length > 0 && structural.length === 0,
  };
}

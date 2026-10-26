// A "reviewed" mark is a claim about a VERSION of an artifact, not a checkbox.
//
// Plannotator's guided review keeps `reviewed: boolean[]`, one flag per
// section. Copied literally that is a progress counter which refuses nothing
// and cannot be wrong — a preference dressed as a rule. The version that earns
// its place binds the mark to the file's fingerprint: "this artifact, at the
// timestamp it had when I read it, was read". Staleness is then derivable,
// which is the only reason the mark can say anything the UI did not already
// know.
//
// The fingerprint is `generatedAt`, the timestamp the card already displays
// (`fileTimestamp` on the detail path; there is no sha in the card detail).
// Equality comparison only — no file reads, no hashing on a hot render path.
// Two accepted weaknesses, written down rather than hidden:
//   - a content change that preserves mtime reads as fresh;
//   - when the host read carries no mtime, `generatedAt` falls back to
//     `card.updated_at`, so an unrelated card edit can turn a mark stale.
// And one consequence of the server computing the fingerprint: the mark records
// the version at CLICK time, so a file rewritten between render and click is
// marked at the new version (the server refuses to trust the client's one).
//
// What regresses if this breaks: a mark made before the file changed reads as
// current, so a reviewer is told they have read a version they have not — the
// same lie the decision receipts exist to stop (`freshnessOf`).

/**
 * The line the Artifacts section summarizes.
 *
 * One owner for the sentence, called by `reviewState` and by a client that
 * derives the line from the rows it actually renders (research rounds can
 * outlive the artifact list they were indexed from, and a count of rows nobody
 * can see would never reach its total). Zero total renders nothing: an empty
 * card has no progress to report.
 *
 * @param {number} reviewedCount
 * @param {number} total
 * @param {number} staleCount
 */
export function reviewLine(reviewedCount, total, staleCount) {
  if (total <= 0) return null;
  return `${reviewedCount} of ${total} reviewed`
    + (staleCount > 0 ? ` · ${staleCount} reviewed before the file changed` : "");
}

/**
 * The review state of one card's artifacts, derived from the marks it carries.
 *
 * A mark for a path that is no longer in the list is IGNORED, never resurrected
 * into a row: the artifact is gone, and a count that includes it would inflate
 * "reviewed" with a file nobody can open. The same rule makes an old mark
 * harmless after an artifact is renamed away — it simply stops counting.
 *
 * @param {ReadonlyArray<{ path: string, generatedAt: string }> | null | undefined} artifacts
 * @param {ReadonlyMap<string, string> | null | undefined} marks
 *   path → the `generatedAt` recorded when the person marked it reviewed.
 * @returns {{
 *   rows: Array<{ path: string, reviewed: boolean, stale: boolean }>,
 *   reviewedCount: number,
 *   total: number,
 *   stale: string[],
 *   line: string | null,
 * }}
 */
export function reviewState(artifacts, marks) {
  const list = Array.isArray(artifacts)
    ? artifacts.filter(
      (artifact) =>
        artifact
        && typeof artifact.path === "string"
        && typeof artifact.generatedAt === "string",
    )
    : [];
  const recorded = marks instanceof Map ? marks : new Map();
  const rows = list.map((artifact) => {
    const fingerprint = recorded.get(artifact.path);
    const marked = typeof fingerprint === "string" && fingerprint.length > 0;
    return {
      path: artifact.path,
      reviewed: marked && fingerprint === artifact.generatedAt,
      stale: marked && fingerprint !== artifact.generatedAt,
    };
  });
  const reviewedCount = rows.filter((row) => row.reviewed).length;
  const stale = rows.filter((row) => row.stale).map((row) => row.path);
  const total = rows.length;
  return { rows, reviewedCount, total, stale, line: reviewLine(reviewedCount, total, stale.length) };
}

/**
 * Marks keyed by path for the rows that are in the card's own artifact list.
 *
 * A row absent from the map gets no toggle: a path the server would refuse is
 * not offered as an action (research rounds can outlive the artifact list they
 * were indexed from). Deriving the map from the server payload also keeps the
 * row and the summary line reading the same facts.
 *
 * @param {ReadonlyArray<{ path: string, reviewed?: boolean, stale?: boolean }> | null | undefined} artifacts
 * @returns {Map<string, { reviewed: boolean, stale: boolean }>}
 */
export function reviewMarksByPath(artifacts) {
  const marks = new Map();
  for (const artifact of Array.isArray(artifacts) ? artifacts : []) {
    if (
      artifact
      && typeof artifact.path === "string"
      && typeof artifact.reviewed === "boolean"
    ) {
      marks.set(artifact.path, {
        reviewed: artifact.reviewed,
        stale: artifact.stale === true,
      });
    }
  }
  return marks;
}

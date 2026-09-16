/**
 * Question staleness. A pending (or recoverable expired) question points at
 * documents through its option artifacts; the checkout may also have moved
 * since the ask. This module compares an ask-time snapshot against a fresh
 * observation with no I/O, so the verdict is unit-testable and the wording
 * stays factual: it reports what changed, never whether it matters.
 *
 * Writers snapshot at ask time (see the ask handler); readers observe at
 * cardDetail time. Rows are keyed by (card, artifact path), latest wins —
 * re-asking about a revised document re-baselines it.
 */

/**
 * @param snapshot ask-time baseline, or null when the question predates the
 * ledger (or carried no resolvable artifact): no baseline means no verdict.
 * @param observed fresh read: sha256 hex of the artifact (null when the file
 * can no longer be read), and the checkout HEAD (null when unknown/non-Git).
 */
export function stalenessOf(snapshot, observed) {
  if (!snapshot || typeof snapshot.artifactSha256 !== "string" || !snapshot.artifactSha256) return null;
  const docRemoved = !observed || typeof observed.sha256 !== "string" || !observed.sha256;
  if (docRemoved) return { docRevised: false, docRemoved: true, checkoutMoved: false };
  const docRevised = observed.sha256 !== snapshot.artifactSha256;
  const checkoutMoved =
    typeof snapshot.gitRoot === "string" &&
    !!snapshot.gitRoot &&
    typeof snapshot.headSha === "string" &&
    !!snapshot.headSha &&
    typeof observed.headSha === "string" &&
    !!observed.headSha &&
    observed.headSha !== snapshot.headSha;
  if (!docRevised && !checkoutMoved) return null;
  return { docRevised, docRemoved: false, checkoutMoved };
}

/** True when at least one per-question verdict names a change. */
export function anyStale(verdicts) {
  return Array.isArray(verdicts) && verdicts.some((verdict) => verdict !== null && typeof verdict === "object");
}

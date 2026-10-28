/**
 * What a card's activity MEANS right now, given how many questions are actually
 * open.
 *
 * The stored `activity` column is a projection, and `awaiting-answer` is the one
 * value in it that describes a fact outside the row: a question is live on the
 * worker thread. When that question is answered, expires, or disappears with the
 * thread that carried it, nothing rewrites the column — so the projection has to
 * be re-derived on every read, and the read has three states, not two.
 *
 * It used to have two. `openQuestions > 0 ? "awaiting-answer" : stored` treats
 * "the question source answered zero" and "we could not read the question
 * source" as the same input, so a card whose question vanished kept saying
 * `awaiting-answer` forever: the badge counted it, the inbox carried a row
 * nobody could answer, and the worker itself was told "the card won't take a
 * second question while one is pending". Three cards were sitting in exactly
 * that state (card_hce4tykn, card_qimjr9z4, card_g89gtmwt) when this was
 * written.
 *
 * So: an unreadable source propagates `null` and keeps the last verified
 * projection — refusing to guess is the honest answer. A successful read of zero
 * questions ENDS an await; a stored `idle` or `running` is a fact about the
 * worker that no question count contradicts. `error` and `held` outrank both,
 * because they are about the worker rather than about a question.
 */

const WORKER_STATES = new Set(["idle", "running", "awaiting-answer", "error", "held"]);

/** The activity to show. `openQuestions` is `null` when the read failed. */
export function effectiveActivity(storedActivity, openQuestions) {
  const stored = WORKER_STATES.has(storedActivity) ? storedActivity : "idle";
  if (stored === "error" || stored === "held") return stored;
  if (openQuestions === null || openQuestions === undefined) return stored;
  if (openQuestions > 0) return "awaiting-answer";
  // A read that succeeded and found nothing ends the wait it described.
  return stored === "awaiting-answer" ? "idle" : stored;
}

/**
 * Whether the card's attention badge counts it, from the same two inputs.
 *
 * Kept beside `effectiveActivity` so a change to one cannot leave the badge
 * describing a state the card is not in. The badge used to be derived from the
 * stored activity directly, which is how a resolved question stayed amber.
 */
export function attentionFromQuestions(storedActivity, openQuestions) {
  const activity = effectiveActivity(storedActivity, openQuestions);
  return activity === "awaiting-answer" ? "question" : null;
}

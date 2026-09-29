/**
 * Restore-time inbox reactivation. Pure logic, no BB host dependency, so the
 * per-kind return rules are exercised against a real SQLite database in tests.
 *
 * Context: archiving resolves every open question/error/paused row with
 * reason "archived" (the rows survive). Restore undoes exactly that write —
 * nothing more. Resolution stays per kind, never blanket:
 *
 * - error: reopens rows the archive resolved, carrying the card's stored
 *   last_error verbatim as the summary (never a paraphrase).
 * - question: WITHHELD, and this is the one place the "never a partial
 *   restore" rule is deliberately narrowed.
 * - paused: no-op; a fresh worker yields fresh idle state, so the row is
 *   re-derived from live state rather than resurrected.
 * - completed: excluded; the card is not completing again and its event is
 *   a delivery dismissed by reading.
 *
 * Why a question is the exception. A question belongs to the worker that
 * asked it, not to the card: its identity is a thread interaction, and
 * restore starts a FRESH worker on purpose because the old thread's history
 * "is not a valid continuation". A fresh worker has never made that
 * interaction, so its first question sync — whose premise is sound, "a
 * question the live worker is not showing is no longer being asked" —
 * resolves the row as `superseded`. Reopening it therefore bought a badge
 * that appeared and vanished a second later, and an answer that would have
 * reached a thread with none of the context the question was asked in.
 *
 * The alternative — keeping the question live across the restore — needs a
 * second identity on the row (the asking thread) plus a sync exemption, on
 * the load-bearing path where the badge must not lie about a dead thread.
 * That trades one lie for another and is not worth a restored card whose
 * open question is rare. What restore does instead is name the withheld row
 * and its exit, which `questionsWithheld` carries and the caller trails.
 *
 * Only rows resolved with reason "archived" are considered. A question
 * answered or an error resumed before the archive stays resolved — the
 * archive did not take those away, so restore does not bring them back.
 */

export function reactivateRestorePending(db, { cardId, lastError = null, occurredAt } = {}) {
  if (typeof cardId !== "string" || !cardId) throw new Error("reactivateRestorePending: cardId is required.");
  if (typeof occurredAt !== "number") throw new Error("reactivateRestorePending: occurredAt is required.");

  const questionsWithheld = db.prepare(
    "SELECT COUNT(*) AS held FROM inbox_events WHERE card_id = ? AND kind = 'question' " +
      "AND resolved_at IS NOT NULL AND resolved_reason = 'archived'",
  ).get(cardId)?.held ?? 0;

  let errorsReopened;
  if (typeof lastError === "string" && lastError) {
    errorsReopened = db.prepare(
      "UPDATE inbox_events SET resolved_at = NULL, resolved_reason = NULL, summary = ? " +
        "WHERE card_id = ? AND kind = 'error' AND resolved_at IS NOT NULL " +
        "AND resolved_reason = 'archived'",
    ).run(lastError, cardId).changes;
  } else {
    errorsReopened = db.prepare(
      "UPDATE inbox_events SET resolved_at = NULL, resolved_reason = NULL " +
        "WHERE card_id = ? AND kind = 'error' AND resolved_at IS NOT NULL " +
        "AND resolved_reason = 'archived'",
    ).run(cardId).changes;
  }

  return {
    questionsReopened: 0,
    questionsWithheld,
    errorsReopened,
    pausedReopened: 0,
    completedReopened: 0,
  };
}

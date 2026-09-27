/**
 * Restore-time inbox reactivation. Pure logic, no BB host dependency, so the
 * per-kind return rules are exercised against a real SQLite database in tests.
 *
 * Context: archiving resolves every open question/error/paused row with
 * reason "archived" (the rows survive). Restore undoes exactly that write —
 * nothing more. Resolution stays per kind, never blanket:
 *
 * - question: reopens rows the archive resolved, clearing the stale reason.
 * - error: reopens rows the archive resolved, carrying the card's stored
 *   last_error verbatim as the summary (never a paraphrase).
 * - paused: no-op here; a fresh worker yields fresh idle state, so the row
 *   is re-derived from live state rather than resurrected.
 * - completed: excluded; the card is not completing again and its event is
 *   a delivery dismissed by reading.
 *
 * Only rows resolved with reason "archived" return. A question answered or
 * an error resumed before the archive stays resolved — the archive did not
 * take those away, so restore does not bring them back.
 */

export function reactivateRestorePending(db, { cardId, lastError = null, occurredAt } = {}) {
  if (typeof cardId !== "string" || !cardId) throw new Error("reactivateRestorePending: cardId is required.");
  if (typeof occurredAt !== "number") throw new Error("reactivateRestorePending: occurredAt is required.");

  const questionsReopened = db.prepare(
    "UPDATE inbox_events SET resolved_at = NULL, resolved_reason = NULL WHERE card_id = ? AND kind = 'question' AND resolved_at IS NOT NULL AND resolved_reason = 'archived'",
  ).run(cardId).changes;

  let errorsReopened;
  if (typeof lastError === "string" && lastError) {
    errorsReopened = db.prepare(
      "UPDATE inbox_events SET resolved_at = NULL, resolved_reason = NULL, summary = ? WHERE card_id = ? AND kind = 'error' AND resolved_at IS NOT NULL AND resolved_reason = 'archived'",
    ).run(lastError, cardId).changes;
  } else {
    errorsReopened = db.prepare(
      "UPDATE inbox_events SET resolved_at = NULL, resolved_reason = NULL WHERE card_id = ? AND kind = 'error' AND resolved_at IS NOT NULL AND resolved_reason = 'archived'",
    ).run(cardId).changes;
  }

  return { questionsReopened, errorsReopened, pausedReopened: 0, completedReopened: 0 };
}

/**
 * What the card should say when a question could not be persisted.
 *
 * The failure this exists for, reported as a runbook in the README before it was a feature:
 * a worker asks, the answer times out, and the write of the expired-question rows fails —
 * a `SQLITE_BUSY` that outlives both retries, a closed handle, a full disk. The worker
 * prints "The question could not be recorded" and stops, which is correct. What the card
 * shows is the problem.
 *
 * `blockOnAnswer` marks the card `awaiting-answer` before the blocking wait and sets it
 * back to running when the call ends, which happens BEFORE the persist is attempted. So a
 * failed persist leaves a card that is idle, has no pending question, and carries no trace
 * of what happened — visually identical to a card between turns. The only evidence was a
 * line in the plugin log that nobody reads.
 *
 * That is a phantom wait by this project's own rule ("any user-facing wait needs a live
 * question behind it"; "a phantom wait is a bug"), and the fix is not a better log line: it
 * is a record on the card and an inbox event, so a reader sees the failure where they are
 * already looking.
 *
 * The text is built here, in `lib/`, because it is a rule about what a reader must be told
 * rather than a string in a handler: the cause, the fact that nothing was lost, and the one
 * action that recovers it.
 */

/** Whether a persist failure is worth waking someone for. A single retry that succeeds
 * never reaches here; a non-retryable error is a broken installation (closed handle, full
 * disk) and does. Kept as its own predicate because the caller must not have to reason
 * about which sqlite errors are transient. */
export function shouldRecordPersistFailure({ persisted, error }) {
  if (persisted) return false;
  // A null `error` with `persisted: false` cannot happen today (the loop only leaves
  // `persisted` false by catching), but treating it as unrecordable rather than throwing
  // keeps this usable from a failure path, where throwing is the worst possible response.
  if (typeof error !== "string" || error.trim() === "") return false;
  return true;
}

/** The card trail line. Names the cause, says plainly that nothing was lost, and gives the
 * one action that recovers it — the same shape every other refusal in this project uses. */
export function persistFailureTrailLine({ threadId, error }) {
  // The thread id is in the line because "the worker thread" is a place, and a reader who
  // wants to act needs to know which one — on a card with restarts there is more than one
  // worker thread in the history. `cardId` is the line's own target and is not repeated in
  // its text.
  return `A question could not be recorded, so it is NOT pending on this card. `
    + `The worker stopped and will re-ask once. `
    + `Cause: ${error}. `
    + `Nothing was lost — the question was never stored, so there is nothing to recover. `
    + `To resume: send any message on worker thread ${threadId}.`;
}

/**
 * The inbox event, so the failure is visible from the inbox rather than only from the card.
 *
 * `dedupeKey` is keyed on the card and NOT on the error text: the same broken handle fails
 * repeatedly, and a reader wants one entry that counts the repetitions rather than a new row
 * per attempt. The card is the key's unit because the card is what a person acts on.
 */
export function persistFailureInboxEvent({ cardId, error }) {
  return {
    /** Matches the host recorder's `(card, kind, summary, dedupeKey, occurredAt)` shape.
     * Kept as named fields rather than a positional tuple so the caller reads as what it
     * is recording, and so `prettier`/`oxlint` cannot silently reorder a wrong argument. */
    card: { id: cardId },
    kind: "error",
    summary: `A question on this card could not be recorded (${error}). `
      + `The worker stopped and will re-ask once — send any message on the worker thread to resume.`,
    /** Keyed on the card, never on the error text: the same broken handle fails repeatedly,
     * and a reader wants one entry whose count grows rather than a row per attempt. */
    dedupeKey: `ask-persist-failed:${cardId}`,
    occurredAt: 0,
  };
}

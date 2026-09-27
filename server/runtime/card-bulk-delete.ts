/**
 * Bulk delete of archived cards.
 *
 * Its own module because the safety of this action is entirely in the REPORTING,
 * and it deserves to be readable on its own: one card whose native run refuses
 * to stop must not be absorbed into a count, because a bulk action that says
 * only "done" leaves the reader looking at a non-empty column and believing it
 * is empty. There is no undo.
 *
 * So the batch is a loop that ACCOUNTS for every id it was given, each one
 * either deleted or failed-with-a-reason, and one refusal never cancels the
 * rest. The single-card delete is injected rather than imported so the guarantee
 * lives in one place: every card here still passes the same archived-only check,
 * the same run-stop, and the same claim sweep that a single delete does. A stale
 * panel handing over a card that came back to life cannot destroy it.
 *
 * The ids come from the client — the exact set the Archived column was showing
 * for the active filter — rather than a server-side re-query, so the blast
 * radius cannot widen between the reader confirming and the click landing.
 */

/** One card, one verdict. Never a bare boolean, because a bare boolean loses why. */
export type BulkDeleteResult = {
  deleted: string[];
  failed: { cardId: string; error: string }[];
};

export type SingleCardDelete = (cardId: string) => Promise<{ deleted: boolean; error: string | null }>;

export async function deleteArchivedCards(
  deleteCard: SingleCardDelete,
  cardIds: string[],
): Promise<BulkDeleteResult> {
  const deleted: string[] = [];
  const failed: { cardId: string; error: string }[] = [];
  for (const cardId of cardIds) {
    const outcome = await deleteCard(cardId);
    if (outcome.deleted) {
      deleted.push(cardId);
      continue;
    }
    // The output contract declares this reason a plain string, so a null from
    // the single-card result must not reach the client: it would fail response
    // validation and turn the WHOLE batch into one opaque error — the exact
    // outcome per-card reporting exists to prevent.
    failed.push({ cardId, error: outcome.error ?? "The card was not deleted." });
  }
  return { deleted, failed };
}

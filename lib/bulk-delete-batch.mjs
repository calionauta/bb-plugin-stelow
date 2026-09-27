/**
 * Running a bulk delete as batches, so the count is never the limit.
 *
 * The RPC caps a single call at 200 ids — a request-size guard, not a product
 * limit. Sending 201 produced `HTTP 400: rpc input validation failed` to the
 * reader: an opaque error under a button whose own dialog had just promised
 * "Deletes all 201 archived cards". Nothing was deleted, nothing was explained,
 * and the reader had no way to tell a refusal from a failure.
 *
 * So the client batches instead. The cap stays where it belongs (the transport)
 * and the affordance does what it says. Partial truth is still reported as
 * partial truth: a chunk that fails at the transport level is recorded as a
 * failure naming the range, never dropped, because a batch that silently
 * skipped a third of the column would leave the reader looking at cards that
 * are still there and believing the column is empty.
 */

/** The RPC's own per-call ceiling. Kept in step with its contract. */
export const BULK_DELETE_BATCH_SIZE = 200;

function chunk(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

export async function deleteInBatches(deleteBatch, cardIds) {
  const deleted = [];
  const failed = [];
  for (const batch of chunk(cardIds, BULK_DELETE_BATCH_SIZE)) {
    let result;
    try {
      result = await deleteBatch(batch);
    } catch (err) {
      // The whole batch is unaccounted for, so name it as such. Reporting only
      // the batches that worked would overstate the deletion.
      const reason = err instanceof Error ? err.message : "The delete request failed.";
      failed.push({ cardId: `${batch.length} cards`, error: `Batch of ${batch.length} not deleted: ${reason}` });
      continue;
    }
    for (const cardId of Array.isArray(result?.deleted) ? result.deleted : []) {
      deleted.push(cardId);
    }
    for (const entry of Array.isArray(result?.failed) ? result.failed : []) {
      failed.push(entry);
    }
  }
  return { deleted, failed };
}

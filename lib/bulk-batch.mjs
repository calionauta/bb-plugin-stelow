export const BULK_BATCH_SIZE = 200;

function chunk(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size)
    batches.push(items.slice(index, index + size));
  return batches;
}

export async function runInBatches(action, cardIds) {
  const succeeded = [];
  const failed = [];
  for (const batch of chunk(cardIds, BULK_BATCH_SIZE)) {
    let result;
    try {
      result = await action(batch);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Request failed.";
      for (const cardId of batch)
        failed.push({
          cardId,
          error: `Batch of ${batch.length} failed: ${reason}`,
        });
      continue;
    }
    for (const cardId of Array.isArray(result?.succeeded)
      ? result.succeeded
      : Array.isArray(result?.started)
        ? result.started
        : Array.isArray(result?.archived)
          ? result.archived
          : [])
      succeeded.push(cardId);
    for (const entry of Array.isArray(result?.failed) ? result.failed : [])
      failed.push(entry);
  }
  return { succeeded, failed };
}

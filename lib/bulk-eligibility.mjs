export function canBulkStart(card) {
  if (!card) return { ok: false, reason: "not found" };
  if (card.status === "archived") return { ok: false, reason: "archived" };
  if (card.status === "completed") return { ok: false, reason: "completed" };
  if (card.activity === "running" || card.activity === "awaiting-answer") return { ok: false, reason: "running" };
  if (card.worker_thread_id) return { ok: false, reason: "worker active" };
  return { ok: true, reason: null };
}

export function canBulkArchive(card) {
  if (!card) return { ok: false, reason: "not found" };
  if (card.status === "archived") return { ok: false, reason: "already archived" };
  if (card.status === "completed") return { ok: false, reason: "completed" };
  return { ok: true, reason: null };
}

export function canBulkDelete(card) {
  if (!card) return { ok: false, reason: "not found" };
  if (card.status !== "archived") return { ok: false, reason: "only archived" };
  return { ok: true, reason: null };
}

export function partitionByEligibility(cards, predicate) {
  const eligible = [];
  const skipped = [];
  for (const card of cards) {
    const result = predicate(card);
    if (result.ok) eligible.push(card);
    else skipped.push({ card, reason: result.reason });
  }
  return { eligible, skipped };
}

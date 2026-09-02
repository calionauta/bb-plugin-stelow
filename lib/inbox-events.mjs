/**
 * Durable Inbox operations. Kept independent from the BB host so the event
 * lifecycle can be exercised against a real SQLite database in tests.
 */
export function insertInboxEvent(db, event) {
  return db.prepare(
    "INSERT OR IGNORE INTO inbox_events (id, card_id, kind, summary, dedupe_key, occurred_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(event.id, event.cardId, event.kind, event.summary.slice(0, 500), event.dedupeKey, event.occurredAt).changes > 0;
}

export function resolveActionInboxEvents(db, cardId, resolvedAt) {
  return db.prepare(
    "UPDATE inbox_events SET resolved_at = COALESCE(resolved_at, ?) WHERE card_id = ? AND resolved_at IS NULL AND kind IN ('question','error','paused')",
  ).run(resolvedAt, cardId).changes;
}

export function listInboxEvents(db, includeArchived) {
  const visibility = includeArchived
    ? ""
    : "WHERE inbox_events.archived_at IS NULL AND (inbox_events.kind = 'completed' OR inbox_events.resolved_at IS NULL)";
  return db.prepare(
    `SELECT inbox_events.*, cards.display_name, cards.name, cards.project_id FROM inbox_events JOIN cards ON cards.id = inbox_events.card_id ${visibility} ORDER BY occurred_at DESC LIMIT 200`,
  ).all();
}

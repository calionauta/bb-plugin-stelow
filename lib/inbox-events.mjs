/**
 * Durable Inbox operations. Kept independent from the BB host so the event
 * lifecycle can be exercised against a real SQLite database in tests.
 */
export function insertInboxEvent(db, event) {
  return db.prepare(
    "INSERT OR IGNORE INTO inbox_events (id, card_id, kind, summary, dedupe_key, occurred_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(event.id, event.cardId, event.kind, event.summary.slice(0, 500), event.dedupeKey, event.occurredAt).changes > 0;
}

const RESOLVABLE_KINDS = ["question", "error", "paused"];
export function resolveActionInboxEvents(db, cardId, resolvedAt, kinds = RESOLVABLE_KINDS) {
  const targets = (Array.isArray(kinds) ? kinds : []).filter((kind) => RESOLVABLE_KINDS.includes(kind));
  if (targets.length === 0) return 0;
  return db.prepare(
    `UPDATE inbox_events SET resolved_at = COALESCE(resolved_at, ?) WHERE card_id = ? AND resolved_at IS NULL AND kind IN (${targets.map(() => "?").join(",")})`,
  ).run(resolvedAt, cardId, ...targets).changes;
}

export function listInboxEvents(db, includeArchived) {
  // The main view hides only what the user deliberately archived. Resolved
  // items stay queryable so the client can render a Resolved history section:
  // an inbox whose resolutions vanish reads as losing data. The badge counts
  // unresolved action items only (see useInboxAccessory).
  const visibility = includeArchived ? "" : "WHERE inbox_events.archived_at IS NULL";
  return db.prepare(
    `SELECT inbox_events.*, cards.display_name, cards.name, cards.project_id FROM inbox_events JOIN cards ON cards.id = inbox_events.card_id ${visibility} ORDER BY occurred_at DESC LIMIT 200`,
  ).all();
}

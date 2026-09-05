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
  // unresolved action items plus unseen recent completions (see
  // countsForInboxBadge).
  const visibility = includeArchived ? "" : "WHERE inbox_events.archived_at IS NULL";
  return db.prepare(
    `SELECT inbox_events.*, cards.display_name, cards.name, cards.project_id, cards.kind AS card_kind FROM inbox_events JOIN cards ON cards.id = inbox_events.card_id ${visibility} ORDER BY occurred_at DESC LIMIT 200`,
  ).all();
}

// Badge rule: unresolved action items always count (they need the user);
// completions count only while unseen AND fresh — otherwise every finished
// card ever would inflate urgency into noise. Archived never counts.
// Read (seen) is not resolved: seen completions stay in Recent updates,
// seen-but-unanswered questions keep counting.
export const COMPLETED_BADGE_DAYS = 7;

export function countsForInboxBadge(entry, nowMs = Date.now()) {
  if (entry.archivedAt !== null && entry.archivedAt !== undefined) return false;
  if (entry.kind === "completed") {
    if (entry.readAt !== null && entry.readAt !== undefined) return false;
    const ageMs = nowMs - entry.occurredAt;
    return ageMs >= 0 && ageMs <= COMPLETED_BADGE_DAYS * 86_400_000;
  }
  return entry.resolvedAt === null || entry.resolvedAt === undefined;
}

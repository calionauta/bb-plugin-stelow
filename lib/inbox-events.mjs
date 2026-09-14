/**
 * Durable Inbox operations. Kept independent from the BB host so the event
 * lifecycle can be exercised against a real SQLite database in tests.
 */

// Resolution reasons: HOW an item stopped needing attention. Recorded where
// the resolution is observed so the Resolved filter can name it per item.
// Legacy rows predate the column and read as reason-less ("unknown").
export const RESOLUTION_REASONS = ["answered", "superseded", "resumed", "completed", "archived"];

export function ensureInboxResolvedReasonColumn(db) {
  const columns = db.prepare("PRAGMA table_info(inbox_events)").all();
  if (!columns.some((column) => column.name === "resolved_reason")) {
    db.exec("ALTER TABLE inbox_events ADD COLUMN resolved_reason TEXT");
  }
}

function validReason(reason) {
  return RESOLUTION_REASONS.includes(reason) ? reason : null;
}
export function insertInboxEvent(db, event) {
  return db.prepare(
    "INSERT OR IGNORE INTO inbox_events (id, card_id, kind, summary, dedupe_key, occurred_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(event.id, event.cardId, event.kind, event.summary.slice(0, 500), event.dedupeKey, event.occurredAt).changes > 0;
}

export function questionInboxDedupeKey(cardId, interactionId) {
  return `question:${cardId}:${interactionId}`;
}

// A pending interaction, not a poll timestamp, is the identity of a
// question. Repeated syncs are idempotent; superseded events are resolved.
// A question the user just answered is marked first (reason "answered") so
// the sync below — which can only see disappearance — never mislabels it
// as superseded: COALESCE keeps the first write on both columns.
export function markQuestionsAnswered(db, { cardId, interactionIds, occurredAt }) {
  const ids = [...new Set((Array.isArray(interactionIds) ? interactionIds : [])
    .filter((id) => typeof id === "string" && id.trim()))];
  if (ids.length === 0) return 0;
  const keys = ids.map((id) => questionInboxDedupeKey(cardId, id));
  return db.prepare(
    `UPDATE inbox_events SET resolved_at = COALESCE(resolved_at, ?), resolved_reason = COALESCE(resolved_reason, 'answered') WHERE card_id = ? AND kind = 'question' AND resolved_at IS NULL AND dedupe_key IN (${keys.map(() => "?").join(",")})`,
  ).run(occurredAt, cardId, ...keys).changes;
}

export function syncQuestionInboxEvents(db, { cardId, interactionIds, occurredAt, createId, summary }) {
  const ids = [...new Set((Array.isArray(interactionIds) ? interactionIds : [])
    .filter((id) => typeof id === "string" && id.trim()))];
  const keys = ids.map((id) => questionInboxDedupeKey(cardId, id));
  const unresolved = keys.length > 0
    ? db.prepare(`UPDATE inbox_events SET resolved_at = COALESCE(resolved_at, ?), resolved_reason = COALESCE(resolved_reason, 'superseded') WHERE card_id = ? AND kind = 'question' AND resolved_at IS NULL AND dedupe_key NOT IN (${keys.map(() => "?").join(",")})`)
      .run(occurredAt, cardId, ...keys).changes
    : db.prepare("UPDATE inbox_events SET resolved_at = COALESCE(resolved_at, ?), resolved_reason = COALESCE(resolved_reason, 'superseded') WHERE card_id = ? AND kind = 'question' AND resolved_at IS NULL")
      .run(occurredAt, cardId).changes;
  const reopened = keys.length > 0
    ? db.prepare(`UPDATE inbox_events SET resolved_at = NULL WHERE card_id = ? AND kind = 'question' AND archived_at IS NULL AND resolved_at IS NOT NULL AND dedupe_key IN (${keys.map(() => "?").join(",")})`)
      .run(cardId, ...keys).changes
    : 0;
  let inserted = 0;
  for (const interactionId of ids) {
    if (insertInboxEvent(db, {
      id: createId(),
      cardId,
      kind: "question",
      summary,
      dedupeKey: questionInboxDedupeKey(cardId, interactionId),
      occurredAt,
    })) inserted += 1;
  }
  return { inserted, resolved: unresolved, reopened };
}

const RESOLVABLE_KINDS = ["question", "error", "paused"];
export function resolveActionInboxEvents(db, cardId, resolvedAt, kinds = RESOLVABLE_KINDS, reason = null) {
  const targets = (Array.isArray(kinds) ? kinds : []).filter((kind) => RESOLVABLE_KINDS.includes(kind));
  if (targets.length === 0) return 0;
  const resolvedReason = validReason(reason);
  return db.prepare(
    `UPDATE inbox_events SET resolved_at = COALESCE(resolved_at, ?), resolved_reason = COALESCE(resolved_reason, ?) WHERE card_id = ? AND resolved_at IS NULL AND kind IN (${targets.map(() => "?").join(",")})`,
  ).run(resolvedAt, resolvedReason, cardId, ...targets).changes;
}

export function listInboxEvents(db, includeArchived) {
  // The main view hides only what the user deliberately archived. Resolved
  // items stay queryable so the client can render a Resolved history section:
  // an inbox whose resolutions vanish reads as losing data. The badge counts
  // only unresolved action items (see countsForInboxBadge).
  const visibility = includeArchived ? "" : "WHERE inbox_events.archived_at IS NULL";
  return db.prepare(
    `SELECT inbox_events.*, cards.display_name, cards.name, cards.project_id, cards.kind AS card_kind FROM inbox_events JOIN cards ON cards.id = inbox_events.card_id ${visibility} ORDER BY occurred_at DESC LIMIT 200`,
  ).all();
}

// Badge rule: unresolved action items always count (they need the user), even
// after being read. Completion is history, never a live action. Keeping this
// identical to the primary Inbox filter prevents a non-zero badge from
// opening onto an empty list.
export function countsForInboxBadge(entry, nowMs = Date.now()) {
  void nowMs; // Keep the public signature stable for callers that pass a clock.
  if (entry.archivedAt !== null && entry.archivedAt !== undefined) return false;
  return entry.kind !== "completed" && (entry.resolvedAt === null || entry.resolvedAt === undefined);
}

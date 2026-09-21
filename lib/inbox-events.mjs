/**
 * Durable Inbox operations. Kept independent from the BB host so the event
 * lifecycle can be exercised against a real SQLite database in tests.
 */
import { stallCount } from "./worker-ledger.mjs";
import { scoreEventSeverity, SEVERITY_ACTION } from "./inbox-severity.mjs";
import { ensureColumns } from "./sqlite-columns.mjs";

// Resolution reasons: HOW an item stopped needing attention. Recorded where
// the resolution is observed so the Resolved filter can name it per item.
// Legacy rows predate the column and read as reason-less ("unknown").
export const RESOLUTION_REASONS = ["answered", "superseded", "resumed", "completed", "archived"];

export function ensureInboxResolvedReasonColumn(db) {
  ensureColumns(db, "inbox_events", [["resolved_reason", "TEXT"]]);
}

// Severity tiers order the queue without changing what counts: pre-tier
// rows default to ACTION (today's flat behavior), so the migration never
// reinterprets history.
export function ensureInboxSeverityColumns(db) {
  ensureColumns(db, "inbox_events", [
    ["severity", "INTEGER NOT NULL DEFAULT 1"],
    ["severity_reasons", "TEXT NOT NULL DEFAULT '[]'"],
  ]);
}

function validReason(reason) {
  return RESOLUTION_REASONS.includes(reason) ? reason : null;
}
export function insertInboxEvent(db, event) {
  // Severity is scored at write from observable signals: error repetitions
  // count unresolved errors including this row, stalls come from the
  // worker ledger. Newborn rows have age zero, so age escalation happens
  // on the sweep (refreshEventSeverity), never here.
  let scored = { severity: SEVERITY_ACTION, reasons: [] };
  try {
    const errorRepetitions = event.kind === "error"
      ? db.prepare("SELECT COUNT(*) AS count FROM inbox_events WHERE card_id = ? AND kind = 'error' AND resolved_at IS NULL").get(event.cardId).count + 1
      : 0;
    scored = scoreEventSeverity({ kind: event.kind, ageMs: 0, stallCount: stallCount(db, event.cardId), errorRepetitions });
  } catch { /* a scoring failure must never lose the event itself */ }
  return db.prepare(
    "INSERT OR IGNORE INTO inbox_events (id, card_id, kind, summary, dedupe_key, occurred_at, severity, severity_reasons) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(event.id, event.cardId, event.kind, event.summary.slice(0, 500), event.dedupeKey, event.occurredAt, scored.severity, JSON.stringify(scored.reasons)).changes > 0;
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
  // A card cannot simultaneously need a generic Resume (or a raw error
  // report) and a specific answer. The question tells the person exactly
  // what to do — the card hero already prioritizes decision over error —
  // so resolve every open pause or error as superseded rather than turning
  // one card into several badge counts for the same attention need. The
  // rows survive in Resolved history; a later failure without an open
  // question inserts a fresh error event as usual.
  const pausedSuperseded = ids.length > 0
    ? resolveActionInboxEvents(db, cardId, occurredAt, ["paused", "error"], "superseded")
    : 0;
  return { inserted, resolved: unresolved, reopened, pausedSuperseded };
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

/**
 * The REVIEW signal: a completion the human has not opened yet. A finished
 * card is work to look at, and a Done column that looks inert teaches people
 * to stop opening it.
 *
 * The completion's own read state is the lifecycle: completion writes it
 * unread, opening the Done card clears it, and that same signal reaches the
 * Inbox badge as a review request without pretending the workflow is blocked.
 */
export function hasPendingReview(db, cardId) {
  return Boolean(db.prepare("SELECT 1 FROM inbox_events WHERE card_id = ? AND kind = 'completed' AND read_at IS NULL AND archived_at IS NULL LIMIT 1").get(cardId));
}

export function listInboxEvents(db, includeArchived) {
  // The main view hides only what the user deliberately archived. Resolved
  // items stay queryable so the client can render a Resolved history section:
  // an inbox whose resolutions vanish reads as losing data. The badge counts
  // only live attention items (see countsForInboxBadge).
  const visibility = includeArchived ? "" : "WHERE inbox_events.archived_at IS NULL";
  // Severity first for open items, then newest: escalations top every tab
  // while resolved history stays chronological (resolved rows sort below
  // open ones regardless of their last tier). The badge is untouched by
  // ordering; it still counts open actions only.
  return db.prepare(
    `SELECT inbox_events.*, cards.display_name, cards.name, cards.project_id, cards.kind AS card_kind FROM inbox_events JOIN cards ON cards.id = inbox_events.card_id ${visibility} ORDER BY CASE WHEN resolved_at IS NULL THEN severity ELSE -1 END DESC, occurred_at DESC LIMIT 200`,
  ).all();
}

// Age escalation for open rows: a pause that crosses the stall window (or
// any action that crosses the outer window) upgrades in place with fresh
// reasons. Same-row updates only — resolution, badge, and board position
// never move. Returns the upgraded count for realtime publishing.
export function refreshEventSeverity(db, { cardId, nowMs }) {
  const rows = db.prepare(
    "SELECT id, kind, summary, occurred_at, severity, severity_reasons FROM inbox_events WHERE card_id = ? AND resolved_at IS NULL AND archived_at IS NULL",
  ).all(cardId);
  const update = db.prepare("UPDATE inbox_events SET severity = ?, severity_reasons = ? WHERE id = ?");
  let updated = 0;
  for (const row of rows) {
    let errorRepetitions = 0;
    try {
      errorRepetitions = row.kind === "error"
        ? db.prepare("SELECT COUNT(*) AS count FROM inbox_events WHERE card_id = ? AND kind = 'error' AND resolved_at IS NULL").get(cardId).count
        : 0;
      const scored = scoreEventSeverity({ kind: row.kind, ageMs: nowMs - row.occurred_at, stallCount: stallCount(db, cardId), errorRepetitions });
      const reasons = JSON.stringify(scored.reasons);
      if (scored.severity !== row.severity || reasons !== (row.severity_reasons ?? "[]")) {
        updated += update.run(scored.severity, reasons, row.id).changes;
      }
    } catch { /* advisory only — a scoring failure keeps the stored tier */ }
  }
  return updated;
}

// Badge rule: unresolved action items always count, even after being read.
// An unread completion also counts until its Done card is opened; it is a
// review request, not a blocker. This exactly matches Needs attention.
export function countsForInboxBadge(entry, nowMs = Date.now()) {
  void nowMs; // Keep the public signature stable for callers that pass a clock.
  if (entry.archivedAt !== null && entry.archivedAt !== undefined) return false;
  if (entry.kind === "completed") return entry.resolvedAt == null && entry.readAt == null;
  return entry.resolvedAt === null || entry.resolvedAt === undefined;
}

// Stalled-paused escalation: a paused card that stays idle past grace AND
// past this second, much longer window gets its open paused event reworded
// with the age, so old stalls stop looking identical to fresh ones. Same
// row, same badge count, same resolution rules — attention escalates while
// the card keeps its column (board position is never attention).
export const STALLED_ESCALATION_MS = 3 * 24 * 3600 * 1000;

const STALLED_PREFIX_PATTERN = /^Stalled \d+d — /;

export function stalledDays(idleMs) {
  return Math.max(0, Math.floor(idleMs / 86400000));
}

export function escalatePausedSummary(summary, idleMs) {
  const base = String(summary ?? "").replace(STALLED_PREFIX_PATTERN, "");
  return `Stalled ${stalledDays(idleMs)}d — ${base}`.slice(0, 500);
}

export function refreshStalledPaused(db, { cardId, nowMs }) {
  const cutoff = nowMs - STALLED_ESCALATION_MS;
  const rows = db.prepare(
    "SELECT id, summary, occurred_at FROM inbox_events WHERE card_id = ? AND kind = 'paused' AND resolved_at IS NULL AND occurred_at <= ?",
  ).all(cardId, cutoff);
  const update = db.prepare("UPDATE inbox_events SET summary = ? WHERE id = ? AND summary != ?");
  let updated = 0;
  for (const row of rows) {
    const next = escalatePausedSummary(row.summary, nowMs - row.occurred_at);
    updated += update.run(next, row.id, next).changes;
  }
  return updated;
}

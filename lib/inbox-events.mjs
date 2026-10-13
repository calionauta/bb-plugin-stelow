/**
 * Durable Inbox operations. Kept independent from the BB host so the event
 * lifecycle can be exercised against a real SQLite database in tests.
 */
import { stallCount } from "./worker-ledger.mjs";
import { scoreEventSeverity, SEVERITY_ACTION } from "./inbox-severity.mjs";
import { ensureColumns } from "./sqlite-columns.mjs";
import { expiredQuestionRowId, isExpiredQuestionId } from "./question-answer-recording.mjs";

// Resolution reasons: HOW an item stopped needing attention. Recorded where
// the resolution is observed so the Resolved filter can name it per item.
// Legacy rows predate the column and read as reason-less ("unknown").
export const RESOLUTION_REASONS = ["answered", "superseded", "resumed", "completed", "archived"];

/** The one sentence every open-question notification carries. Single-sourced
 * here because the mint path (syncQuestionInboxEvents callers) and the early
 * post-ask kick (lib/question-sync-kick) must promise the same wait — two
 * literals would drift into two different waits for one question. */
export const QUESTION_WAITING_SUMMARY = "The agent is waiting for your answer to continue.";

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
  // count this row's own occurrences, stalls come from the
  // worker ledger. Newborn rows have age zero, so age escalation happens
  // on the sweep (refreshEventSeverity), never here.
  let scored = { severity: SEVERITY_ACTION, reasons: [] };
  try {
    scored = scoreEventSeverity({
      kind: event.kind,
      ageMs: 0,
      stallCount: stallCount(db, event.cardId),
      errorRepetitions: event.occurrences ?? 1,
    });
  } catch { /* a scoring failure must never lose the event itself */ }
  // The holder columns are the AFFORDANCE for an event whose summary names
  // another card: a reader can open the card that holds a file they are waiting
  // on, instead of copying a display name and hunting it on the board. Written
  // as columns rather than recovered from the summary, because a link parsed
  // out of prose is a link that eventually points at the wrong card. Both come
  // from one record (lib/lock-blocked), so the sentence and the link cannot
  // name different holders.
  const holder = event.holder ?? null;
  return db.prepare(
    "INSERT OR IGNORE INTO inbox_events (id, card_id, kind, summary, dedupe_key, occurred_at, "
    + "severity, severity_reasons, holder_card_id, holder_file, occurrences) "
    + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    event.id, event.cardId, event.kind, event.summary.slice(0, 500), event.dedupeKey, event.occurredAt,
    scored.severity, JSON.stringify(scored.reasons), holder?.cardId ?? null, holder?.file ?? null,
    event.occurrences ?? 1,
  ).changes > 0;
}

export function questionInboxDedupeKey(cardId, interactionId) {
  return `question:${cardId}:${interactionId}`;
}

/**
 * One batch, one notification.
 *
 * A timed-out batched ask persists as one expired row PER sub-question, and
 * rows from the same timeout share expired_at — so without this, one batch
 * mints N identical notifications and the badge counts one decision N times
 * (card_a9q5zhzd: "Keep IN ×7" + "Add to IN ×4" as two rows). Live
 * interactions keep per-id keys (one live interaction already is one batch),
 * and a genuinely new batch — a different expired_at — still gets its own
 * row. An expired id with no open row (answered elsewhere, pruned) falls back
 * to its per-id key: the next sync with a fresh open set resolves it as
 * superseded, so a stale caller can neither silence a real question nor leave
 * a phantom one open.
 */
export function questionSyncKeys(db, cardId, interactionIds) {
  const ids = [...new Set((Array.isArray(interactionIds) ? interactionIds : [])
    .filter((id) => typeof id === "string" && id.trim()))];
  const expiredRows = ids.filter(isExpiredQuestionId).map(expiredQuestionRowId);
  // No answered filter here: the expired answer flow commits answered=1
  // BEFORE marking the inbox, so filtering open rows would miss exactly the
  // rows being answered and mislabel them superseded. Openness is the
  // caller's job — every caller passes a fresh open set — this only maps
  // identity. An id with no row at all is dropped: notifying for it would
  // invent attention.
  const batchByRow = expiredRows.length > 0
    ? new Map(db.prepare(
      `SELECT id, expired_at FROM expired_questions WHERE card_id = ? AND id IN (${expiredRows.map(() => "?").join(",")})`,
    ).all(cardId, ...expiredRows).map((row) => [row.id, row.expired_at]))
    : new Map();
  const keys = [];
  for (const id of ids) {
    if (isExpiredQuestionId(id)) {
      const batch = batchByRow.get(expiredQuestionRowId(id));
      if (batch !== undefined) keys.push(`question:${cardId}:expired:${batch}`);
    } else {
      keys.push(questionInboxDedupeKey(cardId, id));
    }
  }
  return [...new Set(keys)];
}

// A pending interaction, not a poll timestamp, is the identity of a
// question. Repeated syncs are idempotent; superseded events are resolved.
// A question the user just answered is marked first (reason "answered") so
// the sync below — which can only see disappearance — never mislabels it
// as superseded: COALESCE keeps the first write on both columns.
export function markQuestionsAnswered(db, { cardId, interactionIds, occurredAt }) {
  const keys = questionSyncKeys(db, cardId, interactionIds);
  if (keys.length === 0) return 0;
  return db.prepare(
    `UPDATE inbox_events SET resolved_at = COALESCE(resolved_at, ?), resolved_reason = COALESCE(resolved_reason, 'answered') WHERE card_id = ? AND kind = 'question' AND resolved_at IS NULL AND dedupe_key IN (${keys.map(() => "?").join(",")})`,
  ).run(occurredAt, cardId, ...keys).changes;
}

export function syncQuestionInboxEvents(db, { cardId, interactionIds, occurredAt, createId, summary }) {
  const keys = questionSyncKeys(db, cardId, interactionIds);
  const unresolved = keys.length > 0
    ? db.prepare(`UPDATE inbox_events SET resolved_at = COALESCE(resolved_at, ?), resolved_reason = COALESCE(resolved_reason, 'superseded') WHERE card_id = ? AND kind = 'question' AND resolved_at IS NULL AND dedupe_key NOT IN (${keys.map(() => "?").join(",")})`)
      .run(occurredAt, cardId, ...keys).changes
    : db.prepare("UPDATE inbox_events SET resolved_at = COALESCE(resolved_at, ?), resolved_reason = COALESCE(resolved_reason, 'superseded') WHERE card_id = ? AND kind = 'question' AND resolved_at IS NULL")
      .run(occurredAt, cardId).changes;
  const reopened = keys.length > 0
    ? db.prepare(
      `UPDATE inbox_events SET resolved_at = NULL, resolved_reason = NULL ` +
        `WHERE card_id = ? AND kind = 'question' AND archived_at IS NULL ` +
        `AND resolved_at IS NOT NULL AND dedupe_key IN (${keys.map(() => "?").join(",")})`,
    ).run(cardId, ...keys).changes
    : 0;
  let inserted = 0;
  for (const dedupeKey of keys) {
    if (insertInboxEvent(db, {
      id: createId(),
      cardId,
      kind: "question",
      summary,
      dedupeKey,
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
  const pausedSuperseded = keys.length > 0
    ? resolveActionInboxEvents(db, cardId, occurredAt, ["paused", "error"], "superseded")
    : 0;
  return { inserted, resolved: unresolved, reopened, pausedSuperseded };
}

// A card's ACTION items are the things a person can still do something about:
// a question to answer, a failure to read, a pause to resume. `completed` is
// deliberately NOT one of them, because an unread completion IS the review
// request — resolving it on arrival would erase the signal it exists to carry.
const RESOLVABLE_KINDS = ["question", "error", "paused"];
export function resolveActionInboxEvents(db, cardId, resolvedAt, kinds = RESOLVABLE_KINDS, reason = null) {
  const targets = (Array.isArray(kinds) ? kinds : []).filter((kind) => RESOLVABLE_KINDS.includes(kind));
  if (targets.length === 0) return 0;
  const resolvedReason = validReason(reason);
  return db.prepare(
    `UPDATE inbox_events SET resolved_at = COALESCE(resolved_at, ?), resolved_reason = COALESCE(resolved_reason, ?) WHERE card_id = ? AND resolved_at IS NULL AND kind IN (${targets.map(() => "?").join(",")})`,
  ).run(resolvedAt, resolvedReason, cardId, ...targets).changes;
}

const ALL_RESOLVABLE_KINDS = [...RESOLVABLE_KINDS, "completed"];

/**
 * Close EVERY open inbox row for a card, completions included.
 *
 * Archiving is a terminal event for a card: it leaves the board, its worker is
 * stopped, and nothing further will happen on it. An open `completed` row is
 * the review request "go open this finished card" — and for an archived card
 * that request can never be answered, because the card is gone from every
 * surface a person would open it from. Left open, it is a notification that
 * demands an impossible action: the inbox badge counts it, the card's
 * attention state counts it, and neither can ever fall to zero.
 *
 * So archiving resolves them, with reason "archived", which reads in the
 * Resolved history as "Closed with the card" — an honest account of why nobody
 * reviewed it. The rows are not deleted: the history of a completed card that
 * was archived before review is exactly what someone auditing the card needs.
 *
 * `read_at` is deliberately untouched. A read is something a person did; an
 * archive is something the card's life did, and pretending a person reviewed
 * work they never saw would be the one lie this table must not tell.
 */
export function resolveAllInboxEvents(db, cardId, resolvedAt, reason = null) {
  const resolvedReason = validReason(reason);
  const kinds = ALL_RESOLVABLE_KINDS.map(() => "?").join(",");
  return db.prepare(
    `UPDATE inbox_events SET resolved_at = COALESCE(resolved_at, ?), `
    + `resolved_reason = COALESCE(resolved_reason, ?) `
    + `WHERE card_id = ? AND resolved_at IS NULL AND kind IN (${kinds})`,
  ).run(resolvedAt, resolvedReason, cardId, ...ALL_RESOLVABLE_KINDS).changes;
}

/**
 * The REVIEW signal: a completion the human has not opened yet. A finished
 * card is work to look at, and a Done column that looks inert teaches people
 * to stop opening it.
 *
 * The completion's own read state is the lifecycle: completion writes it
 * unread, opening the Done card clears it, and that same signal reaches the
 * Inbox badge as a review request without pretending the workflow is blocked.
 *
 * `resolved_at` has to be part of this question, not just `read_at`. A card
 * that gets ARCHIVED mid-review has its open completion rows resolved with
 * reason "archived" — that is the terminal event closing them — while their
 * `read_at` stays NULL forever, because nobody will ever open an archived
 * card. The old query asked only whether the row was unread, so those rows
 * answered "yes, this card is still waiting for a review" indefinitely: the
 * archived card kept claiming a review that could not happen, on the badge
 * and in the board's attention state. `read_at` is what the reader did;
 * `resolved_at` is what the card's life did. A pending review is the one
 * that has neither ended.
 */
export function hasPendingReview(db, cardId) {
  return Boolean(db.prepare(
    "SELECT 1 FROM inbox_events WHERE card_id = ? AND kind = 'completed' "
    + "AND read_at IS NULL AND resolved_at IS NULL AND archived_at IS NULL LIMIT 1",
  ).get(cardId));
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
//
// One scoring loop, two callers: the per-card path (a live card's own rows,
// called from the claim sweep) and the fleet path below. Two loops would be
// two places for the ladder to be applied differently, and the second one
// would be wrong in a way only a reader of both files could see.
function rescoreOpenRows(db, rows, nowMs) {
  const update = db.prepare("UPDATE inbox_events SET severity = ?, severity_reasons = ? WHERE id = ?");
  let updated = 0;
  for (const row of rows) {
    try {
      // The row's OWN repetition count, not a count of rows. Counting rows meant
      // the signal only existed because duplicates were being created, so the
      // sweep re-derived a number from the very mess it should have prevented.
      const errorRepetitions = row.kind === "error" ? (row.occurrences ?? 1) : 0;
      const scored = scoreEventSeverity({ kind: row.kind, ageMs: nowMs - row.occurred_at, stallCount: stallCount(db, row.card_id), errorRepetitions });
      const reasons = JSON.stringify(scored.reasons);
      if (scored.severity !== row.severity || reasons !== (row.severity_reasons ?? "[]")) {
        updated += update.run(scored.severity, reasons, row.id).changes;
      }
    } catch { /* advisory only — a scoring failure keeps the stored tier */ }
  }
  return updated;
}

const OPEN_ROW_COLUMNS = "id, card_id, kind, summary, occurred_at, severity, severity_reasons, occurrences";

export function refreshEventSeverity(db, { cardId, nowMs }) {
  const rows = db.prepare(
    `SELECT ${OPEN_ROW_COLUMNS}`
    + " FROM inbox_events WHERE card_id = ? AND resolved_at IS NULL AND archived_at IS NULL",
  ).all(cardId);
  return rescoreOpenRows(db, rows, nowMs);
}

/**
 * Age escalation across the whole queue, for rows no live sync will ever revisit.
 *
 * The per-card sweep runs only for cards being synced, and `shouldSyncThread`
 * excludes `completed` — deliberately, since a finished card has no thread left
 * to read. So a completion nobody opened never had its age re-scored, and the
 * review-wait escalation in `lib/inbox-severity.mjs` could never fire. This is
 * the door that reaches those rows.
 *
 * Bounded and deterministic: it re-scores only rows that are still open and
 * unresolved, promotes only within the existing ladder, and returns the changed
 * count. Resolution, ordering, and the badge are untouched.
 */
export function sweepEventSeverity(db, { nowMs }) {
  const rows = db.prepare(
    `SELECT ${OPEN_ROW_COLUMNS}`
    + " FROM inbox_events WHERE resolved_at IS NULL AND archived_at IS NULL",
  ).all();
  return rescoreOpenRows(db, rows, nowMs);
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

/**
 * Keep ONE open paused event per card, whatever the idle period.
 *
 * The key used to be `paused:<card>:<idleAt>`, so every new idle period minted
 * a new row. A card oscillating between idle and briefly-active produced a
 * stream of byte-identical notifications for one problem: eight open rows on a
 * single stuck card, all reading "Idle with unfinished work". The badge is
 * meant to count unresolved ACTION ITEMS, and one stuck card is one action
 * item, not eight — so the count was inflation and the only escalation the
 * inbox has, `Stalled Nd`, never got a chance to fire because its own rows
 * kept being buried under look-alikes.
 *
 * So a repeat idle refreshes the open row instead of adding one: `occurred_at`
 * moves so the item sorts as current, and the summary gains the stall age once
 * it passes the escalation window. Age is measured from the FIRST idle, stored
 * in the row, so a card idle for a week says "Stalled 7d" rather than resetting
 * every time it blinks.
 */
export function upsertPausedEvent(db, { cardId, summary, idleAt, nowMs, createId }) {
  const open = db
    .prepare("SELECT id, summary, occurred_at FROM inbox_events WHERE card_id = ? AND kind = 'paused' AND resolved_at IS NULL")
    .get(cardId);
  const text = String(summary ?? "").slice(0, 500);
  if (!open) {
    return insertInboxEvent(db, {
      id: createId(),
      cardId,
      kind: "paused",
      summary: text,
      dedupeKey: `paused:${cardId}:${idleAt}`,
      occurredAt: nowMs,
    });
  }
  // Age from the first idle, not from now: the row is the stall's memory.
  const stalledMs = nowMs - Math.min(open.occurred_at, idleAt);
  const next = stalledMs >= STALLED_ESCALATION_MS ? escalatePausedSummary(open.summary, stalledMs) : text;
  db.prepare("UPDATE inbox_events SET summary = ?, occurred_at = ? WHERE id = ?").run(next, nowMs, open.id);
  return true;
}

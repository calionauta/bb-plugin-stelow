/**
 * The action log (SQLite-backed, append-only).
 *
 * This is the plugin's flight recorder. `comments` narrates what an agent said
 * on a card, `trackable_events` records status decisions, and BB's own event
 * log records what a worker's tools did — but none of them can answer "what did
 * the plugin itself experience?", because a successful RPC, a refused `done`,
 * a reconciler tick or a spawn decision left no row anywhere.
 *
 * Measured before this existed: 1,435 CLI failures in five weeks with no
 * denominator, 88 `done` refusals whose reasons had to be scraped from prose
 * comments, and one card that spawned 189 worker threads while its own
 * `last_error` column said "unknown error". The evidence existed; the recorder
 * did not.
 *
 * Two rules make it usable instead of noisy:
 *
 * 1. A repeated condition is ONE row with `occurrences`. The reconciler that
 *    wrote 26 identical comments in 45 minutes, and the retry loop that wrote
 *    150, become one row each with a count and a `last_at`. Deduplication only
 *    applies when a `cause` is present, because a cause names a repeatable
 *    condition — two unrelated successful RPCs are not "the same event".
 * 2. The detail is a small JSON object, never prose and never a payload that
 *    could contain a prompt. A serialized detail over the cap is replaced by
 *    its size, so the recorder cannot become a second copy of the database.
 *
 * Logging never blocks the action it records: `recordActionLog` throws on a
 * malformed entry (a programmer error, red in tests), and the runtime recorder
 * in `server/runtime/action-log-runtime.ts` is what swallows and reports it.
 */
import {
  ACTION_ACTORS,
  ACTION_LAYERS,
  ACTION_OUTCOMES,
  ACTION_SURFACES,
  actionLayerOf,
  actionSurfaceOf,
  isActionCause,
  isActionKind,
} from "./action-kinds.mjs";

export const ACTION_LOG_DETAIL_LIMIT = 2048;
export const ACTION_LOG_DEDUPE_WINDOW_MS = 10 * 60 * 1000;
export const ACTION_LOG_DEFAULT_LIMIT = 200;

export function ensureActionLogTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS action_log (
    id TEXT PRIMARY KEY,
    at INTEGER NOT NULL,
    last_at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    layer TEXT NOT NULL,
    surface TEXT NOT NULL,
    actor TEXT NOT NULL,
    op_id TEXT,
    card_id TEXT,
    thread_id TEXT,
    run_id TEXT,
    stage TEXT,
    outcome TEXT NOT NULL,
    cause TEXT,
    duration_ms INTEGER,
    occurrences INTEGER NOT NULL DEFAULT 1,
    detail TEXT NOT NULL DEFAULT '{}'
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_action_log_card ON action_log (card_id, at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_action_log_at ON action_log (at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_action_log_kind ON action_log (kind, at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_action_log_last ON action_log (last_at DESC)");
}

function text(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function serializableDetail(detail, limit) {
  if (detail === undefined || detail === null) return "{}";
  const value = typeof detail === "string" ? { text: detail } : detail;
  let json;
  try {
    json = JSON.stringify(value);
  } catch {
    // A circular or otherwise unserializable detail is a caller bug, but it
    // must not cost the event: keep the fact and lose the payload.
    return '{"unserializable":true}';
  }
  if (typeof json !== "string") return '{"unserializable":true}';
  if (json.length <= limit) return json;
  return JSON.stringify({ truncated: true, bytes: json.length });
}

function normalize(entry, options) {
  if (!isActionKind(entry.kind)) {
    throw new Error(`action-log: refused unknown kind ${JSON.stringify(entry.kind)}`);
  }
  if (!ACTION_OUTCOMES.includes(entry.outcome)) {
    throw new Error(
      `action-log: refused outcome ${JSON.stringify(entry.outcome)} for ${entry.kind}`,
    );
  }
  const actor = entry.actor ?? "plugin";
  if (!ACTION_ACTORS.includes(actor)) {
    throw new Error(`action-log: refused actor ${JSON.stringify(actor)}`);
  }
  const cause = entry.cause ?? null;
  if (cause !== null && !isActionCause(cause)) {
    throw new Error(`action-log: refused cause ${JSON.stringify(cause)}`);
  }
  const at = Number.isFinite(entry.at) ? entry.at : (options.now ?? Date.now)();
  // Both come from the catalog, never from the caller. A kind is a fact with
  // one door and one layer; letting a call site relabel its own surface is how
  // "this spike came through the UI" stops being true, and there is no call
  // site that needs to — the same event arriving at a second door is a second
  // kind, declared here.
  const layer = actionLayerOf(entry.kind);
  const surface = actionSurfaceOf(entry.kind);
  if (!ACTION_LAYERS.includes(layer) || !ACTION_SURFACES.includes(surface)) {
    throw new Error(`action-log: undeclared layer/surface for ${entry.kind}`);
  }
  const duration = Number.isFinite(entry.durationMs)
    ? Math.max(0, Math.round(entry.durationMs))
    : null;
  return {
    id: text(entry.id) ?? (options.randomId ?? defaultRandomId)(),
    at,
    kind: entry.kind,
    layer,
    surface,
    actor,
    opId: text(entry.opId),
    cardId: text(entry.cardId),
    threadId: text(entry.threadId),
    runId: text(entry.runId),
    stage: text(entry.stage),
    outcome: entry.outcome,
    cause,
    durationMs: duration,
    detail: serializableDetail(entry.detail, options.detailLimit ?? ACTION_LOG_DETAIL_LIMIT),
  };
}

function defaultRandomId() {
  return `act_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Fold a repeat onto the row that already describes it.
 *
 * Three fields, three different truths about the same series: `occurrences`
 * counts every one, `duration_ms` keeps the worst (`MAX`) so a 5.7 s pass does
 * not hide behind the 12 ms one that created the row, and `detail` moves to the
 * latest occurrence — a tick that started failing a different phase tomorrow
 * must not show today's list. Prose is not duplicated: `detail` is the latest
 * evidence, never the history, and `last_at` is when that evidence was seen.
 */
function bumpRepeat(db, row, windowMs) {
  const existing = db
    .prepare(
      `SELECT id, occurrences FROM action_log
       WHERE kind = ? AND outcome = ? AND cause IS ? AND card_id IS ? AND stage IS ?
         AND last_at >= ?
       ORDER BY last_at DESC LIMIT 1`,
    )
    .get(row.kind, row.outcome, row.cause, row.cardId, row.stage, row.at - windowMs);
  if (!existing) return null;
  db.prepare(
    `UPDATE action_log
        SET occurrences = occurrences + 1,
            last_at = ?,
            duration_ms = CASE
              WHEN ? IS NULL THEN duration_ms
              WHEN duration_ms IS NULL THEN ?
              ELSE MAX(duration_ms, ?)
            END,
            detail = ?
      WHERE id = ?`,
  ).run(row.at, row.durationMs, row.durationMs, row.durationMs, row.detail, existing.id);
  return { id: existing.id, occurrences: (existing.occurrences ?? 1) + 1, deduped: true };
}

/**
 * Append one event. Returns `{ id, occurrences, deduped }`, or the row that was
 * incremented when the same (kind, card, cause, outcome) repeats inside the
 * window.
 *
 * Deduplication is deliberately keyed on `card_id IS ?` rather than `= ?`: a
 * tick with no card and a tick on a card are different facts, and SQLite's
 * three-valued logic would silently treat them the same.
 *
 * `stage` is part of the key for the same reason: three stage advances inside
 * ten minutes are three different positions, and folding them into "triage→shape
 * x3" hides the path the card actually walked. The `card_stage_events` ledger
 * still holds each row; this keeps the log from contradicting it.
 */
export function recordActionLog(db, entry = {}, options = {}) {
  const row = normalize(entry, options);
  const windowMs = options.dedupeWindowMs ?? ACTION_LOG_DEDUPE_WINDOW_MS;
  if (row.cause !== null && windowMs > 0) {
    const bumped = bumpRepeat(db, row, windowMs);
    if (bumped) return bumped;
  }
  db.prepare(
    `INSERT INTO action_log
      (id, at, last_at, kind, layer, surface, actor, op_id, card_id, thread_id, run_id, stage, outcome, cause, duration_ms, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.at,
    row.at,
    row.kind,
    row.layer,
    row.surface,
    row.actor,
    row.opId,
    row.cardId,
    row.threadId,
    row.runId,
    row.stage,
    row.outcome,
    row.cause,
    row.durationMs,
    row.detail,
  );
  return { id: row.id, occurrences: 1, deduped: false };
}

function whereClause(filter = {}) {
  const clauses = [];
  const values = [];
  if (filter.cardId) {
    clauses.push("card_id = ?");
    values.push(filter.cardId);
  }
  if (filter.kind) {
    clauses.push("kind = ?");
    values.push(filter.kind);
  }
  if (filter.layer) {
    clauses.push("layer = ?");
    values.push(filter.layer);
  }
  if (filter.outcome) {
    clauses.push("outcome = ?");
    values.push(filter.outcome);
  }
  if (filter.cause) {
    clauses.push("cause = ?");
    values.push(filter.cause);
  }
  if (Number.isFinite(filter.since)) {
    clauses.push("last_at >= ?");
    values.push(filter.since);
  }
  if (Number.isFinite(filter.until)) {
    clauses.push("at <= ?");
    values.push(filter.until);
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", values };
}

const COLUMNS = `id, at, last_at AS lastAt, kind, layer, surface, actor,
  op_id AS opId, card_id AS cardId, thread_id AS threadId, run_id AS runId,
  stage, outcome, cause, duration_ms AS durationMs, occurrences, detail`;

/** Rows newest first. `detail` is left as the stored JSON string; readers
 * decode it, because a row is evidence and not a presentation. */
export function listActionLog(db, filter = {}) {
  const where = whereClause(filter);
  const limit = Number.isFinite(filter.limit) && filter.limit > 0
    ? Math.min(Math.round(filter.limit), 5000)
    : ACTION_LOG_DEFAULT_LIMIT;
  // Newest ACTIVITY first, not newest birth: a heartbeat whose row was created
  // an hour ago but fired 40 seconds ago belongs at the top, and ordering by
  // `at` buried it under rows that started later and stopped.
  return db
    .prepare(`SELECT ${COLUMNS} FROM action_log ${where.sql} ORDER BY last_at DESC, rowid DESC LIMIT ?`)
    .all(...where.values, limit);
}

/** Counts per kind and outcome for the same filter, most frequent first. */
export function summarizeActionLog(db, filter = {}) {
  const where = whereClause(filter);
  return db
    .prepare(
      `SELECT kind, outcome, COUNT(*) AS rows, SUM(occurrences) AS events
       FROM action_log ${where.sql}
       GROUP BY kind, outcome ORDER BY events DESC`,
    )
    .all(...where.values);
}

/**
 * The retention pass. `bb stelow gc` owns the call; the log keeps what the
 * window and the row cap allow and reports how much it dropped, because a
 * silent truncation reads as "nothing happened".
 */
export function pruneActionLog(db, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const olderThanMs = Number.isFinite(options.olderThanMs)
    ? options.olderThanMs
    : 30 * 24 * 60 * 60 * 1000;
  const maxRows = Number.isFinite(options.maxRows) ? options.maxRows : 50000;
  const byAge = db.prepare("DELETE FROM action_log WHERE last_at < ?").run(now - olderThanMs);
  const total = db.prepare("SELECT COUNT(*) AS n FROM action_log").get().n;
  let byCap = 0;
  if (total > maxRows) {
    byCap = db
      .prepare(
        `DELETE FROM action_log WHERE id IN (
           SELECT id FROM action_log ORDER BY last_at ASC LIMIT ?
         )`,
      )
      .run(total - maxRows).changes ?? 0;
  }
  return {
    deleted: (byAge.changes ?? 0) + byCap,
    kept: Math.max(0, total - byCap),
  };
}

/**
 * `6h`, `7d`, `6w`, `30m` → milliseconds, or null. The same grammar BB's
 * `--since` accepts, so a reader does not learn two.
 */
export function parseSinceDuration(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d+)([mhdw])$/.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[match[2]];
  return amount * unit;
}

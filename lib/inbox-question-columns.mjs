/**
 * The question columns on an Inbox notification.
 *
 * Kept beside the event lifecycle rather than inside it: `inbox-events.mjs` owns
 * how an event moves through its states, and this owns one pair of columns and
 * the shape a caller fills them with.
 */
import { ensureColumns } from "./sqlite-columns.mjs";

/**
 * The question a question row is about, captured on the notification itself.
 *
 * A row used to carry only `QUESTION_WAITING_SUMMARY`, which is the same
 * sentence on every question row — so a person scanning the Inbox could not
 * tell WHICH ask a row was about without opening the card. The description's
 * collapsed line is the card's original request, not the question, so the
 * missing context was the question all along.
 *
 * It is stored rather than joined at read time because a LIVE ask has no
 * SQLite row: live questions exist only as host interactions, fetched async,
 * and the list path must stay bounded. The sync caller already holds them, so
 * it writes the line down once. A timed-out row's text is in
 * `expired_questions`, but capturing both the same way keeps one code path.
 *
 * Both columns are nullable on purpose: every row that predates them, and
 * every non-question row, reads null and falls back to the summary it already
 * had.
 */
export function ensureInboxQuestionColumns(db) {
  ensureColumns(db, "inbox_events", [
    ["question_summary", "TEXT"],
    ["question_count", "INTEGER"],
    ["question_kind", "TEXT"],
  ]);
}


/**
 * The two membership writes: rows whose key fell out of the open set are
 * resolved as superseded, and rows whose key came back are reopened.
 *
 * Extracted from `syncQuestionInboxEvents`, which was over the function budget
 * and whose real subject is the sync's outcome, not the SQL of each transition.
 */
export function resolveAndReopen(db, { cardId, keys, occurredAt }) {
  const SUPERSEDE = "UPDATE inbox_events SET resolved_at = COALESCE(resolved_at, ?), "
    + "resolved_reason = COALESCE(resolved_reason, 'superseded') "
    + "WHERE card_id = ? AND kind = 'question' AND resolved_at IS NULL";
  const unresolved = keys.length > 0
    ? db.prepare(`${SUPERSEDE} AND dedupe_key NOT IN (${keys.map(() => "?").join(",")})`)
      .run(occurredAt, cardId, ...keys).changes
    : db.prepare(SUPERSEDE).run(occurredAt, cardId).changes;
  const reopened = keys.length > 0
    ? db.prepare(
      `UPDATE inbox_events SET resolved_at = NULL, resolved_reason = NULL ` +
        `WHERE card_id = ? AND kind = 'question' AND archived_at IS NULL ` +
        `AND resolved_at IS NOT NULL AND dedupe_key IN (${keys.map(() => "?").join(",")})`,
    ).run(cardId, ...keys).changes
    : 0;
  return { unresolved, reopened };
}

/**
 * Mint one row per open key. `INSERT OR IGNORE` on the dedupe key is what makes
 * a re-poll idempotent, and it is also why a re-sync cannot churn a row's
 * captured question: the first capture wins.
 */
export function insertQuestionRows(db, { keys, cardId, summary, occurredAt, createId, questionSummary, questionCount, questionKind, insert }) {
  let inserted = 0;
  for (const dedupeKey of keys) {
    // `insert` is passed in rather than imported: the insert lives in the event
    // lifecycle module, and importing it here would make the two modules a
    // cycle (caught by `npm run architecture`).
    if (insert(db, {
      id: createId(),
      cardId,
      kind: "question",
      summary,
      dedupeKey,
      occurredAt,
      questionSummary,
      questionCount,
      questionKind,
    })) inserted += 1;
  }
  return inserted;
}


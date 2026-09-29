/**
 * The identity of a failure need, and how a repeat collapses onto it.
 *
 * Split out of inbox-events because it is a different question from "how does
 * an event row work". An event's identity is usually supplied by its caller;
 * a failure's identity is the card, because a worker that keeps falling over
 * is one thing to look at rather than one thing per fall.
 */
import { insertInboxEvent } from "./inbox-events.mjs";
import { stallCount } from "./worker-ledger.mjs";
import { scoreEventSeverity, SEVERITY_ACTION } from "./inbox-severity.mjs";
import { ensureColumns } from "./sqlite-columns.mjs";

/**
 * How many times this one need has recurred.
 *
 * This column exists because the repetition signal used to be a COUNT of open
 * error ROWS — so the only way to record a repeat was to append a second row,
 * and the count was therefore a measure of the duplication rather than of the
 * problem. Two identical failures eleven minutes apart showed a reader the same
 * card twice, each with its own timestamp, and a badge reading "error x2" that
 * was counting the rows it had just been caused to create. Collapsing the rows
 * without this column would have silently deleted the signal: one open row reads
 * as one occurrence however many times the worker actually fell over.
 *
 * Backfilled from the rows that exist, so history keeps the count it was
 * already showing rather than resetting to a flattering 1.
 */
export function ensureInboxOccurrencesColumn(db) {
  ensureColumns(db, "inbox_events", [["occurrences", "INTEGER NOT NULL DEFAULT 1"]]);
  // A card can still hold several open error rows from before the stable key.
  // Fold them onto the oldest so the count survives and the reader sees one.
  try {
    db.exec(`
      UPDATE inbox_events SET occurrences = (
        SELECT COUNT(*) FROM inbox_events d
        WHERE d.card_id = inbox_events.card_id AND d.kind = inbox_events.kind
          AND d.resolved_at IS NULL AND d.archived_at IS NULL
      )
      WHERE resolved_at IS NULL AND archived_at IS NULL AND occurrences = 1
        AND EXISTS (
          SELECT 1 FROM inbox_events d
          WHERE d.card_id = inbox_events.card_id AND d.kind = inbox_events.kind
            AND d.resolved_at IS NULL AND d.archived_at IS NULL
            AND d.rowid <> inbox_events.rowid
        )
    `);
  } catch { /* a pre-migration shape is the caller's problem, not the fold's */ }
}

/**
 * A card's failure need, identified by the card.
 *
 * The key used to end with the card's `updated_at`, which made it unique by
 * construction: a key containing the moment of the very event it exists to
 * collapse can never collide, so the UNIQUE index never fired and every failure
 * episode appended a row. Two identical failures eleven minutes apart became two
 * items in the reader's inbox, each claiming to be a separate thing.
 *
 * Identity here is the need, not the moment — the same shape the question key
 * uses, where the interaction is the identity and repeated syncs are idempotent.
 */
export function errorInboxDedupeKey(cardId) {
  return `error:${cardId}`;
}

/**
 * Record a failure need, collapsing a repeat onto what is already open.
 *
 * Three cases, because "collapse" and "swallow" are one keystroke apart:
 *  - an OPEN row for this card: bump its time and its count. One item, and its
 *    age is the age of the latest failure, not of the first.
 *  - a RESOLVED row with this key: reopen it. A worker that failed again after
 *    someone dealt with the last failure is a NEW need; INSERT OR IGNORE would
 *    have dropped it on the floor, which is the one outcome worse than a
 *    duplicate.
 *  - nothing: insert.
 */
export function recordErrorInboxEvent(db, event) {
  const key = errorInboxDedupeKey(event.cardId);
  const open = db.prepare(
    "SELECT id, occurrences FROM inbox_events WHERE dedupe_key = ? AND resolved_at IS NULL AND archived_at IS NULL",
  ).get(key);
  if (open) {
    const occurrences = (open.occurrences ?? 1) + 1;
    // Re-score on the bump: the repetition count is what moves a failure up the
    // queue, and it changed.
    let scored = { severity: SEVERITY_ACTION, reasons: [] };
    try {
      scored = scoreEventSeverity({ kind: "error", ageMs: 0, stallCount: stallCount(db, event.cardId), errorRepetitions: occurrences });
    } catch { /* advisory only */ }
    db.prepare(
      "UPDATE inbox_events SET occurred_at = ?, summary = ?, occurrences = ?, severity = ?, severity_reasons = ? WHERE id = ?",
    ).run(event.occurredAt, event.summary.slice(0, 500), occurrences, scored.severity, JSON.stringify(scored.reasons), open.id);
    return { id: open.id, outcome: "bumped", occurrences };
  }
  const resolved = db.prepare("SELECT id FROM inbox_events WHERE dedupe_key = ? LIMIT 1").get(key);
  const inserted = insertInboxEvent(db, { ...event, dedupeKey: key, occurrences: 1 });
  if (inserted) return { id: resolved?.id ?? null, outcome: "inserted", occurrences: 1 };
  // The key existed (a resolved row) and the insert was ignored. Reopen it
  // instead of leaving a failure nobody can see.
  const id = resolved?.id ?? null;
  if (id) {
    db.prepare(
      "UPDATE inbox_events SET resolved_at = NULL, resolved_reason = NULL, read_at = NULL, archived_at = NULL, occurred_at = ?, summary = ? WHERE id = ?",
    ).run(event.occurredAt, event.summary.slice(0, 500), id);
    return { id, outcome: "reopened", occurrences: 1 };
  }
  return { id: null, outcome: "ignored", occurrences: 1 };
}

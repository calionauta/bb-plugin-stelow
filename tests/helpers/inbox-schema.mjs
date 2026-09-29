import Database from "better-sqlite3";
import {
  ensureInboxResolvedReasonColumn,
  ensureInboxSeverityColumns,
} from "../../lib/inbox-events.mjs";
import { ensureInboxOccurrencesColumn } from "../../lib/inbox-error-event.mjs";

/**
 * The inbox table as it exists AFTER every migration, as one definition.
 *
 * Twelve tests used to hand-roll this table, and each addition of a column had
 * to be copied into every one of them. The cost was not the copying: it was that
 * the omission failed somewhere unrelated. Adding `occurrences` broke a
 * lifecycle test that has nothing to do with repetitions, days after the change
 * that caused it, and only on CI — where the local `npm test` had not been run
 * against a fresh checkout. A fixture that must be edited in N places to stay
 * correct is a fixture that will be wrong in one.
 *
 * This is the CURRENT shape. A test that deliberately exercises an older shape
 * (a migration, a legacy row) must NOT use it — that asymmetry is the point:
 * "old on purpose" should be written out, and everything else should not be
 * able to drift.
 */
export const INBOX_EVENTS_SCHEMA = `
  CREATE TABLE inbox_events (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    summary TEXT NOT NULL,
    dedupe_key TEXT NOT NULL UNIQUE,
    occurred_at INTEGER NOT NULL,
    read_at INTEGER,
    archived_at INTEGER,
    resolved_at INTEGER,
    resolved_reason TEXT,
    severity INTEGER NOT NULL DEFAULT 1,
    severity_reasons TEXT NOT NULL DEFAULT '[]',
    occurrences INTEGER NOT NULL DEFAULT 1,
    holder_card_id TEXT,
    holder_file TEXT,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  );
`;

export const CARDS_SCHEMA = "CREATE TABLE cards (id TEXT PRIMARY KEY);";

/**
 * A database with the cards table, the current inbox table, and every migration
 * applied — so a column added tomorrow is created here and nowhere else.
 */
export function inboxDatabase(extraSchema = "") {
  const db = new Database(":memory:");
  db.exec(CARDS_SCHEMA + INBOX_EVENTS_SCHEMA + extraSchema);
  ensureInboxResolvedReasonColumn(db);
  ensureInboxSeverityColumns(db);
  ensureInboxOccurrencesColumn(db);
  return db;
}

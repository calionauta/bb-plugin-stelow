import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { insertInboxEvent, listInboxEvents, resolveActionInboxEvents } from "../lib/inbox-events.mjs";

const db = new Database(":memory:");
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE cards (id TEXT PRIMARY KEY, display_name TEXT, name TEXT NOT NULL, project_id TEXT NOT NULL);
  CREATE TABLE inbox_events (
    id TEXT PRIMARY KEY, card_id TEXT NOT NULL, kind TEXT NOT NULL,
    summary TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, occurred_at INTEGER NOT NULL,
    read_at INTEGER, archived_at INTEGER, resolved_at INTEGER,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  );
`);
db.prepare("INSERT INTO cards VALUES (?, ?, ?, ?)").run("card_1", "Launch Inbox", "launch-inbox", "project_1");

const paused = { id: "evt_paused", cardId: "card_1", kind: "paused", summary: "Work paused.", dedupeKey: "paused:card_1:100", occurredAt: 100 };
assert.equal(insertInboxEvent(db, paused), true, "first lifecycle event is durable");
assert.equal(insertInboxEvent(db, { ...paused, id: "evt_duplicate" }), false, "repeated lifecycle polling cannot create duplicate alerts");
assert.equal(listInboxEvents(db, false).length, 1, "unresolved action is visible in Inbox");

assert.equal(resolveActionInboxEvents(db, "card_1", 200), 1, "resuming work resolves the pending action");
assert.equal(listInboxEvents(db, false).length, 0, "resolved action leaves the active Inbox");

const completed = { id: "evt_completed", cardId: "card_1", kind: "completed", summary: "Work completed.", dedupeKey: "completed:card_1:300", occurredAt: 300 };
assert.equal(insertInboxEvent(db, completed), true);
assert.equal(listInboxEvents(db, false)[0].id, "evt_completed", "completion remains a recent update after action resolution");

db.prepare("UPDATE inbox_events SET archived_at = ? WHERE id = ?").run(400, "evt_completed");
assert.equal(listInboxEvents(db, false).length, 0, "archived events are hidden from the active Inbox");
assert.equal(listInboxEvents(db, true).length, 2, "archive view retains the full durable history");
assert.equal(db.prepare("UPDATE inbox_events SET read_at = ? WHERE id = ? AND read_at IS NULL").run(401, "evt_completed").changes, 1, "read acknowledgement persists");
assert.equal(db.prepare("UPDATE inbox_events SET read_at = ? WHERE id = ? AND read_at IS NULL").run(402, "evt_completed").changes, 0, "read acknowledgement is idempotent");
assert.equal(db.prepare("UPDATE inbox_events SET archived_at = NULL WHERE id = ? AND archived_at IS NOT NULL").run("evt_completed").changes, 1, "archived notification can be restored");
assert.equal(listInboxEvents(db, false)[0].id, "evt_completed", "restored completion returns to recent updates");

db.prepare("DELETE FROM cards WHERE id = ?").run("card_1");
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inbox_events").get().count, 0, "deleting a card cascades to its Inbox history");

db.close();

const legacyDb = new Database(":memory:");
legacyDb.exec("CREATE TABLE inbox_events (id TEXT PRIMARY KEY, card_id TEXT NOT NULL, kind TEXT NOT NULL, summary TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, occurred_at INTEGER NOT NULL, read_at INTEGER, archived_at INTEGER)");
const legacyColumns = legacyDb.prepare("PRAGMA table_info(inbox_events)").all();
if (!legacyColumns.some((column) => column.name === "resolved_at")) legacyDb.exec("ALTER TABLE inbox_events ADD COLUMN resolved_at INTEGER");
assert.ok(legacyDb.prepare("PRAGMA table_info(inbox_events)").all().some((column) => column.name === "resolved_at"), "legacy Inbox databases gain the resolution column safely");
legacyDb.close();
console.log("inbox flows test ok: dedupe, resolve, completion, archive, and history visibility");

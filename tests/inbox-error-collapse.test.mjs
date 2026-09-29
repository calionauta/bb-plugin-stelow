import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  ensureInboxOccurrencesColumn,
  ensureInboxResolvedReasonColumn,
  ensureInboxSeverityColumns,
  errorInboxDedupeKey,
  recordErrorInboxEvent,
} from "../lib/inbox-events.mjs";

function schema() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE cards (id TEXT PRIMARY KEY);
    CREATE TABLE inbox_events (
      id TEXT PRIMARY KEY, card_id TEXT NOT NULL, kind TEXT NOT NULL,
      summary TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, occurred_at INTEGER NOT NULL,
      read_at INTEGER, archived_at INTEGER, resolved_at INTEGER, resolved_reason TEXT,
      severity INTEGER NOT NULL DEFAULT 1, severity_reasons TEXT NOT NULL DEFAULT '[]',
      holder_card_id TEXT, holder_file TEXT,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    );
  `);
  ensureInboxResolvedReasonColumn(db);
  ensureInboxSeverityColumns(db);
  ensureInboxOccurrencesColumn(db);
  db.prepare("INSERT INTO cards VALUES ('card-1')").run();
  db.prepare("INSERT INTO cards VALUES ('card-2')").run();
  return db;
}

const fail = (cardId, at, summary = "Worker failed.") => ({
  id: `evt-${at}`,
  cardId,
  kind: "error",
  summary,
  occurredAt: at,
});

const openErrors = (db, cardId) =>
  db.prepare(
    "SELECT id, dedupe_key, summary, occurred_at, occurrences FROM inbox_events "
    + "WHERE card_id = ? AND kind = 'error' AND resolved_at IS NULL ORDER BY occurred_at",
  ).all(cardId);

test("a repeat failure is one item with a count, not two items", () => {
  // The bug this file exists for: the key used to end with the card's
  // updated_at, so it was unique by construction, INSERT OR IGNORE never fired,
  // and a worker that failed twice showed the reader the same card twice.
  const db = schema();
  assert.equal(recordErrorInboxEvent(db, fail("card-1", 1000)).outcome, "inserted");
  const second = recordErrorInboxEvent(db, fail("card-1", 2000));

  assert.equal(second.outcome, "bumped");
  const rows = openErrors(db, "card-1");
  assert.equal(rows.length, 1, "one open error for the card, however many times it fell over");
  assert.equal(rows[0].occurrences, 2, "the repetition survives the collapse");
});

test("the collapsed row ages from the LATEST failure, not the first", () => {
  // The row is one need. Its age is how long that need has been outstanding as
  // of now, so a worker that just failed again must not read as a ten-hour-old
  // problem that happens to still be there.
  const db = schema();
  recordErrorInboxEvent(db, fail("card-1", 1000));
  recordErrorInboxEvent(db, fail("card-1", 2000));
  recordErrorInboxEvent(db, fail("card-1", 3000));

  const [row] = openErrors(db, "card-1");
  assert.equal(row.occurred_at, 3000);
  assert.equal(row.occurrences, 3);
});

test("the key identifies the need, not the moment", () => {
  assert.equal(errorInboxDedupeKey("card-1"), "error:card-1");
  assert.ok(!/\d{10,}/.test(errorInboxDedupeKey("card-1")),
    "a key carrying a timestamp can never collide, so it can never dedupe");
});

test("a failure after someone resolved the last one reopens instead of vanishing", () => {
  // The one outcome worse than a duplicate: INSERT OR IGNORE sees the key
  // already used, drops the insert, and the worker falls over with nothing in
  // anyone's inbox.
  const db = schema();
  recordErrorInboxEvent(db, fail("card-1", 1000));
  db.prepare("UPDATE inbox_events SET resolved_at = 1500, resolved_reason = 'answered' WHERE card_id = 'card-1'").run();

  const result = recordErrorInboxEvent(db, fail("card-1", 2000));
  assert.equal(result.outcome, "reopened");
  assert.equal(openErrors(db, "card-1").length, 1, "and it is open again");
  const [row] = openErrors(db, "card-1");
  assert.equal(row.occurred_at, 2000, "with the time of the new failure, not the old row's");
});

test("two cards keep separate errors — the collapse is per card, not global", () => {
  const db = schema();
  recordErrorInboxEvent(db, fail("card-1", 1000));
  recordErrorInboxEvent(db, fail("card-2", 1100));
  recordErrorInboxEvent(db, fail("card-1", 1200));

  assert.equal(openErrors(db, "card-1").length, 1);
  assert.equal(openErrors(db, "card-1")[0].occurrences, 2);
  assert.equal(openErrors(db, "card-2").length, 1);
  assert.equal(openErrors(db, "card-2")[0].occurrences, 1);
});

test("the summary follows the newest failure, so the text is never stale", () => {
  const db = schema();
  recordErrorInboxEvent(db, fail("card-1", 1000, "First reason."));
  recordErrorInboxEvent(db, fail("card-1", 2000, "Second, different reason."));
  assert.equal(openErrors(db, "card-1")[0].summary, "Second, different reason.");
});

test("rows that predate the stable key are folded, keeping the count they showed", () => {
  // Migration honesty: a host that already showed "error x2" must not wake up
  // showing a single occurrence and a flat severity, which would look like the
  // problem was fixed.
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE inbox_events (
      id TEXT PRIMARY KEY, card_id TEXT NOT NULL, kind TEXT NOT NULL,
      summary TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, occurred_at INTEGER NOT NULL,
      read_at INTEGER, archived_at INTEGER, resolved_at INTEGER,
      severity INTEGER NOT NULL DEFAULT 1, severity_reasons TEXT NOT NULL DEFAULT '[]'
    );
    INSERT INTO inbox_events (id, card_id, kind, summary, dedupe_key, occurred_at)
    VALUES ('a','card-1','error','same','error:card-1:1000',1000),
           ('b','card-1','error','same','error:card-1:2000',2000),
           ('c','card-2','error','same','error:card-2:1000',1000);
  `);
  ensureInboxOccurrencesColumn(db);

  const rows = db.prepare("SELECT card_id, occurrences FROM inbox_events ORDER BY id").all();
  assert.deepEqual(rows, [
    { card_id: "card-1", occurrences: 2 },
    { card_id: "card-1", occurrences: 2 },
    { card_id: "card-2", occurrences: 1 },
  ], "the folded card keeps the count it was already reporting; the lone one stays at 1");
});

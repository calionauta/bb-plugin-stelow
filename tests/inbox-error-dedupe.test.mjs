import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  ensureInboxOccurrencesColumn,
  errorInboxDedupeKey,
  recordErrorInboxEvent,
} from "../lib/inbox-error-event.mjs";

// The real rows from the reader's inbox, verbatim: a card holding the same
// failure twice because one row predates the stable key. `occurrences` was 2
// on BOTH, which is what made the old fold a no-op — it guarded on
// `occurrences = 1` and neither row qualified, so the duplicate survived
// every boot and the badge read `error ×2` while counting rows.
function ledger() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE inbox_events (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      summary TEXT NOT NULL,
      dedupe_key TEXT,
      occurred_at INTEGER NOT NULL,
      read_at INTEGER,
      resolved_at INTEGER,
      resolved_reason TEXT,
      archived_at INTEGER,
      occurrences INTEGER NOT NULL DEFAULT 1,
      severity TEXT,
      severity_reasons TEXT,
      holder_card_id TEXT,
      holder_name TEXT,
      holder_file TEXT
    );
  `);
  return db;
}

const insert = (db, row) => db.prepare(
  `INSERT INTO inbox_events (id, card_id, kind, summary, dedupe_key, occurred_at, occurrences)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
).run(row.id, row.cardId, "error", row.summary, row.dedupeKey, row.at, row.occurrences);

let n = 0;
const SUMMARY = "Workflow state ownership cannot be verified. Reseed this card.";
const OLD = `error:${"card_1fgz8lge"}:1790639117140`;
const NEW = errorInboxDedupeKey("card_1fgz8lge");

// The regression, exactly as it sat in the reader's inbox: two open rows for
// one need, one under the old timestamped key, both already counted.
{
  const db = ledger();
  insert(db, { id: "evt_4nw8yj8u", cardId: "card_1fgz8lge", summary: SUMMARY, dedupeKey: OLD, at: 1790639117140, occurrences: 2 });
  insert(db, { id: "evt_jg9mgnlj", cardId: "card_1fgz8lge", summary: SUMMARY, dedupeKey: NEW, at: 1790679190000, occurrences: 2 });

  ensureInboxOccurrencesColumn(db);

  const open = db.prepare(
    "SELECT id, dedupe_key, occurrences, occurred_at FROM inbox_events WHERE resolved_at IS NULL AND archived_at IS NULL",
  ).all();
  assert.equal(open.length, 1, `the reader sees one failure, not two (got ${open.length} rows)`);
  assert.equal(open[0].dedupe_key, NEW, "the survivor carries the stable key");
  // 2 + 2: the counts add, because the column carries RECURRENCES and a row
  // count here would silently reset a real repetition signal to 1.
  assert.equal(open[0].occurrences, 4, "the counts add, so no recurrence is erased");
  assert.equal(open[0].occurred_at, 1790679190000, "the survivor keeps the newest time — a failure is as old as its latest");
}

// Two rows under the OLD key alone: no stable row exists, and the fold must
// still leave exactly one, not zero and not two.
{
  const db = ledger();
  insert(db, { id: "evt_a", cardId: "card_x", summary: SUMMARY, dedupeKey: `error:card_x:1000`, at: 1000, occurrences: 1 });
  insert(db, { id: "evt_b", cardId: "card_x", summary: SUMMARY, dedupeKey: `error:card_x:2000`, at: 2000, occurrences: 3 });

  ensureInboxOccurrencesColumn(db);

  const open = db.prepare("SELECT * FROM inbox_events WHERE resolved_at IS NULL AND archived_at IS NULL").all();
  assert.equal(open.length, 1, "two legacy rows collapse to one");
  assert.equal(open[0].dedupe_key, errorInboxDedupeKey("card_x"), "and the survivor is renamed to the stable key");
  assert.equal(open[0].occurrences, 4, "1 + 3 recurrences");
}

// A single row must survive untouched, at its own count and time.
{
  const db = ledger();
  insert(db, { id: "evt_solo", cardId: "card_s", summary: SUMMARY, dedupeKey: NEW, at: 5000, occurrences: 1 });
  ensureInboxOccurrencesColumn(db);
  const open = db.prepare("SELECT * FROM inbox_events").all();
  assert.equal(open.length, 1);
  assert.equal(open[0].occurrences, 1, "a lone row keeps its count — the fold is not an event");
  assert.equal(open[0].occurred_at, 5000, "and keeps its time");
}

// Two CARDS must not fold together: the prefix is `error:<cardId>` and a card
// id is not a prefix of another card's key.
{
  const db = ledger();
  insert(db, { id: "evt_c1", cardId: "card_1", summary: SUMMARY, dedupeKey: "error:card_1:1000", at: 1000, occurrences: 2 });
  insert(db, { id: "evt_c12", cardId: "card_12", summary: SUMMARY, dedupeKey: "error:card_12:1000", at: 1000, occurrences: 2 });
  ensureInboxOccurrencesColumn(db);
  const open = db.prepare("SELECT card_id FROM inbox_events").all();
  assert.equal(open.length, 2, "card_1 and card_12 are different needs");
}

// A row on another KIND is a different need and must not be folded in.
{
  const db = ledger();
  insert(db, { id: "evt_err", cardId: "card_k", summary: SUMMARY, dedupeKey: "error:card_k", at: 1000, occurrences: 2 });
  db.prepare(
    `INSERT INTO inbox_events (id, card_id, kind, summary, dedupe_key, occurred_at, occurrences)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run("evt_q", "card_k", "question", "which one?", "question:card_k:1", 1000, 1);
  ensureInboxOccurrencesColumn(db);
  const kinds = db.prepare("SELECT kind FROM inbox_events ORDER BY kind").all().map((r) => r.kind);
  assert.deepEqual(kinds, ["error", "question"], "an error and a question are two needs");
}

// A resolved or archived row is history, not a duplicate to fold: the archive
// is the decision a person made about that row.
{
  const db = ledger();
  insert(db, { id: "evt_arch", cardId: "card_a", summary: SUMMARY, dedupeKey: "error:card_a:1000", at: 1000, occurrences: 1 });
  db.prepare("UPDATE inbox_events SET archived_at = 999 WHERE id = 'evt_arch'").run();
  insert(db, { id: "evt_live", cardId: "card_a", summary: SUMMARY, dedupeKey: NEW, at: 2000, occurrences: 1 });
  ensureInboxOccurrencesColumn(db);
  const open = db.prepare("SELECT id FROM inbox_events WHERE archived_at IS NULL").all();
  assert.deepEqual(open.map((r) => r.id), ["evt_live"], "an archived row stays archived and is not resurrected");
}

// The live path: a repeat must find the row an OLD key left behind instead of
// inserting beside it. This is the bug the prefix lookup closes.
//
// The fold above is deliberately NOT run first, because it would fix the
// duplicate before the lookup is ever reached — which is how a test for the
// lookup can pass while the lookup is still wrong.
{
  const db = ledger();
  insert(db, { id: "evt_legacy", cardId: "card_live", summary: SUMMARY, dedupeKey: `error:card_live:1000`, at: 1000, occurrences: 1 });
  const result = recordErrorInboxEvent(db, { id: `evt_new_${n++}`, kind: "error", cardId: "card_live", summary: SUMMARY, occurredAt: 2000 });
  assert.equal(result.outcome, "bumped", "a repeat bumps the legacy row instead of inserting a second one");
  const open = db.prepare("SELECT * FROM inbox_events WHERE resolved_at IS NULL AND archived_at IS NULL").all();
  assert.equal(open.length, 1, "one row, not two");
  assert.equal(open[0].occurrences, 2, "and the count advanced");
}

// The same, on the row the reader actually had: a legacy-key row that is
// ALREADY counted. With the old `occurrences = 1` guard, this row is invisible
// to the fold, so it reaches the lookup — and an exact-key lookup cannot see it
// either, because its key is not the one being written.
{
  const db = ledger();
  insert(db, { id: "evt_counted", cardId: "card_counted", summary: SUMMARY, dedupeKey: `error:card_counted:1000`, at: 1000, occurrences: 2 });
  const result = recordErrorInboxEvent(db, { id: `evt_new_${n++}`, kind: "error", cardId: "card_counted", summary: SUMMARY, occurredAt: 2000 });
  assert.equal(result.outcome, "bumped", "an already-counted legacy row is still the same open need");
  const open = db.prepare("SELECT * FROM inbox_events WHERE resolved_at IS NULL AND archived_at IS NULL").all();
  assert.equal(open.length, 1, "so no second row appears beside it");
  assert.equal(open[0].occurrences, 3, "and the real count keeps climbing");
}

// A repeat must never end in `ignored`. The docstring calls that outcome "the
// one worse than a duplicate" — a failure nobody can see — and it is reachable
// exactly when the open-row lookup misses a row that exists under another key:
// the INSERT is then refused by the unique index, and the failure vanishes
// instead of appearing twice.
{
  const db = ledger();
  insert(db, { id: "evt_gone", cardId: "card_gone", summary: SUMMARY, dedupeKey: `error:card_gone:1000`, at: 1000, occurrences: 1 });
  const result = recordErrorInboxEvent(db, { id: `evt_new_${n++}`, kind: "error", cardId: "card_gone", summary: SUMMARY, occurredAt: 2000 });
  assert.notEqual(result.outcome, "ignored", "a failure is never swallowed");
  assert.ok(result.id, "and the event it recorded has an id the card can link to");
}

// The reader's inbox, exactly: a card holding one open failure under the OLD
// timestamped key, and the worker fails again — this time under the stable key.
//
// The unique index is on the exact `dedupe_key`, so the two keys do not
// collide and the INSERT succeeds. That is the duplicate: a second row, with a
// second timestamp, for one need. The open-row lookup has to match the legacy
// row by PREFIX, because an exact-key lookup reads "nothing open" and inserts
// beside it. The fold cannot save this one — it runs at boot, and the second
// row is written after that, by a live worker.
{
  const db = ledger();
  insert(db, { id: "evt_legacy_only", cardId: "card_rp", summary: SUMMARY, dedupeKey: `error:card_rp:1790639117140`, at: 1790639117140, occurrences: 2 });
  recordErrorInboxEvent(db, { id: `evt_new_${n++}`, kind: "error", cardId: "card_rp", summary: SUMMARY, occurredAt: 1790679190000 });
  // The count of open rows is the thing the reader sees, so it is the thing
  // asserted — not the internal outcome name, which several different code
  // paths can legitimately produce for the same visible result.
  const open = db.prepare(
    "SELECT * FROM inbox_events WHERE resolved_at IS NULL AND archived_at IS NULL",
  ).all();
  assert.equal(open.length, 1, `one row for one need — the reader does not see it twice (got ${open.length})`);
  assert.equal(open[0].id, "evt_legacy_only", "and it is the row that was already there, not a new one");
  assert.equal(open[0].occurrences, 3, "with the count advancing");
}

console.log("inbox error dedupe test ok: legacy-key rows fold, counts add, cards and kinds stay apart");

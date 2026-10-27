import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { ensureActionLogTable, listActionLog, recordActionLog } from "../lib/action-log.mjs";
import { formatActionRows } from "../lib/action-replay.mjs";

// What a deduped row means when you read it back.
//
// The recorder folds a repeating condition into ONE row, so the row has two
// moments (first and last sighting) and a duration that must describe the worst
// occurrence rather than the one that happened to create it. Both are reading
// rules, not storage details: printing the first moment made a heartbeat that
// stopped an hour ago look alive, and freezing the duration made a 5.7 s pass
// read 12 ms. Split from action-log.test.mjs so each file stays a readable
// length.

function freshDb() {
  const db = new Database(":memory:");
  ensureActionLogTable(db);
  return db;
}

// ── dedupe keeps the WORST duration, never freezes the first ────────────────
{
  const db = freshDb();
  const base = 20_000_000;
  const repeated = { kind: "reconcile.tick", outcome: "ok", cause: "tick.heartbeat", cardId: "card_1" };

  recordActionLog(db, { ...repeated, at: base, durationMs: 5 });
  recordActionLog(db, { ...repeated, at: base + 1_000, durationMs: 900 });
  const third = recordActionLog(db, { ...repeated, at: base + 2_000, durationMs: 2 });

  assert.equal(third.occurrences, 3);
  const rows = listActionLog(db);
  assert.equal(rows.length, 1, "one condition is one row");
  assert.equal(rows[0].occurrences, 3);
  assert.equal(rows[0].durationMs, 900, "the row keeps the worst pass, not the one that created it");
  assert.equal(rows[0].at, base, "at is the first sighting");
  assert.equal(rows[0].lastAt, base + 2_000, "lastAt is the most recent sighting");
}

{
  const db = freshDb();
  const base = 30_000_000;
  const repeated = { kind: "reconcile.tick", outcome: "ok", cause: "tick.heartbeat", cardId: "card_1" };

  recordActionLog(db, { ...repeated, at: base, durationMs: 40 });
  recordActionLog(db, { ...repeated, at: base + 1_000 });
  assert.equal(
    listActionLog(db)[0].durationMs,
    40,
    "a repeat without a duration cannot erase the recorded max",
  );
}

{
  const db = freshDb();
  const base = 40_000_000;
  const repeated = { kind: "reconcile.tick", outcome: "ok", cause: "tick.heartbeat", cardId: "card_1" };

  recordActionLog(db, { ...repeated, at: base });
  recordActionLog(db, { ...repeated, at: base + 1_000, durationMs: 70 });
  assert.equal(
    listActionLog(db)[0].durationMs,
    70,
    "a row born without a duration adopts the first one it sees",
  );
}

// ── a folded row keeps the LATEST detail, while duration keeps the max ──────
{
  const db = freshDb();
  const base = 50_000_000;
  const repeated = { kind: "card.tick", outcome: "partial", cause: "card.tick", cardId: "card_1" };

  recordActionLog(db, { ...repeated, at: base, durationMs: 900, detail: { failed: ["a"] } });
  recordActionLog(db, { ...repeated, at: base + 1_000, durationMs: 20, detail: { failed: ["b"] } });

  const [row] = listActionLog(db);
  assert.equal(row.occurrences, 2, "one condition stays one row");
  assert.deepEqual(
    JSON.parse(row.detail),
    { failed: ["b"] },
    "the detail is the latest evidence: a phase failing now must not hide behind yesterday's list",
  );
  assert.equal(row.durationMs, 900, "duration still keeps the worst occurrence, not the latest");
  assert.equal(row.lastAt, base + 1_000, "lastAt names when the latest detail was seen");
}

// ── the list/--json shape carries both moments ──────────────────────────────
{
  const db = freshDb();
  const repeated = { kind: "rpc.call", outcome: "refused", cause: "rpc.validation", cardId: "card_1" };
  recordActionLog(db, { ...repeated, at: 7_000 });
  recordActionLog(db, { ...repeated, at: 8_000 });

  const [row] = listActionLog(db);
  assert.deepEqual(
    { at: row.at, lastAt: row.lastAt },
    { at: 7_000, lastAt: 8_000 },
    "the row a --json reader receives still names both sightings",
  );
}

// ── the list is ordered by last activity, not by birth ──────────────────────
{
  const db = freshDb();
  recordActionLog(db, { kind: "reconcile.tick", outcome: "ok", cause: "a", at: 1_000 });
  recordActionLog(db, { kind: "reconcile.tick", outcome: "ok", cause: "b", at: 3_000 });
  recordActionLog(db, { kind: "reconcile.tick", outcome: "ok", cause: "a", at: 5_000 });

  const rows = listActionLog(db);
  assert.deepEqual(
    rows.map((row) => row.cause),
    ["a", "b"],
    "A fired last even though B was born later",
  );
  assert.equal(rows[0].occurrences, 2);
  assert.equal(rows[0].at, 1_000, "A's birth stays the first sighting");
  assert.equal(rows[0].lastAt, 5_000, "A's last sighting is why it sorts first");
  assert.equal(rows[1].at, 3_000);
}

// ── the text form refuses to make a stopped condition look live ─────────────
{
  const at = Date.UTC(2026, 9, 27, 8, 12, 4);
  const lastAt = Date.UTC(2026, 9, 27, 9, 12, 4);
  const stamps = (text) => text.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g) ?? [];

  const single = formatActionRows([{ at, lastAt, occurrences: 1, outcome: "ok", kind: "rpc.call" }]);
  assert.equal(stamps(single).length, 1, "a one-off row prints one timestamp");
  assert.ok(!single.includes("→"), "a one-off row has no span to print");

  const repeated = formatActionRows([
    { at, lastAt, occurrences: 3, outcome: "refused", kind: "rpc.call", cause: "rpc.validation" },
  ]);
  assert.ok(
    repeated.includes("2026-10-27 08:12:04→2026-10-27 09:12:04"),
    "a repeated row prints first→last from at and lastAt",
  );
  assert.ok(repeated.includes("x3"), "and the count that makes the span worth reading");
  assert.equal(stamps(repeated).length, 2);
}

console.log("action log reading test ok: worst duration, latest detail, both moments, last-activity ordering, text form");

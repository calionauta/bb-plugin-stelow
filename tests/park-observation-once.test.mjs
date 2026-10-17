/**
 * The silent-stop sentence is written once per park, not once per trigger.
 *
 * Parking is decided by more than one path: a thread lifecycle event, the
 * startup reconcile, and a card-detail read all reach the sync, and a card
 * detail read is a read — it can happen at any moment, including the same tick
 * as the lifecycle event. Two of those seeing the same running→idle transition
 * wrote the same sentence twice on a real card, both stamped 09:54:11.
 *
 * The guard reads the comments table rather than an in-memory flag, so a plugin
 * reload does not start the duplication again. A faithful store: the stub
 * comment write inserts the row the guard then finds.
 */
import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";

import { persistStandardIdle } from "../server/runtime/build-thread-park.ts";
import { card } from "./helpers/build-thread-sync-harness.mjs";

function makeDb() {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE comments (id TEXT PRIMARY KEY, card_id TEXT, target TEXT, target_id TEXT, author TEXT, body TEXT, created_at INTEGER)",
  );
  return db;
}

function deps(db) {
  return {
    db,
    now: () => 1_700_000_000_000,
    getCard: () => undefined,
    logComment: (cardId, body) => {
      db.prepare("INSERT INTO comments VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(`cmt_${Math.random()}`, cardId, "card", cardId, "agent", body, 1);
    },
    updateCard: () => {},
    recordInbox: () => {},
    idleAttentionMs: 90_000,
  };
}

const row = card({
  status: "in-progress",
  stage: "shape",
  activity: "running",
  last_assistant_text: "same output",
  last_idle_text: "same output",
});
const snapshot = { card: row, lastOutput: "same output" };

function countParks(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM comments WHERE body LIKE 'Worker stopped with no new output%'").get().n;
}

test("a silent stop writes its sentence once, however many triggers see it", () => {
  const db = makeDb();
  persistStandardIdle(deps(db), snapshot, true, false);
  persistStandardIdle(deps(db), snapshot, true, false);
  persistStandardIdle(deps(db), snapshot, true, false);
  assert.equal(countParks(db), 1, "three triggers of one park leave one sentence on the trail");
});

test("a card that has not been parked yet still gets the sentence", () => {
  const db = makeDb();
  assert.equal(countParks(db), 0, "the trail starts empty");
  persistStandardIdle(deps(db), snapshot, true, false);
  assert.equal(countParks(db), 1, "the first park is still reported — the guard suppresses repeats, not the fact");
});

test("a card that made progress is not accused of stopping", () => {
  const db = makeDb();
  persistStandardIdle(deps(db), { card: row, lastOutput: "brand new output" }, true, false);
  assert.equal(countParks(db), 0, "a turn that produced something new is not a silent stop");
});

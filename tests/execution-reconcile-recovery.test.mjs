/**
 * A dead database handle must end the pass, never the process.
 *
 * On a plugin reload the host closes the old load's shared handle, and a
 * reconcile pass (or a surviving timer) from that load still holds it. The
 * first statement it touches throws `TypeError: The database connection is not
 * open`, and an unhandled rejection takes the whole BB server down with it.
 * These tests use real better-sqlite3 handles — a closed one throws the exact
 * production shape; a live empty one lets the pass prove it recovered.
 */
import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";

import { isDatabaseClosedError } from "../lib/sqlite-errors.mjs";
import { ensureExecutionRunTable } from "../lib/execution-run-ledger.mjs";
import { createExecutionReconcile } from "../server/execution-reconcile.ts";

function liveDb() {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE cards (id TEXT PRIMARY KEY, status TEXT, worker_thread_id TEXT)");
  ensureExecutionRunTable(db);
  return db;
}

function closedDb() {
  const db = new Database(":memory:");
  db.close();
  return db;
}

test("recognizes a dead handle and nothing else", () => {
  let closed = null;
  try {
    closedDb().prepare("SELECT id FROM cards").all();
  } catch (error) {
    closed = error;
  }
  assert.ok(closed, "a closed handle must throw");
  assert.equal(isDatabaseClosedError(closed), true);

  const live = liveDb();
  let missing = null;
  try {
    live.prepare("SELECT * FROM no_such_table").all();
  } catch (error) {
    missing = error;
  }
  assert.ok(missing, "a missing table must throw");
  assert.equal(
    isDatabaseClosedError(missing),
    false,
    "a bad query is a caller bug and must keep throwing",
  );
  assert.equal(isDatabaseClosedError(new TypeError("boom")), false);
  assert.equal(isDatabaseClosedError(null), false);
  assert.equal(isDatabaseClosedError(undefined), false);
  live.close();
});

test("a pass on a dead handle resolves and the next pass runs live", async () => {
  const live = liveDb();
  let resolutions = 0;
  const warnings = [];
  const bb = {
    storage: {
      database: () => {
        resolutions += 1;
        return live;
      },
    },
    log: { warn: (message) => warnings.push(String(message)) },
    sdk: { threads: { send: async () => {} } },
  };
  const { reconcile } = createExecutionReconcile({
    db: closedDb(),
    bb,
    now: Date.now,
    randomId: (prefix) => `${prefix}1`,
    getCard: () => undefined,
    cardWorkspace: async () => null,
    fetchPendingQuestions: async () => [],
    logComment: () => {},
    publishCard: () => {},
    native: {},
    lifecycle: { stopOwned: async () => true },
  });

  await reconcile();
  assert.ok(resolutions > 0, "recovery re-resolved a live handle");
  assert.ok(
    warnings.some((message) => message.includes("database handle was closed")),
    "the recovery names itself in the log instead of resolving silently",
  );
  await reconcile();
});

test("a non-database failure still rejects the pass", async () => {
  const live = liveDb();
  const bb = {
    storage: { database: () => live },
    sdk: { threads: { send: async () => {} } },
  };
  const broken = {
    prepare: () => {
      throw new Error("the query itself blew up");
    },
  };
  const { reconcile } = createExecutionReconcile({
    db: broken,
    bb,
    now: Date.now,
    randomId: (prefix) => `${prefix}1`,
    getCard: () => undefined,
    cardWorkspace: async () => null,
    fetchPendingQuestions: async () => [],
    logComment: () => {},
    publishCard: () => {},
    native: {},
    lifecycle: { stopOwned: async () => true },
  });
  await assert.rejects(reconcile, /the query itself blew up/);
  live.close();
});

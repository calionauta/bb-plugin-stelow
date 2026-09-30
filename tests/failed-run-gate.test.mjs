import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { blockingFailedRun, failedRunRefusal } from "../lib/failed-run-gate.mjs";
import { createExecutionRun, ensureExecutionRunTable } from "../lib/execution-run-ledger.mjs";

/**
 * A failed run holds the stage, and the hold has a door.
 *
 * card_cbnihg4c, 2026-09-30: the `scope-map` run failed with "the recipe
 * produced no task outputs" and its staging directory was empty, and the card
 * advanced to Tech planning anyway. `Failed · scope` then sat in Execution runs
 * while the card was two stages on, reading as a contradiction with no way to
 * tell whether the scope work had happened.
 *
 * The rule is on the NEWEST run for the STAGE. That is the whole design, and
 * it is what makes the hold survivable: a retry writes a newer run, so the hold
 * releases the moment the retry starts and re-tightens by itself if the retry
 * fails too. Nothing to clear, nothing to reconcile — where a rule keyed on
 * "a failed run exists" would need a way to delete the failed row, and nothing
 * in this plugin does that.
 */

function ledger() {
  const db = new Database(":memory:");
  // execution_runs carries a foreign key to cards, so the parent has to exist
  // before a run can be written at all.
  db.exec("CREATE TABLE cards (id TEXT PRIMARY KEY)");
  db.prepare("INSERT INTO cards (id) VALUES (?)").run("card_1");
  ensureExecutionRunTable(db);
  return db;
}

const run = (db, { id, stage = "scope", status = "failed", recipe = "scope-map", error = "no task outputs", at }) => {
  createExecutionRun(db, {
    id,
    cardId: "card_1",
    projectId: "project_1",
    recipeId: recipe,
    stage,
    sourceHash: "hash",
    sourceText: "source",
    argsText: "{}",
    adapter: "bb-workflows",
    workspaceId: "/project",
    artifactRoot: `/project/.stelow/runs/${id}`,
    originThreadId: "thread_1",
  });
  if (status !== "queued") {
    db.prepare("UPDATE execution_runs SET normalized_status = ?, error_code = ? WHERE id = ?")
      .run(status, error, id);
  }
  // An explicit created_at is how a test asks for a TIE, which is the only way
  // to exercise the tiebreak at all.
  if (at !== undefined) {
    db.prepare("UPDATE execution_runs SET created_at = ? WHERE id = ?").run(at, id);
  }
  return id;
};

test("a failed run at the card's stage holds the advance", () => {
  const db = ledger();
  run(db, { id: "exec_1" });
  const blocking = blockingFailedRun(db, "card_1", "scope");
  assert.equal(blocking?.id, "exec_1");
});

test("a run that succeeded does not hold anything", () => {
  const db = ledger();
  run(db, { id: "exec_1", status: "succeeded" });
  assert.equal(blockingFailedRun(db, "card_1", "scope"), null);
});

test("a failure at ANOTHER stage does not hold this one", () => {
  // The regression that a card-scoped rule would have shipped: a card that
  // failed a run three stages ago and has moved on cleanly would be blocked
  // forever at the stage it reached next.
  const db = ledger();
  run(db, { id: "exec_1", stage: "critique" });
  assert.equal(blockingFailedRun(db, "card_1", "scope"), null, "the stage is what the gate is about");
});

test("a newer successful run releases the hold — this is the door", () => {
  // The retry writes a NEWER run. The gate reads the newest run for the stage,
  // so the hold lifts the moment a retry lands, and there is no failed row to
  // delete for it to stay lifted.
  const db = ledger();
  run(db, { id: "exec_old", status: "failed" });
  assert.ok(blockingFailedRun(db, "card_1", "scope"), "the first failure holds");

  // A retry is a fresh run at the same stage, started by the same launch rule.
  run(db, { id: "exec_new", status: "succeeded" });
  assert.equal(blockingFailedRun(db, "card_1", "scope"), null, "the retry released it");
});

test("a retry that fails again re-tightens the hold by itself", () => {
  // Without this, a card could be nudged past a stage by a retry that did no
  // better — the hold would be a one-shot warning rather than a rule.
  //
  // The two runs are given the SAME created_at on purpose. That is the case the
  // `rowid DESC` tiebreak exists for, and leaving it to chance is what made this
  // test flaky: with real timestamps the two runs land in different
  // milliseconds, `created_at DESC` alone already orders them correctly, and the
  // mutation "drop the tiebreak" then passes four times out of five. A test that
  // catches a bug by luck is a test that will eventually ship it.
  const db = ledger();
  run(db, { id: "exec_1", status: "failed", at: 1_000 });
  run(db, { id: "exec_2", status: "failed", at: 1_000 });
  assert.equal(
    blockingFailedRun(db, "card_1", "scope")?.id,
    "exec_2",
    "with equal timestamps, the newest INSERTED run is the one that speaks",
  );
});

test("the tiebreak is what resolves an equal-timestamp tie", () => {
  // Named separately so that dropping `rowid DESC` fails a test whose entire
  // subject IS the tiebreak, rather than one that also asserts things it would
  // pass anyway.
  const db = ledger();
  run(db, { id: "exec_first", status: "failed", at: 5_000 });
  run(db, { id: "exec_second", status: "failed", at: 5_000 });
  assert.equal(blockingFailedRun(db, "card_1", "scope")?.id, "exec_second");
});

test("a live run at the stage is not a failed run", () => {
  // While a run is working the card is progressing, not stuck; refusing an
  // advance because work is IN FLIGHT would be a hold for the wrong reason.
  const db = ledger();
  run(db, { id: "exec_1", status: "running" });
  assert.equal(blockingFailedRun(db, "card_1", "scope"), null);
});

test("the refusal names the door, and the row it points at", () => {
  // A refusal with no exit is a deadlock with a good error message, so this
  // sentence has to carry the action that releases it AND the run id, or the
  // reader is sent looking for a row they cannot identify.
  const db = ledger();
  run(db, { id: "exec_1", error: "the recipe produced no task outputs" });
  const refusal = failedRunRefusal(blockingFailedRun(db, "card_1", "scope"));
  assert.match(refusal, /Retry run/, "the refusal names the action that releases the hold");
  assert.match(refusal, /exec_1/, "and the run it is talking about");
  assert.match(refusal, /the recipe produced no task outputs/, "and the host's own reason");
  assert.match(refusal, /scope-map/, "and which recipe failed");
});

test("a failure with no recorded reason is still a usable sentence", () => {
  const db = ledger();
  run(db, { id: "exec_1", error: null });
  const refusal = failedRunRefusal(blockingFailedRun(db, "card_1", "scope"));
  assert.match(refusal, /no reason/i, "an absent reason is stated, not invented");
  assert.match(refusal, /Retry run/);
});

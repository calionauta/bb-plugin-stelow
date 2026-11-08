import assert from "node:assert/strict";
import test from "node:test";
import { createRunReconciler } from "../server/execution-reconcile-run.ts";
import {
  createExecutionRun,
  getExecutionRun,
  listExecutionRuns,
} from "../lib/execution-run-ledger.mjs";
import { EMPTY_OUTPUT_ERROR } from "../lib/transient-run-retry.mjs";
import { executionRunDb } from "./helpers/execution-run-harness.mjs";

/**
 * The reconciler retries a proven no-op instead of parking on it.
 *
 * This is the wiring the unit tests on either side cannot see: the policy
 * (`transient-run-retry`) and the attempt (`execution-auto-retry`) both pass
 * alone while `reconcileSimpleState` never calls the attempt, and the card
 * parks exactly like card_a9q5zhzd did. Remove the call and the first test
 * fails; break either side and their own suites fail.
 */

function seedRunningRun(db, id = "exec_1") {
  createExecutionRun(db, {
    id,
    cardId: "card_1",
    projectId: "project_1",
    recipeId: "scope-map",
    stage: "scope",
    sourceHash: "hash",
    sourceText: "source",
    argsText: "{}",
    adapter: "bb-workflows",
    workspaceId: "/project",
    artifactRoot: `/project/.stelow/runs/${id}`,
    originThreadId: "thread_1",
  });
  db.prepare("UPDATE execution_runs SET normalized_status='running', run_id='wfr_1' WHERE id=?").run(id);
}

function stubNative(db, { scriptError = EMPTY_OUTPUT_ERROR, startError = null } = {}) {
  let counter = 0;
  return {
    adapterFor: () => ({
      // The production adapter folds the script's own answer into the status
      // before this point (scriptOutcome): succeeded + {} arrives here as
      // failed with the empty-output reason.
      status: async () => ({ state: "failed", scriptError }),
    }),
    startNativeStageForCard: async (_card, recipeId, _context, stage) => {
      if (startError) return { ok: false, run: null, error: startError };
      counter += 1;
      const id = `exec_auto_${counter}`;
      createExecutionRun(db, {
        id,
        cardId: "card_1",
        projectId: "project_1",
        recipeId,
        stage,
        sourceHash: "hash",
        sourceText: "source",
        argsText: "{}",
        adapter: "bb-workflows",
        workspaceId: "/project",
        artifactRoot: `/project/.stelow/runs/${id}`,
        originThreadId: "thread_1",
      });
      return { ok: true, run: getExecutionRun(db, id), error: null };
    },
  };
}

function wireReconciler(db, native, cardOverrides = {}) {
  const comments = [];
  const published = [];
  const reconciler = createRunReconciler({
    db,
    now: () => 1_000_000,
    getCard: () => ({
      id: "card_1",
      project_id: "project_1",
      prompt: "Build it",
      status: "in-progress",
      stage: "scope",
      worker_thread_id: "thread_1",
      ...cardOverrides,
    }),
    logComment: (cardId, targetId, body) => comments.push([targetId, body]),
    publishCard: (cardId) => published.push(cardId),
    native,
    dispatch: { reconcileBoundary: async () => {}, reconcileArtifacts: async () => {} },
  });
  return { reconciler, comments, published };
}

function harness(options = {}) {
  const { cardOverrides, ...nativeOptions } = options;
  const db = executionRunDb("card_1");
  seedRunningRun(db);
  const native = stubNative(db, nativeOptions);
  return { db, native, ...wireReconciler(db, native, cardOverrides) };
}

function markRunning(db, id, runId = "wfr_new") {
  db.prepare("UPDATE execution_runs SET normalized_status='running', run_id=? WHERE id=?").run(runId, id);
}

test("a reconciled empty-output failure leaves a retry running, not a parked card", async () => {
  const h = harness();
  await h.reconciler.reconcileOne("exec_1");

  const failed = getExecutionRun(h.db, "exec_1");
  assert.equal(failed.normalizedStatus, "failed");
  assert.equal(failed.errorCode, EMPTY_OUTPUT_ERROR);

  const runs = listExecutionRuns(h.db, "card_1");
  assert.equal(runs.length, 2, "the retry is a NEWER row; the failed row is history, never rewritten");
  const retry = runs.find((run) => run.id !== "exec_1");
  assert.equal(retry.recipeId, "scope-map");
  assert.equal(retry.stage, "scope");
  assert.equal(retry.autoRetryCount, 1, "the retry carries the spent budget forward");

  const comment = h.comments.find(([targetId]) => targetId === retry.id);
  assert.ok(comment, "the trail says the host retried, not the user");
  assert.match(comment[1], /automatically/);
  assert.ok(h.published.includes("card_1"), "the card repaints with the retry on it");
});

test("a retry that no-ops again parks instead of chaining", async () => {
  const h = harness();
  await h.reconciler.reconcileOne("exec_1");
  const retry = listExecutionRuns(h.db, "card_1").find((run) => run.id !== "exec_1");
  markRunning(h.db, retry.id);

  await h.reconciler.reconcileOne(retry.id);
  assert.equal(
    listExecutionRuns(h.db, "card_1").length,
    2,
    "the second consecutive no-op spends no further attempt",
  );
  assert.equal(getExecutionRun(h.db, retry.id).normalizedStatus, "failed");
});

test("a reconciled recipe-logic failure parks with no retry row", async () => {
  const h = harness({ scriptError: "the recipe script reported a failure" });
  await h.reconciler.reconcileOne("exec_1");
  assert.equal(listExecutionRuns(h.db, "card_1").length, 1, "a run that did work is never retried alone");
  assert.equal(getExecutionRun(h.db, "exec_1").normalizedStatus, "failed");
});

test("a refused retry stays parked and does not fail the pass", async () => {
  const h = harness({ startError: "This card already owns an active execution run." });
  await h.reconciler.reconcileOne("exec_1");
  assert.equal(listExecutionRuns(h.db, "card_1").length, 1);
  assert.equal(getExecutionRun(h.db, "exec_1").normalizedStatus, "failed");
});

test("an archived card stays parked through reconcile", async () => {
  const h = harness({ cardOverrides: { status: "archived" } });
  await h.reconciler.reconcileOne("exec_1");
  assert.equal(listExecutionRuns(h.db, "card_1").length, 1, "reconcile never launches for an archived card");
});

test("a card that moved on stays parked through reconcile", async () => {
  const h = harness({ cardOverrides: { stage: "interface" } });
  await h.reconciler.reconcileOne("exec_1");
  assert.equal(listExecutionRuns(h.db, "card_1").length, 1, "reconcile never re-runs a stage the card left");
});

console.log("execution reconcile auto retry test ok: the reconciler retries a proven no-op once, then parks");

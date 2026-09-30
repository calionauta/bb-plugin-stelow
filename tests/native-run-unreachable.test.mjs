import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  NATIVE_UNREACHABLE_MS,
  createRunReconciler,
} from "../server/execution-reconcile-run.ts";
import {
  getExecutionRun,
  createExecutionRun,
  ensureExecutionRunTable,
} from "../lib/execution-run-ledger.mjs";
import { keepsCardRunning } from "../lib/native-run.mjs";

/**
 * The wedge this closes was introduced by the liveness fix and is the exact
 * shape of bug that fix was written to remove.
 *
 * `keepsCardRunning` says a live run keeps its card running, and the sync now
 * obeys it: a card whose run is live is never nudged, never parked, and never
 * spends auto-continue budget. That is correct while the ledger is true. But
 * the ledger is written in exactly one place — `reconcileOne` — and its failure
 * path returned an error and changed nothing. So a run whose host went away
 * stayed `running` in the database forever, and the liveness rule, faithfully
 * reading a stale row, held the card as "the run is working now" indefinitely.
 *
 * No button, no inbox row, no park: a wedge wearing the costume of a fix.
 *
 * The repair is where the lie is told, not where it is believed. A host that
 * cannot be asked opens a decaying window; a host that answers closes it; a
 * window that never closes fails the run, which is a state the card can show,
 * the stage gate can hold on, and Retry can act on. `keepsCardRunning` needs no
 * change, because a failed run is not a live run.
 */

function harness({ answering = false, now = 1_000_000 } = {}) {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE cards (id TEXT PRIMARY KEY)");
  db.prepare("INSERT INTO cards (id) VALUES (?)").run("card_1");
  ensureExecutionRunTable(db);
  createExecutionRun(db, {
    id: "exec_1",
    cardId: "card_1",
    projectId: "project_1",
    recipeId: "planning-research",
    stage: "planning",
    sourceHash: "hash",
    sourceText: "source",
    argsText: "{}",
    adapter: "bb-workflows",
    workspaceId: "/project",
    artifactRoot: "/project/.stelow/runs/exec_1",
    originThreadId: "thread_1",
  });
  db.prepare("UPDATE execution_runs SET normalized_status='running', run_id='wfr_1' WHERE id='exec_1'").run();

  const comments = [];
  const clock = { value: now };
  // The host's answerability is a SWITCH, not a constructor argument: "a blip
  // must not accumulate" is a test about one host changing its mind mid-window,
  // and a harness that can only be built one way cannot express it.
  const host = { answering };
  const reconciler = createRunReconciler({
    db,
    now: () => clock.value,
    getCard: () => ({ id: "card_1", worker_thread_id: "thread_1" }),
    logComment: (cardId, targetId, body) => comments.push([targetId, body]),
    publishCard: () => {},
    native: {
      adapterFor: () => ({
        status: async () => {
          if (!host.answering) throw new Error("host is unreachable");
          return { state: "running" };
        },
      }),
    },
    dispatch: { reconcileBoundary: async () => {}, reconcileArtifacts: async () => {} },
  });
  return { db, reconciler, comments, clock, host };
}

const live = (db) => [getExecutionRun(db, "exec_1")].map((run) => ({
  id: run.id,
  normalizedStatus: run.normalizedStatus,
  recipeId: run.recipeId,
  stage: run.stage,
}));

test("a host that answers leaves the run live", async () => {
  const h = harness({ answering: true });
  await h.reconciler.reconcileOne("exec_1");
  assert.equal(getExecutionRun(h.db, "exec_1").normalizedStatus, "running");
  assert.equal(getExecutionRun(h.db, "exec_1").reconcileFailedAt, null, "no window is open");
});

test("one unanswerable poll does not fail a healthy run", async () => {
  // The bound is a recovery path, not a latency budget. Failing on the first
  // blip would kill workflows that are working perfectly.
  const h = harness();
  await h.reconciler.reconcileOne("exec_1");
  assert.equal(getExecutionRun(h.db, "exec_1").normalizedStatus, "running");
  assert.ok(getExecutionRun(h.db, "exec_1").reconcileFailedAt, "but the window is open");
});

test("a host that never answers eventually fails the run", async () => {
  const h = harness();
  await h.reconciler.reconcileOne("exec_1");
  h.clock.value += NATIVE_UNREACHABLE_MS + 1;
  await h.reconciler.reconcileOne("exec_1");

  const run = getExecutionRun(h.db, "exec_1");
  assert.equal(run.normalizedStatus, "failed", "a run nobody can ask about is not a run working");
  assert.match(run.errorCode, /stopped answering/);
});

test("a failed run stops holding its card — the wedge, closed", async () => {
  // The whole point. Before this, the liveness rule read a row that never
  // changed and held the card as running forever, with no button and no row.
  const h = harness();
  assert.equal(keepsCardRunning(live(h.db), 0), true, "the run is live to begin with");

  await h.reconciler.reconcileOne("exec_1");
  h.clock.value += NATIVE_UNREACHABLE_MS + 1;
  await h.reconciler.reconcileOne("exec_1");

  assert.equal(
    keepsCardRunning(live(h.db), 0),
    false,
    "the card is released once the run is failed, so the ordinary idle path applies again",
  );
});

test("a host that answers again closes the window", async () => {
  // A blip must not accumulate. Ten minutes of silence means ten minutes of
  // SILENCE, not ten minutes since the run started — which is also why a plugin
  // restart cannot condemn a healthy long-running workflow.
  const h = harness();
  await h.reconciler.reconcileOne("exec_1");
  assert.ok(getExecutionRun(h.db, "exec_1").reconcileFailedAt, "the window opened");

  h.clock.value += NATIVE_UNREACHABLE_MS - 1;
  h.host.answering = true;
  await h.reconciler.reconcileOne("exec_1");
  assert.equal(getExecutionRun(h.db, "exec_1").reconcileFailedAt, null, "an answered poll closes it");

  h.clock.value += NATIVE_UNREACHABLE_MS * 2;
  await h.reconciler.reconcileOne("exec_1");
  assert.equal(
    getExecutionRun(h.db, "exec_1").normalizedStatus,
    "running",
    "a long healthy run is not condemned by its own age",
  );
});

test("the failure is recorded on the card, and names the door", async () => {
  // Every destructive or background operation leaves an openable record.
  const h = harness();
  await h.reconciler.reconcileOne("exec_1");
  h.clock.value += NATIVE_UNREACHABLE_MS + 1;
  await h.reconciler.reconcileOne("exec_1");

  const comment = h.comments.find(([targetId]) => targetId === "exec_1");
  assert.ok(comment, "the card's trail says why its run died");
  assert.match(comment[1], /stopped answering/);
  assert.match(comment[1], /Retry run/, "and names the action that brings it back");
});

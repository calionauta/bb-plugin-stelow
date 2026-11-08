import assert from "node:assert/strict";
import test from "node:test";
import { createRetryRunCommand } from "../server/runtime/cli/cli-retry-run.ts";
import { retryExecutionRun } from "../server/execution-lifecycle-retry.ts";
import { createExecutionRun } from "../lib/execution-run-ledger.mjs";
import { executionRunDb } from "./helpers/execution-run-harness.mjs";
import { cliHarness } from "./helpers/cli-harness.mjs";

/**
 * The worker's own Retry button.
 *
 * The failed-run hold names "Retry run" as its door, but the only hand on
 * that door was the human's UI button: no `bb stelow` verb reached the
 * lifecycle retrier, so a worker told "retry" could only yield and wait for
 * a host retry that does not exist (card_a9q5zhzd did exactly that after its
 * owner answered "Retry scope-map run"). This verb runs the SAME retrier
 * through the SAME refusals — plus one the UI never needs: a worker retries
 * only its own card's runs.
 */

const CARD = { id: "card_1", stage: "scope", worker_thread_id: "thr_1" };

function seed() {
  const db = executionRunDb("card_1");
  createExecutionRun(db, {
    id: "exec_1",
    cardId: "card_1",
    projectId: "project_1",
    recipeId: "scope-map",
    stage: "scope",
    sourceHash: "hash",
    sourceText: "source",
    argsText: "{}",
    adapter: "bb-workflows",
    workspaceId: "/project",
    artifactRoot: "/project/.stelow/runs/exec_1",
    originThreadId: "thr_1",
  });
  return db;
}

function deps(db, { card = CARD, retry = null } = {}) {
  const calls = [];
  return {
    calls,
    db,
    getCardByWorkerThread: () => card,
    retryExecutionRun: async (args) => {
      calls.push(args);
      return retry ?? { ok: true, runId: "exec_new", error: null };
    },
  };
}

const run = (d, argv, threadId = "thr_1") => createRetryRunCommand(d)(argv, { threadId });

test("a worker retries its own failed run through the lifecycle retrier", async () => {
  const d = deps(seed());
  const result = await run(d, ["retry-run", "--run", "exec_1"]);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(d.calls, [{ runId: "exec_1" }], "the verb carries the named run to the retrier, nothing else");
  assert.match(result.stdout, /exec_new/, "the new run id is what the worker follows next");
  assert.match(result.stdout, /exec_1/, "and the trail names the run it replaces");
});

test("a missing --run flag is usage, not a refusal", async () => {
  const d = deps(seed());
  const result = await run(d, ["retry-run"]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /Usage: bb stelow retry-run/);
  assert.deepEqual(d.calls, [], "usage launches nothing");
});

test("an unknown run id is refused before anything launches", async () => {
  const d = deps(seed());
  const result = await run(d, ["retry-run", "--run", "exec_missing"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /not found/);
  assert.deepEqual(d.calls, []);
});

test("a run from another card is refused", async () => {
  // The UI button cannot be pressed from the wrong card; a CLI verb can be
  // invoked from any thread, so ownership is checked here, not trusted.
  const d = deps(seed());
  d.getCardByWorkerThread = () => ({ id: "card_2", stage: "scope", worker_thread_id: "thr_2" });
  const result = await run(d, ["retry-run", "--run", "exec_1"], "thr_2");
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /another card/);
  assert.deepEqual(d.calls, [], "a foreign run never reaches the retrier");
});

test("no worker thread in context is refused", async () => {
  const d = deps(seed());
  const result = await createRetryRunCommand(d)(["retry-run", "--run", "exec_1"], {});
  assert.equal(result.exitCode, 2);
  assert.deepEqual(d.calls, []);
});

test("a retrier refusal is reported, not swallowed", async () => {
  const d = deps(seed(), { retry: { ok: false, runId: null, error: "This card already owns an active execution run." } });
  const result = await run(d, ["retry-run", "--run", "exec_1"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /already owns an active execution run/);
});

test("a throwing retrier stays a refusal, never a crash", async () => {
  const d = deps(seed());
  d.retryExecutionRun = async () => { throw new Error("boom"); };
  const result = await run(d, ["retry-run", "--run", "exec_1"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /boom/);
});

test("other verbs are not claimed", async () => {
  const d = deps(seed());
  assert.equal(await createRetryRunCommand(d)(["advance", "scope"], { threadId: "thr_1" }), null);
});

test("the dispatcher routes retry-run to this family", async () => {
  // Unit tests above prove the family; this proves the verb table contains
  // it — the original gap was precisely "no bb stelow verb reached the
  // retrier", and a family without a table row is that gap again.
  const h = cliHarness({
    rows: {
      execution_runs: {
        id: "exec_1", card_id: "card_1", project_id: "proj_1", run_id: "wfr_1",
        recipe_id: "scope-map", stage: "scope", normalized_status: "failed",
      },
    },
  });
  // Injected, not harnessed: the shared helper stays at budget, and the
  // dispatcher closes over the same deps object, so this is the seam the
  // composition root fills in production.
  h.deps.retryExecutionRun = async (args) => {
    h.calls.push(["retryExecutionRun", args]);
    return { ok: true, runId: "exec_new", error: null };
  };
  const result = await h.invoke(["retry-run", "--run", "exec_1"]);
  assert.equal(result.exitCode, 0, "the real dispatcher table routes the verb");
  const retried = h.calls.filter(([entry]) => entry === "retryExecutionRun");
  assert.deepEqual(retried, [["retryExecutionRun", { runId: "exec_1" }]], "through to the lifecycle retrier");
});

test("the dispatcher sends unknown verbs elsewhere", async () => {
  const h = cliHarness();
  const result = await h.invoke(["frobnicate"]);
  assert.ok(!h.calls.some(([entry]) => entry === "retryExecutionRun"), "unknown verbs never touch the retrier");
  assert.notEqual(result, null, "and something answers (the unknown-command result)");
});

// The CLI owns one refusal (foreign cards); every other refusal belongs to
// the lifecycle retrier. These run the REAL retrier so the division is
// proven, not declared: an archived card and a live run must surface the
// retrier's own words through the verb.
function liveDeps(db, card, native) {
  return {
    db,
    getCardByWorkerThread: () => card,
    retryExecutionRun: (args) => retryReal(db, card, native, args),
  };
}

async function retryReal(db, card, native, { runId }) {
  const comments = [];
  const published = [];
  return retryExecutionRun({
    db,
    getCard: () => card,
    native,
    logComment: (cardId, targetId, body) => comments.push([cardId, targetId, body]),
    publishCard: (cardId) => published.push(cardId),
  }, runId);
}

const liveNative = (db) => ({
  startNativeStageForCard: async (card, recipeId, context, stage) => {
    createExecutionRun(db, {
      id: "exec_live_new",
      cardId: card.id,
      projectId: "project_1",
      recipeId,
      stage,
      sourceHash: "hash",
      sourceText: "source",
      argsText: "{}",
      adapter: "bb-workflows",
      workspaceId: "/project",
      artifactRoot: "/project/.stelow/runs/exec_live_new",
      originThreadId: "thr_1",
    });
    return { ok: true, run: { id: "exec_live_new", runId: "wfr_new" }, error: null };
  },
});

function seedStatus(db, status) {
  db.prepare("UPDATE execution_runs SET normalized_status = ? WHERE id = 'exec_1'").run(status);
}

test("an archived card surfaces the retrier's refusal through the verb", async () => {
  const db = seed();
  seedStatus(db, "failed");
  const d = liveDeps(db, { ...CARD, status: "archived" }, liveNative(db));
  const result = await run(d, ["retry-run", "--run", "exec_1"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /archived/, "the retrier's words, not the CLI's");
});

test("a live run surfaces the retrier's refusal through the verb", async () => {
  const db = seed();
  seedStatus(db, "running");
  const d = liveDeps(db, CARD, liveNative(db));
  const result = await run(d, ["retry-run", "--run", "exec_1"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /still working/, "a run that is working has nothing to retry");
});

test("a failed run retries end to end through the verb", async () => {
  const db = seed();
  seedStatus(db, "failed");
  const d = liveDeps(db, CARD, liveNative(db));
  const result = await run(d, ["retry-run", "--run", "exec_1"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /exec_live_new/, "the real retrier launched a real row");
});

console.log("runtime cli retry run test ok: the worker retries its own runs through the same retrier");

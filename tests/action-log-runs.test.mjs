/**
 * The run lifecycle rows: a start is a start, and a finish is a finish.
 *
 * Found by the first audit pass over `action_log`: every simple-state move the
 * reconciler made was written as `run.finished`, so a queued run the host
 * reported as `running` left a finished row with `outcome: "error"` before the
 * run had done anything, and the real result left a second one. Two false
 * errors in a single card is not a logging detail — it makes the one question
 * the log exists to answer ("how often does a run fail?") unanswerable.
 *
 * What is pinned here is the seam, not the writer: `reconcileOne` is driven
 * with a queued ledger row and a host answer, and the assertions read the
 * entries the recorder was actually handed. The collecting recorder validates
 * each entry against the closed vocabulary in `lib/action-kinds.mjs`, so a kind
 * emitted at the call site but missing from the catalog fails here instead of
 * vanishing silently through the runtime recorder (which catches the refusal).
 *
 * The answers a single native poll can take from `queued`:
 *
 *   running    -> `run.started` (ok), and NOT `run.finished`
 *   failed     -> `run.finished` (error) with `run.failed` or `run.no-reason`
 *   succeeded  -> `run.finished` (ok) with no payload
 *   cancelled  -> `run.finished` (skipped)
 *
 * The `run.no-reason` half of the failure pair is red on the branch that
 * introduced `run.started`: `failureReason` turns a missing `scriptError` into
 * the sentence "the host reported a failure without a reason", and the writer
 * then tests that sentence for truthiness before choosing its cause, so the
 * empty-reason branch is unreachable. The assertion says where, because a red
 * test that does not name its defect gets "fixed" by deleting it.
 *
 * `succeeded` from `queued` settles in ONE call: `applyNativeState` walks the
 * legal `queued -> running -> succeeded` path before recording, precisely
 * because forcing the illegal direct transition threw into the catch and
 * silently stopped settling rows. The start it crosses on the way is internal
 * bookkeeping and emits no `run.started` — the assertions below say so
 * explicitly so the absence is a decision on record, not an oversight.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { isActionCause, isActionKind, isActionOutcome } from "../lib/action-kinds.mjs";
import { createExecutionRun, getExecutionRun } from "../lib/execution-run-ledger.mjs";
import { executionRunDb } from "./helpers/execution-run-harness.mjs";
import { reconcileOne } from "../server/execution-reconcile-run.ts";

const CARD = {
  id: "card-1",
  project_id: "project-1",
  prompt: "Audit the thing",
  status: "in-progress",
  stage: "audit",
  worker_thread_id: "thread-1",
};

const RUN_INPUT = {
  cardId: CARD.id,
  projectId: CARD.project_id,
  recipeId: "execution-audit",
  stage: CARD.stage,
  sourceHash: "sha256:abc",
  sourceText: "return { state: 'succeeded' };",
  argsText: "{}",
  adapter: "bb-workflows",
  workspaceId: "workspace-1",
  artifactRoot: "workspace-1/.stelow/run",
  originThreadId: CARD.worker_thread_id,
};

/**
 * The recorder the runtime would build, minus the database: every entry is kept
 * verbatim (a real recorder folds repeats into `occurrences`, which would hide
 * a doubled `run.finished`) and checked against the catalog the writer must
 * obey.
 */
function collectingActions() {
  const entries = [];
  const vocabularyErrors = [];
  return {
    entries,
    vocabularyErrors,
    enabled: true,
    record(entry) {
      if (!isActionKind(entry.kind)) vocabularyErrors.push(`undeclared kind ${entry.kind}`);
      else if (!isActionOutcome(entry.outcome)) vocabularyErrors.push(`refused outcome ${entry.outcome}`);
      else if (entry.cause != null && !isActionCause(entry.cause)) {
        vocabularyErrors.push(`refused cause ${entry.cause}`);
      }
      entries.push(entry);
      return { id: `act_${entries.length}`, occurrences: 1, deduped: false };
    },
    list: () => [],
    summarize: () => [],
    prune: () => ({ deleted: 0, kept: 0 }),
  };
}

/** One queued run holding a native handle: the row the fixed launch leaves before the host answers. */
function queuedRun(db, id = "local-1") {
  return createExecutionRun(db, { ...RUN_INPUT, id, runId: `native-${id}`, now: 100 });
}

function harness(hostStatus) {
  const db = executionRunDb(CARD.id);
  const run = queuedRun(db);
  const actions = collectingActions();
  const deps = {
    db,
    now: () => 1_000,
    getCard: () => CARD,
    logComment: () => {},
    publishCard: () => {},
    native: {
      adapterFor: () => ({ status: async () => hostStatus }),
      startNativeStageForCard: async () => ({ ok: false, run: null }),
    },
    dispatch: { reconcileBoundary: async () => {}, reconcileArtifacts: async () => {} },
    actions,
  };
  return { db, run, actions, deps };
}

/** Reconcile, and prove the pass did not fall into the unreachable path or emit a bad row. */
async function reconcile(h) {
  const result = await reconcileOne(h.deps, h.run.id);
  assert.equal(result.error, null, `the pass failed instead of reconciling: ${result.error}`);
  assert.deepEqual(h.actions.vocabularyErrors, [], "every row must use the declared action-log vocabulary");
  return result;
}

function rowsOfKind(actions, kind) {
  return actions.entries.filter((entry) => entry.kind === kind);
}

test("a queued run the host reports as running records one run.started and no run.finished", async () => {
  const h = harness({ state: "running" });

  await reconcile(h);

  assert.equal(getExecutionRun(h.db, h.run.id).normalizedStatus, "running");
  const started = rowsOfKind(h.actions, "run.started");
  assert.equal(started.length, 1, "a transition into running is exactly one start row");
  assert.equal(started[0].outcome, "ok");
  assert.equal(started[0].cardId, CARD.id);
  assert.equal(started[0].runId, h.run.id, "the row names the ledger run, not the host's handle");
  assert.equal(started[0].stage, "audit");
  assert.deepEqual(started[0].detail, { recipe: "execution-audit" });
  assert.equal(
    rowsOfKind(h.actions, "run.finished").length,
    0,
    "starting is not finishing: the bug logged a false error at the moment a run began",
  );
});

test("a failed run with a script error records run.finished error caused by run.failed", async () => {
  const h = harness({ state: "failed", scriptError: "boom" });

  await reconcile(h);

  const finished = rowsOfKind(h.actions, "run.finished");
  assert.equal(finished.length, 1, "one host answer settles exactly one finished row");
  assert.equal(finished[0].outcome, "error");
  assert.equal(finished[0].cause, "run.failed");
  assert.equal(finished[0].cardId, CARD.id);
  assert.equal(finished[0].runId, h.run.id);
  assert.equal(finished[0].detail.state, "failed");
  assert.equal(finished[0].detail.native?.scriptError, "boom", "the host's own words travel with the row");
  assert.equal(getExecutionRun(h.db, h.run.id).errorCode, "boom");
  assert.equal(rowsOfKind(h.actions, "run.started").length, 0, "a run that failed did not start in this pass");
});

test("a failure the host did not explain is countable as run.no-reason", async () => {
  const h = harness({ state: "failed" });

  await reconcile(h);

  const finished = rowsOfKind(h.actions, "run.finished");
  assert.equal(finished.length, 1);
  assert.equal(finished[0].outcome, "error");
  assert.equal(finished[0].cause, "run.no-reason", "a gap in the REASON is countable, not a gap in the state "
    + "(server/execution-reconcile-run.ts:272 reads the fallback sentence as a reason, so this cause is unreachable)");
  assert.equal(
    finished[0].detail.errorCode,
    "the host reported a failure without a reason",
    "the row stores the honest sentence the run now carries",
  );
  assert.equal(
    finished[0].detail.native?.scriptError,
    undefined,
    "no reason is invented for the payload the host never sent",
  );
  assert.equal(getExecutionRun(h.db, h.run.id).normalizedStatus, "failed");
});

test("a run the host reports as succeeded records run.finished ok and no run.started", async () => {
  const h = harness({ state: "succeeded" });

  await reconcile(h);

  const row = getExecutionRun(h.db, h.run.id);
  assert.equal(row.normalizedStatus, "succeeded");
  assert.equal(row.nativeStatus, "succeeded", "the native column agrees with the normalized one");
  const finished = rowsOfKind(h.actions, "run.finished");
  assert.equal(finished.length, 1, "the queued -> succeeded path settles in one pass, not one row per hop");
  assert.equal(finished[0].outcome, "ok");
  assert.equal(finished[0].cause, null);
  assert.equal(finished[0].cardId, CARD.id);
  assert.equal(finished[0].runId, h.run.id);
  assert.equal(finished[0].detail.state, "succeeded");
  assert.equal(finished[0].detail.native, undefined, "a successful finish carries no failure payload");
  assert.equal(
    rowsOfKind(h.actions, "run.started").length,
    0,
    "the internal queued -> running hop of the success path is bookkeeping, not a logged start",
  );
});

test("a cancelled run records run.finished skipped with no cause", async () => {
  const h = harness({ state: "cancelled" });

  await reconcile(h);

  assert.equal(getExecutionRun(h.db, h.run.id).normalizedStatus, "cancelled");
  const finished = rowsOfKind(h.actions, "run.finished");
  assert.equal(finished.length, 1);
  assert.equal(finished[0].outcome, "skipped", "a person cancelling is a decision, not an error");
  assert.equal(finished[0].cause, null);
  assert.equal(finished[0].cardId, CARD.id);
  assert.equal(finished[0].runId, h.run.id);
  assert.equal(finished[0].detail.state, "cancelled");
  assert.equal(rowsOfKind(h.actions, "run.started").length, 0);
});

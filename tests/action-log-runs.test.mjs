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
 * with a live ledger row and a host answer, and the assertions read the entries
 * the recorder was actually handed. The collecting recorder validates each
 * entry against the closed vocabulary in `lib/action-kinds.mjs`, so a kind
 * emitted at the call site but missing from the catalog fails here instead of
 * vanishing silently through the runtime recorder (which catches the refusal).
 *
 * The rule that came out of the audit, and the shape of everything below: the
 * LAUNCH records `run.started` — it is the one moment every run passes through,
 * including the ones whose first observed state is already terminal — and the
 * reconciler records `run.finished` once, when a host answer settles the row.
 * An observation of `running` is a status update, not an event: it logs nothing
 * at all, so a polling loop cannot manufacture rows.
 *
 * The answers one native poll can take from a live row:
 *
 *   running    -> no row at all (the launch already recorded the start)
 *   failed     -> `run.finished` (error) with `run.failed` or `run.no-reason`
 *   succeeded  -> `run.finished` (ok) with no payload
 *   cancelled  -> `run.finished` (skipped)
 *
 * A run with no native handle settles as `run.start-timeout` once the 60s
 * startup window passes: a row that waits forever is a card pinned as
 * "starting" by a host that is never coming back.
 *
 * The `run.no-reason` half of the failure pair is red on the branch that
 * introduced `run.started`: `failureReason` turns a missing `scriptError` into
 * the sentence "the host reported a failure without a reason", and the writer
 * then tests that sentence for truthiness before choosing its cause, so the
 * empty-reason branch is unreachable. The assertion says where, because a red
 * test that does not name its defect gets "fixed" by deleting it.
 *
 * `succeeded` from `queued` settles in ONE call: `applyNativeState` walks the
 * legal `queued -> running -> succeeded` path before recording, because forcing
 * the illegal direct transition threw into the catch and silently stopped
 * settling rows. The start it crosses is bookkeeping and emits no
 * `run.started` — asserted below, so the absence is a decision on record.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { isActionCause, isActionKind, isActionOutcome } from "../lib/action-kinds.mjs";
import {
  createExecutionRun,
  getExecutionRun,
  transitionExecutionRun,
} from "../lib/execution-run-ledger.mjs";
import { executionRunDb } from "./helpers/execution-run-harness.mjs";
import { reconcileOne } from "../server/execution-reconcile-run.ts";
import { createNativeLauncher } from "../server/execution-native-launch.ts";

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

/** The reconciler's dependency slice over one in-memory ledger. */
function depsFor(db, actions, hostStatus) {
  return {
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
}

/** One queued run holding a native handle: the row the fixed launch leaves before the host answers. */
function queuedRun(db, id = "local-1") {
  return createExecutionRun(db, { ...RUN_INPUT, id, runId: `native-${id}`, now: 100 });
}

function harness(hostStatus) {
  const db = executionRunDb(CARD.id);
  const run = queuedRun(db);
  const actions = collectingActions();
  return { db, run, actions, deps: depsFor(db, actions, hostStatus) };
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

test("observing a run as running records nothing: the launch owns the start row", async () => {
  const h = harness({ state: "running" });

  await reconcile(h);

  assert.equal(getExecutionRun(h.db, h.run.id).normalizedStatus, "running");
  assert.equal(
    rowsOfKind(h.actions, "run.started").length,
    0,
    "a poll that sees progress did not start the run: recording here would double the launch's own row",
  );
  assert.equal(rowsOfKind(h.actions, "run.finished").length, 0, "running is not finishing");
  assert.deepEqual(h.actions.entries, [], "a status update that changes nothing is not an event");
});

test("a run that never got a native handle is finished once, as a start timeout", async () => {
  const db = executionRunDb(CARD.id);
  // 120s before the clock this pass reads: past the 60s startup window, with no
  // host handle to poll because the launch never returned one.
  const run = createExecutionRun(db, { ...RUN_INPUT, id: "local-start-timeout", now: 1_000 - 120_000 });
  const actions = collectingActions();
  const h = { db, run, actions, deps: depsFor(db, actions, { state: "running" }) };

  await reconcile(h);

  const row = getExecutionRun(h.db, h.run.id);
  assert.equal(row.normalizedStatus, "failed", "a run nobody can watch does not stay queued forever");
  assert.equal(row.errorCode, "native-start-timeout", "the row names the window it missed");
  const finished = rowsOfKind(h.actions, "run.finished");
  assert.equal(finished.length, 1, "one silent startup is one terminal fact, not one per poll");
  assert.equal(finished[0].outcome, "error");
  assert.equal(finished[0].cause, "run.start-timeout");
  assert.equal(finished[0].cardId, CARD.id);
  assert.equal(finished[0].runId, h.run.id);
  assert.equal(finished[0].detail.state, "start-timeout");
  assert.equal(
    finished[0].detail.native.state,
    "start-timeout",
    "the payload names the outcome that happened, not a host state that never arrived",
  );
  assert.equal(rowsOfKind(h.actions, "run.started").length, 0, "nothing started, so nothing may claim it did");
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

test("reconciling a settled run twice records one finish, because the second pass is the terminal early return", async () => {
  const db = executionRunDb(CARD.id);
  // `running`, not `queued`: this is the row shape a real poll settles, and the
  // one the old writer could reach repeatedly and record on every entry.
  const created = createExecutionRun(db, { ...RUN_INPUT, id: "local-settled", runId: "native-settled", now: 100 });
  const run = transitionExecutionRun(db, created.id, "running", { nativeStatus: "running" });
  const actions = collectingActions();
  const h = { db, run, actions, deps: depsFor(db, actions, { state: "succeeded" }) };

  await reconcile(h);
  assert.equal(rowsOfKind(h.actions, "run.finished").length, 1, "the first pass settles the row and records it");
  await reconcile(h);

  const finished = rowsOfKind(h.actions, "run.finished");
  assert.equal(finished.length, 1, "the second pass adds no second finish: the row is terminal, so nothing is re-recorded");
  assert.equal(finished[0].outcome, "ok");
  assert.equal(finished[0].cause, null);
  assert.equal(getExecutionRun(db, run.id).normalizedStatus, "succeeded");
  assert.deepEqual(h.actions.vocabularyErrors, []);
});

test("a host that reports succeeded while a card question is open records no finish at all", async () => {
  // The duplicate-finish question was asked about this shape — `needs_input`
  // with a host already done — and this row never settles here: a run still
  // holding an open question is asking one, not finishing, so it records
  // nothing and stays answerable by a person. The duplicate case above is the
  // settle path; this is the guard that keeps a poll from closing the boundary.
  const db = executionRunDb(CARD.id);
  const created = createExecutionRun(db, { ...RUN_INPUT, id: "local-needs-input", runId: "native-wait", now: 100 });
  const run = transitionExecutionRun(db, created.id, "needs_input", { nativeStatus: "needs_input" });
  const actions = collectingActions();
  const h = { db, run, actions, deps: depsFor(db, actions, { state: "succeeded" }) };

  await reconcile(h);
  await reconcile(h);

  const row = getExecutionRun(db, run.id);
  assert.equal(row.normalizedStatus, "needs_input", "a host success does not answer the question on the card");
  assert.equal(rowsOfKind(h.actions, "run.finished").length, 0, "an open question keeps the run unsettled, so no finish is recorded");
  assert.deepEqual(h.actions.entries, []);
});

/**
 * The launch rule with the host and the staging taken out: `prepareStart` hands
 * back a run that is already staged, `adapterFor` is the host's own dispatch,
 * and `bb.sdk.threads.send` is the pause-note (fire-and-forget, so it only has
 * to resolve). Everything that matters here — the slot claim, the ledger row,
 * the recorder call — is the real implementation.
 */
const PREPARED_START = {
  recipe: { id: "execution-audit" },
  stage: { id: "audit" },
  stateDir: null,
  workspacePath: "/workspace",
  artifactRoot: "/workspace/.stelow/runs/exec-1",
  source: "return { state: 'running' };",
  sourceHash: "sha256:abc",
  args: { localRunId: "exec-1", recipeId: "execution-audit", context: {} },
};

function launchHarness(adapterRun) {
  const db = executionRunDb(CARD.id);
  const actions = collectingActions();
  const deps = {
    db,
    actions,
    bb: { sdk: { threads: { send: async () => ({}) } } },
    adapterFor: () => ({ run: adapterRun }),
    prepareStart: async () => ({ prepared: PREPARED_START }),
  };
  return { db, actions, deps };
}

function launch(h) {
  return createNativeLauncher(h.deps).startNativeStageForCard(
    CARD,
    "execution-audit",
    { prompt: CARD.prompt },
    "audit",
  );
}

test("a successful launch records exactly one run.started and no run.finished", async () => {
  const h = launchHarness(async () => ({ state: "running", runId: "native-1" }));

  const result = await launch(h);

  assert.equal(result.ok, true, `the launch refused instead of starting: ${result.error}`);
  assert.deepEqual(h.actions.vocabularyErrors, []);
  assert.equal(getExecutionRun(h.db, result.run.id).normalizedStatus, "running");
  const started = rowsOfKind(h.actions, "run.started");
  assert.equal(started.length, 1, "a launch is exactly one start row, recorded where every run passes");
  assert.equal(started[0].outcome, "ok");
  assert.equal(started[0].cardId, CARD.id);
  assert.equal(started[0].runId, result.run.id, "the row names the ledger run, not the host's handle");
  assert.equal(started[0].stage, "audit");
  assert.deepEqual(started[0].detail, { recipe: "execution-audit" });
  assert.equal(rowsOfKind(h.actions, "run.finished").length, 0, "a dispatch the host accepted is not a run finished");
});

test("a launch whose adapter throws records one run.finished error caused by run.start-failed", async () => {
  const h = launchHarness(async () => {
    throw new Error("host exploded");
  });

  const result = await launch(h);

  assert.equal(result.ok, false, "a launch the host rejected is reported as a refusal");
  assert.equal(result.error, "host exploded", "the caller still carries the host's own words");
  assert.equal(getExecutionRun(h.db, result.run.id).normalizedStatus, "failed");
  const finished = rowsOfKind(h.actions, "run.finished");
  assert.equal(finished.length, 1, "one failed dispatch is one finish, not a start and a finish");
  assert.equal(finished[0].outcome, "error");
  assert.equal(finished[0].cause, "run.start-failed");
  assert.equal(finished[0].cardId, CARD.id);
  assert.equal(finished[0].runId, result.run.id);
  assert.equal(finished[0].stage, "audit");
  assert.equal(
    finished[0].detail.error,
    "host exploded",
    "the host's message travels with the row, so the log is investigable",
  );
  assert.equal(rowsOfKind(h.actions, "run.started").length, 0, "a run the host refused to start never started");
  assert.deepEqual(h.actions.vocabularyErrors, []);
});

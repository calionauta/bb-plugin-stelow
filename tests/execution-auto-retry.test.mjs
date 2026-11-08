import assert from "node:assert/strict";
import test from "node:test";
import { attemptAutoRetry } from "../server/execution-auto-retry.ts";
import {
  createExecutionRun,
  getExecutionRun,
} from "../lib/execution-run-ledger.mjs";
import { EMPTY_OUTPUT_ERROR } from "../lib/transient-run-retry.mjs";
import { executionRunDb } from "./helpers/execution-run-harness.mjs";

/**
 * The host retries a proven no-op before anyone is asked to wait.
 *
 * `shouldAutoRetryRun` decides WHETHER; this decides whether the attempt
 * actually happens and leaves the ledger and the trail telling the truth: a
 * new run carrying the spent budget, a comment naming both runs, and a
 * republished card. Every refusal below must launch nothing — a guard that
 * refuses in the result but still dispatches re-runs an old stage over work
 * the card has since done, or loops a systemic dispatch failure.
 */

const card = (overrides = {}) => ({
  id: "card_1",
  project_id: "project_1",
  name: "Useful",
  display_name: null,
  prompt: "Build it",
  intent: "feature",
  status: "in-progress",
  stage: "scope",
  activity: "running",
  worker_thread_id: "thread_1",
  worker_preset_id: null,
  preset_restart_pending: 0,
  dir_hash: null,
  auto_continue_count: null,
  auto_continue_stage: null,
  spawn_retry_count: null,
  spawn_retry_thread: null,
  attachments: "[]",
  workspace_kind: "project",
  workspace_path: null,
  workspace_host_id: null,
  kind: "build",
  research_strategy: null,
  research_strategies: null,
  explore_stage: null,
  last_error: null,
  last_assistant_text: null,
  last_idle_at: null,
  environment_label: null,
  created_at: 1,
  updated_at: 2,
  ...overrides,
});

function seed(db, { id = "exec_1", stage = "scope", errorCode = EMPTY_OUTPUT_ERROR, autoRetryCount = 0 } = {}) {
  createExecutionRun(db, {
    id,
    cardId: "card_1",
    projectId: "project_1",
    recipeId: "scope-map",
    stage,
    sourceHash: "hash",
    sourceText: "source",
    argsText: "{}",
    adapter: "bb-workflows",
    workspaceId: "/project",
    artifactRoot: `/project/.stelow/runs/${id}`,
    originThreadId: "thread_1",
    autoRetryCount,
  });
  db.prepare("UPDATE execution_runs SET normalized_status = 'failed', error_code = ? WHERE id = ?")
    .run(errorCode, id);
  return getExecutionRun(db, id);
}

function deps(db, current, options = {}) {
  const comments = [];
  const started = [];
  const published = [];
  return {
    calls: comments,
    started,
    published,
    db,
    getCard: () => current,
    logComment: (cardId, targetId, body) => comments.push([cardId, targetId, body]),
    publishCard: (cardId) => published.push(cardId),
    native: {
      startNativeStageForCard: async (c, recipeId, context, expectedStage) => {
        started.push({ recipeId, stage: expectedStage, prompt: context.prompt });
        if (options.launchError) return { ok: false, run: null, error: options.launchError };
        // Like the real launcher, the row exists before the result returns, so
        // the budget stamp below has a row to land on.
        createExecutionRun(db, {
          id: "exec_new",
          cardId: "card_1",
          projectId: "project_1",
          recipeId,
          stage: expectedStage,
          sourceHash: "hash",
          sourceText: "source",
          argsText: "{}",
          adapter: "bb-workflows",
          workspaceId: "/project",
          artifactRoot: "/project/.stelow/runs/exec_new",
          originThreadId: "thread_1",
        });
        return { ok: true, run: getExecutionRun(db, "exec_new"), error: null };
      },
    },
  };
}

test("a proven no-op is retried through the same launch rule a manual retry uses", async () => {
  const db = executionRunDb("card_1");
  const failed = seed(db);
  const d = deps(db, card());
  const result = await attemptAutoRetry(d, failed);
  assert.equal(result.retried, true);
  assert.equal(result.runId, "exec_new");
  assert.deepEqual(d.started, [{ recipeId: "scope-map", stage: "scope", prompt: "Build it" }]);
  assert.equal(
    getExecutionRun(db, "exec_new").autoRetryCount,
    1,
    "the new run carries the spent budget, so a second consecutive no-op parks",
  );
  assert.equal(getExecutionRun(db, "exec_1").normalizedStatus, "failed", "the failed row is left untouched");
});

test("the retry is traceable from the card", async () => {
  const db = executionRunDb("card_1");
  const failed = seed(db);
  const d = deps(db, card());
  await attemptAutoRetry(d, failed);
  const comment = d.calls.find(([, targetId]) => targetId === "exec_new");
  assert.ok(comment, "the retry leaves an openable record, not a bare state change");
  assert.match(comment[2], /automatically/, "and says it was the host, not a person");
  assert.match(comment[2], /exec_1/, "naming the run it follows");
  assert.deepEqual(d.published, ["card_1"], "and the card is republished, so the list repaints");
});

test("a spent budget launches nothing, and says why", async () => {
  const db = executionRunDb("card_1");
  const failed = seed(db, { autoRetryCount: 1 });
  const d = deps(db, card());
  const result = await attemptAutoRetry(d, failed);
  assert.equal(result.retried, false);
  assert.deepEqual(d.started, [], "a second consecutive no-op parks instead of looping");
  // This assertion used to require NO trail comment, and that is the defect this
  // file's change exists to fix: a card that parks silently is indistinguishable
  // from a card nothing was ever wrong with. Five real runs refused on this exact
  // guard and recorded nothing, so `auto_retry_count` read 0 across the fleet.
  const record = d.calls.find(([, targetId]) => targetId === "exec_1");
  assert.ok(record, "the refusal leaves an openable record — parking silently is a phantom wait");
  assert.match(record[2], /did NOT retry/, "and says the retry did not happen");
  assert.match(record[2], /retry-budget-spent/, "naming the reason");
  assert.match(record[2], /Retry run stays available/, "and naming the exit, so the reader has a door");
  assert.deepEqual(d.published, ["card_1"], "and the card repaints so the record is visible");
});

test("a failure that ran work launches nothing", async () => {
  const db = executionRunDb("card_1");
  const failed = seed(db, { errorCode: "the host stopped answering about this run" });
  const d = deps(db, card());
  const result = await attemptAutoRetry(d, failed);
  assert.equal(result.retried, false, "an unreachable run may still be working — retrying would fork it");
  assert.deepEqual(d.started, []);
});

test("no other failure retries at attempt level either", async () => {
  // The policy unit pins the full exclusion list; this pins that the attempt
  // honors it end to end — launch AND side channels. An implementation that
  // parked the launch but still logged "automatically retried" would read as
  // a retry on the card while changing nothing.
  for (const errorCode of [
    "native-start-failed",
    "native-start-timeout",
    "the recipe script reported a failure",
    "the host reported a failure without a reason",
    null,
    "",
    "  ",
  ]) {
    const db = executionRunDb("card_1");
    const failed = seed(db, { errorCode });
    const d = deps(db, card());
    const result = await attemptAutoRetry(d, failed);
    assert.equal(result.retried, false, JSON.stringify(errorCode));
    assert.deepEqual(d.started, [], JSON.stringify(errorCode));
    assert.deepEqual(d.calls, [], `no trail comment for ${JSON.stringify(errorCode)}`);
    assert.deepEqual(d.published, [], `no republish for ${JSON.stringify(errorCode)}`);
  }
});

test("a missing card launches nothing and does not throw", async () => {
  const db = executionRunDb("card_1");
  const failed = seed(db);
  const d = deps(db, card());
  d.getCard = () => undefined;
  const result = await attemptAutoRetry(d, failed);
  assert.equal(result.retried, false);
  assert.deepEqual(d.started, []);
  // Silence is CORRECT here and it is the only place it is: there is no card to
  // write a trail comment on, so "cannot record" is not "chose not to".
  assert.deepEqual(d.calls, [], "a card that no longer exists has nowhere to record a refusal");
  assert.deepEqual(d.published, []);
});

test("a card that moved on launches nothing", async () => {
  const db = executionRunDb("card_1");
  const failed = seed(db, { stage: "scope" });
  const d = deps(db, card({ stage: "interface" }));
  const result = await attemptAutoRetry(d, failed);
  assert.equal(result.retried, false, "re-running the old stage would overwrite work done since");
  assert.deepEqual(d.started, []);
  // The guard that silently refused five real runs, measured: every no-op failure
  // in the live database arrived here with the card already on a later stage, so
  // this refusal fired five times and recorded nothing. It records now.
  const record = d.calls.find(([, targetId]) => targetId === "exec_1");
  assert.ok(record, "the refusal leaves a record — this is the guard that failed five real runs in silence");
  assert.match(record[2], /card-moved-on/, "naming the reason: the card advanced past the failed stage");
  assert.match(record[2], /interface/, "and naming where the card actually is, so the reader understands why nothing ran");
  assert.deepEqual(d.published, ["card_1"], "and the card repaints");
});

test("an archived card launches nothing, and the refusal is on the record", async () => {
  const db = executionRunDb("card_1");
  const failed = seed(db);
  const d = deps(db, card({ status: "archived" }));
  const result = await attemptAutoRetry(d, failed);
  assert.equal(result.retried, false);
  assert.deepEqual(d.started, []);
  const record = d.calls.find(([, targetId]) => targetId === "exec_1");
  assert.ok(record, "the refusal is recorded: an archived card is terminal, which is a fact worth stating");
  assert.match(record[2], /card-archived/, "naming the reason");
  assert.match(record[2], /terminal/, "and the exit: archiving is terminal to every automated path");
  assert.deepEqual(d.published, ["card_1"]);
});

test("a launch refusal stays parked instead of throwing", async () => {
  const db = executionRunDb("card_1");
  const failed = seed(db);
  const d = deps(db, card(), { launchError: "This card already owns an active execution run." });
  const result = await attemptAutoRetry(d, failed);
  assert.equal(result.retried, false, "a retry the server declines changes nothing");
  assert.equal(result.runId, null);
  assert.deepEqual(d.calls, [], "and tells nobody a retry happened");
  assert.deepEqual(d.published, []);
});

test("a throwing launcher stays parked instead of failing the pass", async () => {
  const db = executionRunDb("card_1");
  const failed = seed(db);
  const d = deps(db, card());
  d.native.startNativeStageForCard = async () => { throw new Error("boom"); };
  const result = await attemptAutoRetry(d, failed);
  assert.equal(result.retried, false);
});

console.log("execution auto retry test ok: a proven no-op retries once with a trace, everything else parks");

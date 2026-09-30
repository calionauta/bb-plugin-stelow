import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { retryExecutionRun } from "../server/execution-lifecycle-retry.ts";
import { createExecutionRun, ensureExecutionRunTable } from "../lib/execution-run-ledger.mjs";

/**
 * The door in the failed-run hold.
 *
 * The advance preflight refuses to leave a stage whose newest run failed, and
 * the refusal it returns says "Retry run to try it again". This module is what
 * makes that sentence true: without it, the gate is a trap, and a trap with a
 * button on it somewhere else is still a trap.
 *
 * The refusals here are the interesting part. A retry that quietly did the
 * wrong thing — retried a stage the card has left, retried a run that is still
 * working, retried a card that is archived — would either rewrite history or
 * leave the reader pressing a button that changes nothing.
 */

function ledger() {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE cards (id TEXT PRIMARY KEY)");
  db.prepare("INSERT INTO cards (id) VALUES (?)").run("card_1");
  ensureExecutionRunTable(db);
  return db;
}

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

function seed(db, { id = "exec_1", stage = "scope", status = "failed", recipe = "scope-map" } = {}) {
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
    db.prepare("UPDATE execution_runs SET normalized_status = ? WHERE id = ?").run(status, id);
  }
}

function deps(db, current, options = {}) {
  const comments = [];
  const started = [];
  return {
    calls: comments,
    started,
    db,
    getCard: () => current,
    logComment: (cardId, targetId, body) => comments.push([cardId, targetId, body]),
    publishCard: () => {},
    native: {
      startNativeStageForCard: async (c, recipeId, context, expectedStage) => {
        started.push({ recipeId, stage: expectedStage, prompt: context.prompt });
        return options.launchError
          ? { ok: false, run: null, error: options.launchError }
          : { ok: true, run: { id: "exec_new", runId: "wfr_new" }, error: null };
      },
    },
  };
}

test("a failed run retries at the card's current stage", async () => {
  const db = ledger();
  seed(db);
  const d = deps(db, card());
  const result = await retryExecutionRun(d, "exec_1");
  assert.equal(result.ok, true);
  assert.equal(result.runId, "exec_new");
  assert.deepEqual(d.started, [{ recipeId: "scope-map", stage: "scope", prompt: "Build it" }]);
});

test("the retry is recorded on the card, naming the run it replaces", async () => {
  // Every destructive or background operation leaves an openable record: a bare
  // toast tells a reader nothing they can find again an hour later.
  const db = ledger();
  seed(db);
  const d = deps(db, card(), []);
  await retryExecutionRun(d, "exec_1");
  const comment = d.calls.find(([, targetId]) => targetId === "exec_new");
  assert.ok(comment, "the retry is traceable from the card");
  assert.match(comment[2], /Retrying the scope-map run that failed/);
  assert.match(comment[2], /exec_1/, "and it names the run it is replacing");
});

test("a run that is still working cannot be retried", async () => {
  const db = ledger();
  seed(db, { status: "running" });
  const result = await retryExecutionRun(deps(db, card(), []), "exec_1");
  assert.equal(result.ok, false);
  assert.match(result.error, /still working/i, "the reader is told it is not stuck");
});

test("a run that already succeeded cannot be retried", async () => {
  const db = ledger();
  seed(db, { status: "succeeded" });
  const result = await retryExecutionRun(deps(db, card(), []), "exec_1");
  assert.equal(result.ok, false);
  assert.match(result.error, /already finished/i);
});

test("a run from a stage the card has left is refused, and says how to reach it", async () => {
  // The trap this closes: a card advanced after a failure, the reader finds the
  // old failed row weeks later and presses Retry. Re-running that recipe would
  // write the old stage's artifacts over work the card has since done.
  const db = ledger();
  seed(db, { stage: "critique" });
  const result = await retryExecutionRun(deps(db, card({ stage: "execution" }), []), "exec_1");
  assert.equal(result.ok, false);
  assert.match(result.error, /belongs to Critique/i);
  assert.match(result.error, /card is at Execution/i);
  assert.match(result.error, /reopen/i, "and it names the way to get there");
});

test("an archived card's runs cannot be retried", async () => {
  const db = ledger();
  seed(db);
  const result = await retryExecutionRun(
    deps(db, card({ status: "archived" }), []),
    "exec_1",
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /archived/i);
});

test("a launch refusal is reported, not swallowed", async () => {
  // A retry the server declines leaves the card exactly where it was. Returning
  // ok:true there would tell the reader the hold released when it did not.
  const db = ledger();
  seed(db);
  const result = await retryExecutionRun(
    deps(db, card(), { launchError: "This card already owns an active execution run." }),
    "exec_1",
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /already owns an active execution run/);
});

test("a run that does not exist is refused plainly", async () => {
  const db = ledger();
  const result = await retryExecutionRun(deps(db, card(), []), "exec_missing");
  assert.equal(result.ok, false);
  assert.match(result.error, /not found/i);
});

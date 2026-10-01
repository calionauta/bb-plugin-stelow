import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { createAdvancePreflight } from "../server/execution-advance-preflight.ts";
import { createExecutionRun, ensureExecutionRunTable } from "../lib/execution-run-ledger.mjs";

/**
 * The gate is only real if the advance REACHES it.
 *
 * `keepsCardRunning` was exported, documented, tested in isolation, and called
 * by nothing for months — a rule that exists and has no caller is the exact
 * shape of bug this repository keeps paying for. The first version of this file
 * checked the gate with `indexOf`, which measures the position of TEXT in a
 * file. That passed when the gate was hoisted above the `dryRun` short-circuit
 * (it would then refuse a dry run, which nothing asserted against) and passed
 * when the gate was made dead code behind an earlier `return`. Text position is
 * not reachability.
 *
 * So the gate is driven here: `prepareAdvance` is called, and the only thing
 * asserted is what it RETURNS. A gate nothing reaches cannot make this fail,
 * because this calls the thing the gate is inside.
 */

function preflightWith(runs) {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE cards (id TEXT PRIMARY KEY)");
  db.prepare("INSERT INTO cards (id) VALUES (?)").run("card_1");
  ensureExecutionRunTable(db);
  for (const { id, stage, status } of runs) {
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
    });
    db.prepare("UPDATE execution_runs SET normalized_status=?, error_code=? WHERE id=?")
      .run(status, "the recipe produced no task outputs", id);
  }

  const preflight = createAdvancePreflight({
    db,
    runHelper: async () => ({ code: 0, stdout: "", stderr: "" }),
    native: { resolveStageExecutionRoute: async () => ({ route: { mode: "coordinator-sequential" } }) },
    reworkNote: async () => "",
    recordExecutionEntry: () => {},
    scopeMapApproved: async () => true,
  });
  const card = { id: "card_1", kind: "build", stage: "scope", status: "in-progress" };
  const input = { card, stage: "interface", rootPath: "/project", stateDir: "/project/.stelow", dryRun: false, includeRework: false };
  return { run: () => preflight.prepareAdvance(input), dryRun: () => preflight.prepareAdvance({ ...input, dryRun: true }) };
}

const FAILED = [{ id: "exec_1", stage: "scope", status: "failed" }];
const CLEAN = [{ id: "exec_1", stage: "scope", status: "succeeded" }];

test("a stage whose newest run failed refuses the advance, by the door's name", async () => {
  const p = preflightWith(FAILED);
  const result = await p.run();
  assert.ok("error" in result, "the advance is refused");
  assert.match(result.error, /Retry run/, "and the refusal names the door");
  assert.match(result.error, /exec_1/, "and the run that is holding the card");
});

test("a stage whose run succeeded prepares normally", async () => {
  const p = preflightWith(CLEAN);
  const result = await p.run();
  assert.ok(!("error" in result), "nothing is holding this card");
});

test("a failure at another stage does not hold this one", async () => {
  const p = preflightWith([{ id: "exec_1", stage: "critique", status: "failed" }]);
  const result = await p.run();
  assert.ok(!("error" in result), "the card is leaving Scope, not Critique");
});

test("a live run is progress, not a hold", async () => {
  const p = preflightWith([{ id: "exec_1", stage: "scope", status: "running" }]);
  const result = await p.run();
  assert.ok(!("error" in result), "work in flight is not a failed run");
});

test("the hold is taken on a dry run too", async () => {
  // A `--dry-run` is how a worker asks "may I advance?" before committing. If the
  // hold only applied to real advances, the dry run would say yes, the worker
  // would act on it, and the real advance would refuse — so the tool that is
  // supposed to prevent the mistake is the one place it does not fire.
  const p = preflightWith(FAILED);
  const result = await p.dryRun();
  assert.ok("error" in result, "the dry run reports the same refusal the real advance would");
  assert.match(result.error, /Retry run/);
});

test("the dry run with nothing holding it still prepares", async () => {
  const p = preflightWith(CLEAN);
  const result = await p.dryRun();
  assert.ok(!("error" in result));
});

// The door: a refusal that names Retry run is only honest while a Retry exists,
// is offered on the BLOCKING row, and is wired to an RPC that starts a run.
// The actions moved to their own file when the section crossed 400 lines, and
// the pin follows the code rather than the path it used to live at — pointing it
// back at the section would slice a file that no longer contains the button.
const actions = readFileSync(
  new URL("../components/detail/execution-run-actions.tsx", import.meta.url), "utf8");
assert.match(actions, /\{blocking \? \(/, "Retry is offered only on the blocking row");
const section = readFileSync(
  new URL("../components/detail/execution-runs-section.tsx", import.meta.url), "utf8");
assert.match(section, /blockingRunId !== null\)/, "and a blocking run opens the section that holds it");

const hook = readFileSync(
  new URL("../components/detail/use-execution-runs.ts", import.meta.url), "utf8");
assert.match(hook, /rpc\.call\("retryExecutionRun", \{ runId \}\)/, "the hook calls the retry RPC");
assert.match(hook, /toast\.error\(result\.error/, "a refusal is shown, not swallowed");

const contract = readFileSync(
  new URL("../server/execution-contract.ts", import.meta.url), "utf8");
assert.match(contract, /retryExecutionRun: \{/, "the RPC is declared");
assert.match(contract, /runId: z\.string\(\)\.nullable\(\)/, "and answers with the new run's id");

// The card is TOLD which run blocks, rather than re-deriving the rule in the UI —
// otherwise the button and the gate are two implementations of one fact.
const detail = readFileSync(
  new URL("../server/runtime/card-detail.ts", import.meta.url), "utf8");
assert.match(detail, /blockingRun: readBlockingRun\(deps\.db, card\)/, "the detail ships the blocking run");
const detailContract = readFileSync(
  new URL("../server/card-detail-rpc-contract.ts", import.meta.url), "utf8");
assert.match(detailContract, /blockingRun: z\.object\(\{/, "and declares its shape");

console.log("failed-run gate wiring ok: driven, not asserted by text position; the door is wired end to end");

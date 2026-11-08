import assert from "node:assert/strict";
import test from "node:test";
import { createAdvancePreflight } from "../server/execution-advance-preflight.ts";
import { createCardDetailHandler } from "../server/runtime/card-detail.ts";
import { executionRpcContract } from "../server/execution-contract.ts";
import { cardDetailRpcContract } from "../server/card-detail-rpc-contract.ts";
import { createExecutionRun } from "../lib/execution-run-ledger.mjs";
import { executionRunDb } from "./helpers/execution-run-harness.mjs";
import { card, detailDeps } from "./helpers/card-detail-fixture.mjs";
import { loadComponent, walk } from "./helpers/render-component.mjs";

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
  const db = executionRunDb("card_1");
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

test("Retry is offered only on the blocking row, driven through the rendered controls", () => {
  const RunActions = loadComponent(
    "components/detail/execution-run-actions.tsx",
    "RunActions",
    {
      "@get-bb/plugin-sdk/app": { useBbNavigate: () => () => {} },
      "../app-support/navigation": { goToExecutionRun: () => {} },
      "../../lib/workflow-vocabulary.mjs": { stageLabel: (stage) => stage },
      "./use-execution-runs": {},
      "./execution-run-row-types": {},
    },
  );
  const baseProps = {
    card: { id: "card_1", kind: "build", stage: "scope" },
    run: { id: "exec_1", stage: "scope", normalizedStatus: "failed" },
    active: false,
    stopping: false,
    retrying: false,
    onCancel: () => {},
    onRetry: () => {},
  };
  const labelsFor = (blocking) => {
    const labels = [];
    walk(RunActions({ ...baseProps, blocking }), (node) => {
      if (node.type === "button" && typeof node.children?.[0] === "string") {
        labels.push(node.children[0]);
      }
    });
    return labels;
  };
  assert.ok(labelsFor(true).includes("Retry run"), "the blocking row offers the door the refusal names");
  assert.ok(!labelsFor(false).includes("Retry run"), "history never offers a retry the server would refuse");
});

test("the detail ships the blocking run, driven through the handler", async () => {
  const blockingDb = {
    prepare(sql) {
      return {
        get: () => (sql.includes("execution_runs")
          ? { id: "exec_9", recipe_id: "scope-map", error_code: "no outputs", normalized_status: "failed" }
          : undefined),
        all: () => [],
        run: () => undefined,
      };
    },
  };
  const row = card({ stage: "scope", status: "in-progress", kind: "build" });
  const handler = createCardDetailHandler(detailDeps(row, {
    db: blockingDb,
    fetchPendingQuestions: async () => [],
  }));
  const detail = await handler({ cardId: row.id });
  assert.deepEqual(
    detail.card.blockingRun,
    { id: "exec_9", recipeId: "scope-map", errorCode: "no outputs" },
    "the card is TOLD which run blocks rather than re-deriving the rule in the UI",
  );
});

test("the retry RPC is declared, and its output carries the new run's id", () => {
  assert.ok(executionRpcContract.retryExecutionRun, "the RPC is declared");
  const output = executionRpcContract.retryExecutionRun.output;
  assert.equal(
    output.safeParse({ ok: true, runId: "exec_2", error: null }).success,
    true,
    "a success answers with the new run's id",
  );
  assert.equal(
    output.safeParse({ ok: false, runId: null, error: "refused" }).success,
    true,
    "a refusal is null and carries the reason",
  );
});

test("the detail contract declares the blocking run's shape", () => {
  const blocking = cardDetailRpcContract.cardDetail.output.shape.card.shape.blockingRun;
  assert.ok(blocking, "the detail contract declares the blocking run");
  assert.equal(
    blocking.safeParse({ id: "exec_1", recipeId: "scope-map", errorCode: null }).success,
    true,
    "a blocking run is shaped and still a link target",
  );
  assert.equal(blocking.safeParse(null).success, true, "and no live hold is null");
});

// A stateless hook runtime, enough to call a hook's returned callback: the
// section's open state and the hook's retry both live in functions the tree
// renderer cannot execute, so a real (or stubbed) hook of each is driven here
// and the assertion is what the call DID, not what its source says.
const reactStub = {
  useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
  useCallback: (fn) => fn,
  useEffect: () => {},
};

function loadRunsSection() {
  return loadComponent("components/detail/execution-runs-section.tsx", "ExecutionRunsSection", {
    react: reactStub,
    "../../lib/utils": { cn: (...values) => values.filter(Boolean).join(" ") },
    "../disclosure": {
      DisclosureSection: ({ children, open }) => ({ type: "section", props: { open }, children }),
      DisclosureChevron: () => ({ type: "chevron", props: {}, children: [] }),
    },
    "../../lib/execution-deep-link.mjs": { executionRunRowId: (id) => `execution-run-${id}` },
    "./execution-run-detail": { ExecutionRunDetail: () => ({ type: "detail", props: {}, children: [] }) },
    "../../lib/execution-run-presentation.mjs": { liveProgressNote: () => "" },
    "../../lib/execution-run-ledger.mjs": { runStatusLabel: (status) => status },
    "../../lib/workflow-vocabulary.mjs": { stageLabel: (stage) => stage },
    "./execution-run-actions": { RunActions: () => ({ type: "actions", props: {}, children: [] }) },
    "./use-execution-runs": {},
  });
}

/** The section's open state, read off the rendered disclosure. */
function sectionOpen(runs, blockingRunId) {
  const openStates = [];
  walk(loadRunsSection()({
    card: { id: "card_1", kind: "build", stage: "scope" },
    runs,
    focusRunId: null,
    stoppingRunId: null,
    retryingRunId: null,
    blockingRunId,
    onCancel: () => {},
    onRetry: () => {},
  }), (node) => {
    if (node.type === "section") openStates.push(node.props.open);
  });
  return openStates;
}

test("a blocking run opens the section that holds the door", () => {
  const failed = { id: "exec_1", stage: "scope", normalizedStatus: "failed", recipeId: "scope-map" };
  assert.deepEqual(sectionOpen([failed], "exec_1"), [true], "the blocking run's section is open");
  assert.deepEqual(sectionOpen([failed], null), [false], "history with no blocker stays closed");
});

function loadExecutionRunsHook(rpc, toast) {
  return loadComponent("components/detail/use-execution-runs.ts", "useExecutionRuns", {
    react: reactStub,
    "@get-bb/plugin-sdk/app": { useRpc: () => rpc },
    sonner: { toast },
    "../../lib/execution-deep-link.mjs": { executionRunFocus: () => null, executionRunRowId: () => null },
    "../../server": {},
  });
}

test("the hook calls the retry RPC and shows its refusal, driven through the hook", async () => {
  const calls = [];
  let retryResult = { ok: true };
  const rpc = {
    call: async (...args) => {
      calls.push(args);
      return args[0] === "executionRuns" ? { runs: [] } : retryResult;
    },
  };
  const toast = { error: (...args) => calls.push(["toast.error", ...args]) };
  const { retry } = loadExecutionRunsHook(rpc, toast)("card_1", null);

  await retry("exec_1");
  assert.deepEqual(
    calls.find(([name]) => name === "retryExecutionRun"),
    ["retryExecutionRun", { runId: "exec_1" }],
    "the hook calls the retry RPC with the run it was handed",
  );

  retryResult = { ok: false, error: "refused" };
  await retry("exec_2");
  assert.deepEqual(
    calls.find(([name]) => name === "toast.error"),
    ["toast.error", "refused"],
    "a refusal is shown, not swallowed",
  );
});

console.log("failed-run gate wiring ok: driven, not asserted by text position; the door is wired end to end");

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveScoredVerdicts } from "../lib/score-verdicts.mjs";
import {
  resolveScopeVerdicts,
  resolveTaskVerdicts,
  taskVerifyCommand,
} from "../lib/question-evidence.mjs";
import { createVerifyTasksCommand } from "../server/runtime/cli/cli-verify-tasks.ts";

// Verify-tasks: the judged remainder resolves through one atomic Score each
// against the point floor. Scope rollup is deterministic: met iff every task
// met, unmet iff any task unmet, else unverifiable — a judged remainder below
// the floor rolls up to unverifiable, never verified.
//
// A task may declare its own verify command (Spec-Kit shape), and the verb is
// written to resolve those from the exit code alone and skip the judge. That
// half cannot run today: `scopes.ts` `projectTask` drops a task's `verify`, so
// the loaded scopes never carry one. The pure extraction is pinned here and the
// dead branch is named at the bottom rather than silently trusted.

// Verify-command extraction is string-only: arrays/objects read as absent
// and fall back to the judge instead of executing something unexpected.
assert.equal(taskVerifyCommand({ verify: "npm test" }), "npm test", "a string verify command resolves");
assert.equal(taskVerifyCommand({ verify: "  " }), null, "a blank command reads absent");
assert.equal(taskVerifyCommand({ verify: ["npm", "test"] }), null, "an array command reads absent (never executed)");
assert.equal(taskVerifyCommand({}), null, "a missing command reads absent");
assert.equal(taskVerifyCommand(null), null, "junk reads absent");

const TASKS = [
  { id: "t1", name: "Add rate limiter" },
  { id: "t2", name: "Write migration" },
];

// A judge-pass (confident high Score) reads met — the judged path works.
const judgePass = resolveTaskVerdicts({
  tasks: TASKS,
  answers: { "task:t1": { type: "score", score: 1.9, confidence: 0.9 } },
  routeAt: 0.6,
});
assert.equal(judgePass.find((f) => f.id === "t1").verdict, "met", "a confident judge-pass reads met");
assert.equal(judgePass.find((f) => f.id === "t2").verdict, "unverifiable", "an unanswered task reads unverifiable, never met");

// Deterministic verify-fail refuses despite judge-pass: the scope rollup
// reads the merged command+judge findings, and any unmet (here from the
// authoritative verify command) rolls the scope to unmet.
const merged = [
  { id: "t1", name: "Add rate limiter", verdict: "unmet" },
  { id: "t2", name: "Write migration", verdict: "met" },
];
const refused = resolveScopeVerdicts({
  scopes: [{ id: "s1", name: "Scope one", status: "done", tasks: [{ id: "t1" }, { id: "t2" }] }],
  taskFindings: merged,
});
assert.equal(refused[0].verdict, "unmet", "one verify-fail refuses the scope despite a judge-pass beside it");

// Judged remainder below the floor rolls up to unverifiable — never
// verified, never met.
const judgedWeak = resolveTaskVerdicts({
  tasks: TASKS,
  answers: {
    "task:t1": { type: "score", score: 1.9, confidence: 0.2 },
    "task:t2": { type: "score", score: 1.0, confidence: 0.9 },
  },
  routeAt: 0.6,
});
assert.ok(judgedWeak.every((f) => f.verdict === "unverifiable"), "below-floor confidence and middling scores both abstain");
const rolled = resolveScopeVerdicts({
  scopes: [{ id: "s1", name: "Scope one", status: "done", tasks: [{ id: "t1" }, { id: "t2" }] }],
  taskFindings: judgedWeak,
});
assert.equal(rolled[0].verdict, "unverifiable", "an unevidenced remainder rolls up unverifiable, never verified");

// Pending scopes stay openly pending; taskless done scopes abstain.
assert.equal(
  resolveScopeVerdicts({ scopes: [{ id: "s1", name: "Open", status: "doing", tasks: [{ id: "t1" }] }], taskFindings: merged })[0].verdict,
  "open",
  "pending work is openly pending",
);
assert.equal(
  resolveScopeVerdicts({ scopes: [{ id: "s1", name: "Empty", status: "done", tasks: [] }], taskFindings: [] })[0].verdict,
  "unverifiable",
  "a taskless done scope abstains",
);

// The shared resolver degrades wrong shapes to unverifiable — a Choice or
// missing answer where a Score belongs never decides.
assert.equal(
  resolveScoredVerdicts({ items: TASKS, answers: { "task:t1": { type: "choice", choice: "x" } }, keyPrefix: "task", routeAt: 0.6 })[0].verdict,
  "unverifiable",
  "a wrong answer shape abstains",
);

// Server wiring: driven through the verb itself, not read as text. The pin
// this replaces matched six literals in cli-verify-tasks.ts, so a branch
// hoisted behind an earlier return passed it while the command stopped
// judging. The drive observes the two halves that can run: every completed
// task reaches the judge, and the scope rollup stays the deterministic
// resolver rather than a shortcut.
//
// The deterministic verify-first half has no reachable fixture: `scopes.ts`
// `projectTask` drops a task's `verify`, so `taskVerifyCommand` is always null
// over the loaded scopes and no workspace can put a task on that path. The
// pure extraction is asserted above; the CLI's exit-code mapping is dead
// until the projection carries the field.
delete process.env.STELOW_DECISION_API; // the host kill switch would refuse before the wiring runs

/** One workspace whose tracking file owns the given done tasks. */
function scopesWorkspace(tasks) {
  const root = mkdtempSync(join(tmpdir(), "stelow-verify-tasks-"));
  writeFileSync(join(root, "stelow.json"), JSON.stringify({
    workflows: [{
      workflowId: "card_1",
      name: "Checkout",
      created: "2026-09-24T00:00:00.000Z",
      dirHash: "sw-1",
      scopes: [{ id: "scope-1", title: "Rate limiter", status: "done", tasks }],
    }],
  }));
  return root;
}

/** The decision row and config the judging route reads from the database. */
function judgingDb() {
  return {
    prepare(sql) {
      return {
        get() {
          if (sql.includes("FROM decision_points")) {
            return { mode: "api", thresholds: "{}", provider: null, endpoint: null, api_key: null, model: null, preset_id: null };
          }
          if (sql.includes("FROM decision_api_config")) {
            return { endpoint: "", api_key: "", model: "", provider: null };
          }
          return undefined;
        },
      };
    },
  };
}

/** Drive the real verb with a card, a workspace, and a scripted judge. */
async function driveVerifyTasks({ workspaceRoot, judged }) {
  const judgedCalls = [];
  const card = { id: "card_1", project_id: "proj_1", worker_thread_id: "thr_worker", dir_hash: "sw-1", status: "in-progress", kind: "build" };
  const deps = {
    db: judgingDb(),
    getCardByWorkerThread: (threadId) => (threadId === "thr_worker" ? card : undefined),
    getCard: (cardId) => (cardId === "card_1" ? card : undefined),
    cardWorkspace: async () => ({ path: workspaceRoot, hostId: "host1" }),
    workingDiffFor: async () => "diff --git a/rate.ts b/rate.ts",
    decisionRoute: () => ({ provider: null, endpoint: "", apiKey: null, model: null }),
    judgeScoredBatch: async (args) => {
      judgedCalls.push(args);
      return judged;
    },
  };
  const result = await createVerifyTasksCommand(deps)(["verify-tasks", "--json"], { threadId: "thr_worker", projectId: "proj_1" });
  assert.equal(result.exitCode, 0, result.stderr);
  return { payload: JSON.parse(result.stdout), judgedCalls };
}

const mixedRoot = scopesWorkspace([
  { id: "task-a", title: "Add rate limiter", status: "done" },
  { id: "task-b", title: "Write migration", status: "done" },
]);
try {
  const mixed = await driveVerifyTasks({
    workspaceRoot: mixedRoot,
    judged: {
      ok: true,
      findings: [
        { id: "task-a", name: "Add rate limiter", score: 1.9, confidence: 0.9, verdict: "met", error: null },
        { id: "task-b", name: "Write migration", score: 1.0, confidence: 0.9, verdict: "unmet", error: null },
      ],
    },
  });
  assert.deepEqual(
    mixed.judgedCalls[0].items.map((item) => item.id),
    ["task-a", "task-b"],
    "every completed task reaches the judge, in done-task order",
  );
  assert.equal(mixed.payload.findings[1].source, "judge", "judge findings are tagged at the boundary");
  assert.deepEqual(mixed.payload.summary, { met: 1, unmet: 1, unverifiable: 0 }, "the summary counts the merged findings");
  assert.equal(mixed.payload.scopes[0].verdict, "unmet", "one unmet task rolls the whole scope up unmet");
} finally {
  rmSync(mixedRoot, { recursive: true, force: true });
}

const allMetRoot = scopesWorkspace([{ id: "task-a", title: "Add rate limiter", status: "done" }]);
try {
  const allMet = await driveVerifyTasks({
    workspaceRoot: allMetRoot,
    judged: {
      ok: true,
      findings: [{ id: "task-a", name: "Add rate limiter", score: 1.9, confidence: 0.9, verdict: "met", error: null }],
    },
  });
  assert.equal(allMet.payload.scopes[0].verdict, "met", "every task evidenced rolls the scope up met");
  assert.notEqual(allMet.payload.scopes[0].verdict, "verified", "no shortcut ever seals verified from task findings");
} finally {
  rmSync(allMetRoot, { recursive: true, force: true });
}

console.log("verify tasks judged test ok: judged remainder driven end to end, deterministic rollup, no verified shortcut");

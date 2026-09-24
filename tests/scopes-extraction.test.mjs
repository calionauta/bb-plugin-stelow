import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadCardScopes, runScopeCommand } from "../server/scopes.ts";

const root = mkdtempSync(join(tmpdir(), "stelow-scopes-"));
try {
  const stateRel = ".stelow/2026-09-24/sw-card-owned";
  mkdirSync(join(root, stateRel, "plans"), { recursive: true });
  const spec = `### SCOPE-1: Projected scope

| # | Task | Done Criterion |
|---|---|---|
| 1.1 | Existing task | Keep tracked status |
| 1.2 | Planned task | Plan criterion |
`;
  writeFileSync(join(root, stateRel, "plans", "spec-tech_v1.md"), spec);
  writeFileSync(join(root, "stelow.json"), JSON.stringify({
    workflows: [
      { workflowId: "other-card", name: "Same request", created: "2026-09-24", dirHash: "sw-other", scopes: [{ id: "other", name: "Wrong owner" }] },
      {
        workflowId: "card-owned",
        name: "Same request",
        created: "2026-09-24T00:00:00.000Z",
        dirHash: "sw-card-owned",
        scopes: [{
          id: "scope-1",
          title: "Projected scope",
          type: "feature",
          status: "in-progress",
          source: "seeded",
          gap: "missing coverage",
          blockedBy: [2, "scope-0"],
          depends_on: ["scope-0"],
          started_at: "2026-09-24T01:00:00.000Z",
          targetFiles: ["src/owned.ts", ""],
          record: { verified: true, files_count: 2, commands_count: 1, secret: "must disappear" },
          tasks: [{
            id: "task-1",
            title: "Existing task",
            status: "done",
            source: "tracked",
            note: "tracked note",
            blocked_by: ["task-0"],
            dependsOn: ["task-2"],
            secret: "must disappear",
          }],
        }],
      },
    ],
  }));

  const tracked = loadCardScopes(root, "card-owned", { mergePlanned: false });
  assert.equal(tracked.length, 1, "the immutable workflow owner is selected by id, not name");
  assert.equal(tracked[0].name, "Projected scope", "scope display fields are projected");
  assert.equal(tracked[0].kind, "scope", "scope kind is explicit");
  assert.deepEqual(tracked[0].blockedBy, ["2", "scope-0"], "scope dependency fields are projected");
  assert.deepEqual(tracked[0].dependsOn, ["scope-0"], "scope depends_on is projected");
  assert.deepEqual(tracked[0].targetFiles, ["src/owned.ts"], "target files are projected without empty paths");
  assert.deepEqual(tracked[0].record, { verified: true, filesCount: 2, commandsCount: 1 }, "evidence is sanitized");
  assert.equal(tracked[0].record.secret, undefined, "unrecognized evidence is not exposed");
  assert.deepEqual(tracked[0].tasks, [{
    id: "task-1",
    name: "Existing task",
    kind: "task",
    status: "done",
    source: "tracked",
    note: "tracked note",
    blockedBy: ["task-0"],
    dependsOn: ["task-2"],
  }], "task fields are projected and unknown fields are removed");

  const display = loadCardScopes(root, "card-owned");
  assert.equal(display[0].tasks.length, 2, "display reads enrich tracked scopes with planned tasks");
  assert.equal(display[0].tasks[0].status, "done", "tracked task status remains authoritative");
  assert.equal(display[0].tasks[1].source, "planned", "planned task is marked as planned");
  assert.equal(display[0].tasks[1].note, "Done: Plan criterion", "planned task carries its done criterion");
  assert.deepEqual(loadCardScopes(root, "card-owned", { mergePlanned: false }), tracked, "gate reads can return tracked truth without planned enrichment");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function commandHarness({
  card = { id: "card-1", dir_hash: "sw-card-1" },
  helper = { code: 0, stdout: "ok", stderr: "" },
} = {}) {
  const calls = [];
  const events = [];
  const trails = [];
  const deps = {
    bb: { realtime: { publish: (name, payload) => events.push({ name, payload }) } },
    getCardByWorkerThread: () => card,
    cardWorkspace: async () => ({ path: "/workspace" }),
    projectRoot: async () => "/project",
    workflowStateDir: async () => "/state",
    ensureProjectArtifacts: async () => null,
    runHelper: async (args, rootPath, stateDir) => {
      calls.push({ args, rootPath, stateDir });
      return helper;
    },
    recordTrackableEvent: (event) => trails.push(event),
  };
  return { calls, events, trails, deps };
}

for (const [op, transition] of [
  ["start", "started"],
  ["seed-tasks", "tasks-seeded"],
  ["done", "completed"],
]) {
  const harness = commandHarness();
  const result = await runScopeCommand(
    ["scope", op, "--scope", "scope-7", "--json"],
    { threadId: "thread-1" },
    harness.deps,
  );
  assert.deepEqual(result, { exitCode: 0, stdout: "ok" }, `${op} succeeds`);
  assert.deepEqual(harness.calls, [{
    args: ["scope", op, "--scope", "scope-7", "--json"],
    rootPath: "/workspace",
    stateDir: "/state",
  }], `${op} forwards exact helper argument order`);
  assert.deepEqual(harness.trails, [{
    cardId: "card-1",
    kind: "scope",
    trackableId: "scope-7",
    transition,
    actor: "worker",
    evidence: "ok",
  }], `${op} records a worker transition`);
  assert.deepEqual(harness.events, [
    { name: "card-state", payload: { cardId: "card-1" } },
    { name: "board-changed", payload: { cardId: "card-1" } },
  ], `${op} publishes card state before board change`);
}

const strict = commandHarness();
const strictResult = await runScopeCommand(["scope", "start", "--scope", "scope-7", "--unknown", "x"], { threadId: "thread-1" }, strict.deps);
assert.equal(strictResult.exitCode, 2, "strict parsing refuses unknown flags");
assert.equal(strict.calls.length, 0, "strict parsing never invokes the helper");

const failed = commandHarness({ helper: { code: 7, stdout: "helper stdout", stderr: "helper stderr" } });
const failedResult = await runScopeCommand(["scope", "done", "--scope", "scope-8"], { threadId: "thread-1" }, failed.deps);
assert.deepEqual(failedResult, { exitCode: 1, stdout: "helper stdout", stderr: "helper stderr" }, "helper stdout and stderr are returned unchanged");
assert.equal(failed.trails.length, 0, "failed helpers do not record a transition");
assert.deepEqual(failed.events, [], "failed helpers publish no refresh");

const noCard = commandHarness({ card: null, helper: { code: 0, stdout: "ok", stderr: "" } });
const noCardResult = await runScopeCommand(["scope", "start", "--scope", "scope-7"], { threadId: "thread-missing", projectId: "project-1" }, noCard.deps);
assert.deepEqual(noCardResult, { exitCode: 0, stdout: "ok" }, "a project-scoped transition can succeed without a card");
assert.deepEqual(noCard.calls, [{
  args: ["scope", "start", "--scope", "scope-7"],
  rootPath: "/project",
  stateDir: undefined,
}], "a cardless transition still uses the exact helper order");
assert.deepEqual(noCard.events, [], "a cardless transition does not publish card or board events");
assert.equal(noCard.trails.length, 0, "a cardless transition cannot record a worker trail");

const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
const scopeModule = readFileSync(new URL("../server/scopes.ts", import.meta.url), "utf8");
assert.match(server, /from "\.\/server\/scopes\.js"/, "server delegates scope functionality to the extracted module");
assert.doesNotMatch(server, /function loadCardScopes\(/, "the extracted module owns scope loading rather than a duplicate server implementation");
assert.doesNotMatch(server, /if \(argv\[0\] === "scope"\)[\s\S]*?runHelper\(\["scope"/, "the scope CLI wrapper is delegated instead of duplicated in server");
assert.match(
  scopeModule,
  /export async function runScopeCommand(?:<[^>]+>)?\(/,
  "the extracted module owns the scope CLI entry point",
);
assert.match(scopeModule, /parseScopeArgs\(argv\.slice\(1\)\)/, "the extracted CLI parses the command arguments");
assert.match(scopeModule, /runHelper\(\s*\["scope", \.\.\.parsed\.passthrough!/, "the extracted CLI forwards the parsed helper command");

console.log("scopes extraction test ok: owner reads, projection, planned enrichment, CLI transitions, failures, and publication order");

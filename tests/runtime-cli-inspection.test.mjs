import assert from "node:assert/strict";
import test from "node:test";
import { createInspectionCommand } from "../server/runtime/cli-inspection.ts";

const card = {
  id: "card-1",
  kind: "build",
  stage: "triage",
  status: "in-progress",
  dir_hash: "hash-1",
  research_strategy: null,
  explore_stage: null,
};

const baseDeps = {
  skillsDir: "/plugin/skills",
  errors: { archived: "archived", workspace: "workspace unavailable" },
  getCard: () => card,
  getCardForThread: () => card,
  cardWorkspace: async () => ({ path: "/workspace" }),
  loadBoard: async () => ({
    workflows: [{ name: "one", status: "active", stage: "triage" }],
  }),
  boardFromRoot: async () => ({
    workflows: [{ name: "one", status: "active", stage: "triage" }],
  }),
  projectRoot: async () => "/workspace",
  workflowStateDir: async () => "/workspace/.stelow/card-1",
  ensureProjectArtifacts: async () => null,
  runHelper: async (args) => ({ code: 0, stdout: args.join(" "), stderr: "" }),
  readText: async () => "current_stage: execution\n",
  researchStrategySkill: () => null,
  exploreTechnique: () => null,
};

function deps(overrides = {}) {
  return { ...baseDeps, ...overrides };
}

test("inspection family returns status and routes schema through the helper", async () => {
  const run = createInspectionCommand(deps());
  const status = await run(["status", "--json"], {});
  const schema = await run(["schema", "ask"], { projectId: "project-1" });

  assert.equal(status.exitCode, 0);
  assert.equal(JSON.parse(status.stdout).workflows[0].name, "one");
  assert.deepEqual(schema, { exitCode: 0, stdout: "schema ask", stderr: "" });
});

test("inspection family preserves playbook state and doctor ownership inputs", async () => {
  const helperCalls = [];
  const run = createInspectionCommand(deps({
    runHelper: async (args, root, stateDir) => {
      helperCalls.push({ args, root, stateDir });
      return { code: 0, stdout: "doctor ok", stderr: "" };
    },
  }));

  const playbook = await run(["playbook", "--card", "card-1"], {});
  const doctor = await run(
    ["doctor", "--json"],
    { projectId: "project-1", threadId: "thread-1" },
  );

  assert.equal(playbook.exitCode, 0);
  assert.match(playbook.stdout, /\/workspace\/\.stelow\/card-1\/state\.md/);
  assert.match(playbook.stdout, /stage\(execution\)/);
  assert.equal(doctor.exitCode, 0);
  assert.deepEqual(helperCalls, [{
    args: ["doctor", "--json"],
    root: "/workspace",
    stateDir: "/workspace/.stelow/card-1",
  }]);
});

test("inspection family preserves card failure exit codes and usage", async () => {
  const run = createInspectionCommand(deps({
    getCard: () => undefined,
  }));

  assert.deepEqual(await run(["playbook", "--card", "card-1"], {}), {
    exitCode: 2,
    stderr: 'Unknown card "card-1".',
  });
  assert.deepEqual(await run(["doctor", "--json", "extra"], {}), {
    exitCode: 2,
    stderr: "Usage: bb stelow doctor [--project <proj_id>] [--json]",
  });
});

test("inspection family preserves helper and workspace error exits", async () => {
  const helperFailure = createInspectionCommand(deps({
    runHelper: async () => ({ code: 7, stdout: "partial", stderr: "drift" }),
  }));
  const missingRoot = createInspectionCommand(deps({
    projectRoot: async () => null,
  }));

  assert.deepEqual(await helperFailure(["doctor"], { projectId: "project-1" }), {
    exitCode: 7,
    stderr: "drift",
    stdout: "partial",
  });
  assert.deepEqual(await missingRoot(["schema"], { projectId: "project-1" }), {
    exitCode: 1,
    stderr: "Workspace path is unavailable.",
  });
});

test("inspection family refuses archived cards and unverified owned state", async () => {
  const archived = createInspectionCommand(deps({
    getCard: () => ({ ...card, status: "archived" }),
  }));
  const unverified = createInspectionCommand(deps({
    workflowStateDir: async () => null,
  }));

  assert.deepEqual(await archived(["playbook", "--card", "card-1"], {}), {
    exitCode: 1,
    stderr: "archived",
  });
  assert.deepEqual(await unverified(["playbook", "--card", "card-1"], {}), {
    exitCode: 1,
    stderr: "Workflow state ownership cannot be verified. Reseed this card; project-root state is intentionally ignored.",
  });
});

test("inspection dispatcher leaves unrelated commands to the main CLI", async () => {
  const run = createInspectionCommand(deps());

  assert.equal(await run(["ask", "--thread", "thread-1"], {}), null);
});

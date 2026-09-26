import assert from "node:assert/strict";
import test from "node:test";
import { createWorkerRespawnPreparation } from "../server/runtime/worker-respawn-preparation.ts";
import { createQuestionStaleness } from "../server/runtime/question-staleness.ts";
import { createDiscardEvidence } from "../server/runtime/discard-evidence.ts";

function card(overrides = {}) {
  return {
    id: "card_1",
    project_id: "project_1",
    name: "card",
    display_name: "Card",
    prompt: "Build the thing",
    intent: "feature",
    status: "in-progress",
    workspace_kind: "project",
    workspace_path: null,
    created_at: 1_000,
    dir_hash: null,
    worker_thread_id: "thread_old",
    kind: "build",
    research_strategy: null,
    explore_stage: null,
    ...overrides,
  };
}

function preset() {
  return {
    id: "preset_1",
    name: "Default",
    provider_id: "pi",
    model_id: "model",
    reasoning_level: "medium",
    permission_mode: "full",
    environment_kind: "project-default",
    base_branch: null,
    machine_id: null,
    instructions: "Follow the preset.",
  };
}

function protocols() {
  return {
    cardOwnerRules: "OWNER",
    neverSeed: "NO_SEED",
    cliEquivalents: "CLI",
    reconProtocol: "RECON",
    draftProtocol: "DRAFT",
    turnDiscipline: "TURN",
    commitStyle: "COMMIT",
    interfacePick: "PICK",
    doneProtocol: "DONE",
    splitProtocol: "SPLIT",
  };
}

function respawnDeps(overrides = {}) {
  const researchInputs = [];
  return {
    researchInputs,
    deps: {
      bb: {},
      presetParams: () => ({
        ...presetParams(),
      }),
      cardWorkspace: async () => ({ path: "/repo", hostId: null }),
      workflowStateDir: async () => "/repo/.stelow/2026-01-01/hash",
      strategyList: () => [],
      strategyRounds: () => [],
      researchWorkerPrompt: (input) => {
        researchInputs.push(input);
        return "research prompt";
      },
      exploreWorkerPrompt: () => "explore prompt",
      roundRelPath: () => "rounds/one.md",
      text: (value) => value ?? "unknown",
      protocols: protocols(),
      ...overrides,
    },
  };
}

function presetParams() {
  const value = preset();
  return {
    providerId: value.provider_id,
    modelId: value.model_id,
    reasoningLevel: value.reasoning_level,
    permissionMode: value.permission_mode,
    environmentKind: value.environment_kind,
    baseBranch: value.base_branch,
    machineId: value.machine_id,
    instructions: value.instructions,
  };
}

test("worker respawn refuses unverifiable state before choosing a track prompt", async () => {
  const { deps } = respawnDeps({
    workflowStateDir: async () => { throw new Error("unreadable"); },
  });
  const prepare = createWorkerRespawnPreparation(deps);
  const result = await prepare(card({ dir_hash: "hash" }), preset(), "restart");
  assert.match(result.error, /state cannot be verified/);
});

test("worker respawn keeps the build continuation contract and workspace", async () => {
  const { deps } = respawnDeps();
  const prepare = createWorkerRespawnPreparation(deps);
  const result = await prepare(card({ intent: "unknown" }), preset(), "restart");
  assert.equal(result.projectPath, "/repo");
  assert.match(result.prompt, /CONTINUE the workflow from the current stage/);
  assert.match(result.prompt, /thread_old \(archived before this handoff\)/);
  assert.match(result.prompt, /Follow the preset\./);
  assert.match(result.prompt, /Request:\nBuild the thing/);
});

test("worker respawn selects the latest research strategy and its existing round", async () => {
  const { deps, researchInputs } = respawnDeps({
    strategyList: () => ["pricing", "business-models"],
    strategyRounds: () => [
      { id: "pricing", file: "rounds/pricing.md" },
      { id: "business-models", file: "rounds/business.md" },
    ],
  });
  const prepare = createWorkerRespawnPreparation(deps);
  const row = card({ kind: "research" });
  const result = await prepare(row, preset(), "restart");
  assert.equal(result.prompt, "research prompt");
  assert.equal(researchInputs[0].strategyId, "business-models");
  assert.equal(researchInputs[0].roundFile, "rounds/business.md");
  assert.equal(researchInputs[0].roundNo, 2);
});

function stalenessDeps(overrides = {}) {
  return {
    db: {
      prepare: () => ({ all: () => [{
        artifact_path: "/repo/spec.md",
        artifact_sha256: "old",
        git_root: "/repo",
        head_sha: "head-old",
      }] }),
    },
    recoveryGitEvidence: async () => ({ headSha: "head-new" }),
    sha256OfHostFile: async () => "new",
    gitTouchedSince: async () => ({ commitCount: 2, paths: ["src/app.ts"] }),
    ...overrides,
  };
}

test("question staleness reports revision, checkout movement, and touched evidence", async () => {
  const read = createQuestionStaleness(stalenessDeps());
  const result = await read("card_1", [{
    id: "q1",
    options: [{ artifact: { absolutePath: "/repo/spec.md" } }],
  }]);
  assert.deepEqual(result.get("q1"), {
    docRevised: true,
    docRemoved: false,
    checkoutMoved: true,
    commitCount: 2,
    touchedPaths: ["src/app.ts"],
  });
});

test("question staleness remains advisory when its evidence query fails", async () => {
  const deps = stalenessDeps({
    db: { prepare: () => { throw new Error("database unavailable"); } },
  });
  const result = await createQuestionStaleness(deps)("card_1", []);
  assert.equal(result.size, 0);
});

function discardCard(overrides = {}) {
  return card(overrides);
}

test("discard evidence collects project Git state without losing paths", async () => {
  const calls = [];
  const db = {
    prepare: (sql) => ({
      get: () => (sql.includes("project_id") ? { n: 3 } : undefined),
    }),
  };
  const runGitIn = async (_cwd, args) => {
    calls.push(args.join(" "));
    if (args.includes("--show-toplevel")) return ok("/repo");
    if (args[0] === "branch") return ok("feature/cards\n");
    if (args.includes("@{u}")) return ok("origin/feature/cards\n");
    if (args[0] === "status") return ok(" M src/a.ts\n?? src/b.ts\n");
    if (args[0] === "rev-list") return ok("2\n");
    if (args[0] === "stash") return ok("stash@{0}\n");
    if (args[0] === "log") return ok("first-sha\n");
    if (args[0] === "rev-parse") return ok("parent-sha\n");
    return { ok: false, stdout: "" };
  };
  const evidence = await createDiscardEvidence({
    db,
    cardWorkspace: async () => ({ path: "/repo/worktree", hostId: null }),
    runGitIn,
  })(discardCard());
  assert.equal(evidence.checkoutPath, "/repo");
  assert.equal(evidence.branch, "feature/cards");
  assert.equal(evidence.upstreamRef, "origin/feature/cards");
  assert.deepEqual(evidence.changed, ["src/a.ts"]);
  assert.deepEqual(evidence.untracked, ["src/b.ts"]);
  assert.equal(evidence.unpushedCommits, 2);
  assert.equal(evidence.stashCount, 1);
  assert.equal(evidence.resetTarget, "parent-sha");
  assert.equal(evidence.sharedWith, 3);
  assert.ok(calls.includes("rev-parse first-sha^"));
});

test("discard evidence fails soft to shared zero for an exploratory folder", async () => {
  const db = { prepare: () => ({ get: () => { throw new Error("locked"); } }) };
  const evidence = await createDiscardEvidence({
    db,
    cardWorkspace: async () => { throw new Error("must not resolve project"); },
    runGitIn: async () => { throw new Error("must not run git"); },
  })(discardCard({
    workspace_kind: "exploratory",
    workspace_path: "/missing/exploration",
  }));
  assert.equal(evidence.checkoutPath, "/missing/exploration");
  assert.equal(evidence.dirExists, false);
  assert.equal(evidence.sharedWith, 0);
});

function ok(stdout) {
  return { ok: true, stdout };
}

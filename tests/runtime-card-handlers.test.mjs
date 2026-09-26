import assert from "node:assert/strict";
import test from "node:test";
import { createGateHandlers, createCardAdvance } from "../server/runtime/card-gates.ts";
import { createCardDiff } from "../server/runtime/card-diff.ts";
import { createAuditTrailStatus } from "../server/runtime/card-audit-trail.ts";
import { createCardReseed } from "../server/runtime/card-reseed.ts";

function card(overrides = {}) {
  return {
    id: "card_1",
    project_id: "proj_1",
    name: "Card",
    display_name: "Card",
    prompt: "Build it",
    intent: "feature",
    status: "in-progress",
    stage: "planning",
    activity: "running",
    kind: "build",
    dir_hash: "hash_1",
    worker_thread_id: "thread_1",
    worker_preset_id: "preset_old",
    workspace_kind: "exploratory",
    workspace_path: "/project",
    workspace_host_id: "host_1",
    attachments: "[]",
    last_error: null,
    ...overrides,
  };
}

function preset(id = "preset_1") {
  return {
    id,
    name: id,
    provider_id: "pi",
    model_id: "model",
    reasoning_level: "high",
    permission_mode: "auto",
    environment_kind: "host",
    base_branch: null,
    machine_id: null,
    instructions: "",
  };
}

const reseedProtocols = {
  cardOwnerRules: "owner", neverSeed: "never seed", cliEquivalents: "cli",
  reconProtocol: "recon", draftProtocol: "draft", turnDiscipline: "turn",
  commitStyle: "commit", interfacePick: "pick", doneProtocol: "done", splitProtocol: "split",
};
const reseedErrors = {
  cardNotFound: "missing", cardArchived: "archived",
  workspaceUnavailable: "workspace", presetNotFound: "preset missing",
};

test("gate approval keeps artifact refusal and conflict publication behavior", async () => {
  const calls = [];
  let hasArtifact = false;
  let conflict = false;
  const handlers = createGateHandlers({
    db: { prepare: () => ({ get: () => undefined }) },
    bb: {
      sdk: { files: {
        mkdir: async (input) => calls.push(["mkdir", input]),
        write: async (input) => {
          calls.push(["write", input]);
          return { outcome: conflict ? "conflict" : "written" };
        },
      } },
      realtime: { publish: (...args) => calls.push(["publish", ...args]) },
    },
    getCard: () => undefined,
    cardWorkspace: async () => null,
    boardFromRoot: async () => ({ rootPath: null, workflows: [], error: null }),
    loadBoard: async () => ({
      rootPath: "/project",
      workflows: [{
        id: "sw_1",
        name: "Card",
        dirHash: "hash_1",
        artifacts: hasArtifact ? [{ kind: "product-spec" }] : [],
      }],
      error: null,
    }),
  });
  assert.equal((await handlers.approveGate({ projectId: "p", workflowId: "sw_1", gate: "gate" })).error,
    "The gate artifact does not exist yet.");
  assert.equal(calls.length, 0);

  hasArtifact = true;
  conflict = true;
  assert.equal((await handlers.approveGate({ projectId: "p", workflowId: "sw_1", gate: "gate" })).approved,
    true);
  assert.equal(calls.some(([name]) => name === "publish"), false);

  conflict = false;
  await handlers.approveGate({ projectId: "p", workflowId: "sw_1", gate: "gate" });
  assert.deepEqual(calls.at(-1), ["publish", "board-changed", { workflowId: "sw_1", gate: "gate" }]);
});

test("card advance preserves refusal, helper, respawn, update, publish order", async () => {
  const calls = [];
  const advance = createCardAdvance({
    getCard: () => card(),
    cardWorkspace: async () => ({ path: "/project", hostId: "host_1" }),
    workflowStateDir: async () => "/project/state",
    ensureArtifacts: async () => null,
    questionGate: async () => null,
    runHelper: async (args) => {
      calls.push(["helper", args]);
      return { code: 0, stdout: "advanced", stderr: "" };
    },
    getReliablePreset: () => preset("preset_2"),
    getCardPreset: () => preset("preset_old"),
    respawn: async (...args) => calls.push(["respawn", ...args]),
    updateCard: (...args) => calls.push(["update", ...args]),
    publishCard: (cardId) => calls.push(["publish", cardId]),
    errors: { cardNotFound: "missing", cardArchived: "archived", workspaceUnavailable: "workspace" },
  });
  assert.deepEqual(await advance({ cardId: "card_1", stage: "execution" }), {
    ok: true,
    stdout: "advanced",
    error: null,
  });
  assert.deepEqual(calls.map(([name]) => name), ["helper", "respawn", "update", "publish"]);
});

test("card advance question refusal is a negative control", async () => {
  let helperRan = false;
  const advance = createCardAdvance({
    getCard: () => card(),
    cardWorkspace: async () => ({ path: "/project", hostId: "host_1" }),
    workflowStateDir: async () => "/project/state",
    ensureArtifacts: async () => null,
    questionGate: async () => "Answer the open question first.",
    runHelper: async () => {
      helperRan = true;
      return { code: 0, stdout: "", stderr: "" };
    },
    getReliablePreset: () => null,
    getCardPreset: () => preset(),
    respawn: async () => undefined,
    updateCard: () => undefined,
    publishCard: () => undefined,
    errors: { cardNotFound: "missing", cardArchived: "archived", workspaceUnavailable: "workspace" },
  });
  assert.equal((await advance({ cardId: "card_1", stage: "execution" })).error,
    "Answer the open question first.");
  assert.equal(helperRan, false);
});

test("card diff combines tracked and untracked files while optional summaries fail soft", async () => {
  const commands = [];
  const diff = createCardDiff({
    execFile: (binary, args, _options, callback) => {
      commands.push([binary, args]);
      if (args[0] === "rev-parse") return callback(null, "/project\n");
      if (args[0] === "diff") return callback(null, "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n");
      if (args.includes("status")) return callback(null, "?? new.ts\0");
      callback(new Error("missing optional tool"), "");
    },
    getCard: () => card(),
    cardCheckout: async () => ({ path: "/project", hostId: "host_1" }),
    recoveredIntegrity: async () => null,
    resolveLocalBin: (name) => `/bin/${name}`,
    errors: { cardNotFound: "missing", workspaceUnavailable: "workspace" },
  });
  const result = await diff({ cardId: "card_1" });
  assert.deepEqual(result.files.map((file) => [file.path, file.isNew]), [
    ["a.ts", false],
    ["new.ts", true],
  ]);
  assert.equal(result.entitySummary, null);
  assert.equal(result.changedSymbols, null);
  assert.ok(commands.some(([binary]) => binary === "/bin/sem"));
});

test("card diff ignores partial status output after a failed status command", async () => {
  const diff = createCardDiff({
    execFile: (binary, args, _options, callback) => {
      if (args[0] === "rev-parse") return callback(null, "/project\n");
      if (args[0] === "diff") return callback(null, "");
      if (args.includes("status")) return callback(new Error("failed"), "?? leaked.ts\0");
      callback(new Error("missing optional tool"), "");
    },
    getCard: () => card(),
    cardCheckout: async () => ({ path: "/project", hostId: "host_1" }),
    recoveredIntegrity: async () => null,
    resolveLocalBin: (name) => name,
    errors: { cardNotFound: "missing", workspaceUnavailable: "workspace" },
  });
  assert.deepEqual((await diff({ cardId: "card_1" })).files, []);
});

test("audit trail status delegates classification and refuses unowned state", async () => {
  const files = [];
  const audit = createAuditTrailStatus({
    bb: { sdk: { files: { read: async (input) => {
      files.push(input.path);
      return { content: "missing" };
    } } } },
    getCard: () => card(),
    cardWorkspace: async () => ({ path: "/project", hostId: "host_1" }),
    workflowStateDir: async () => "/project/state",
    runHelper: async () => ({
      code: 0,
      stdout: JSON.stringify({ ok: true, contract: "v3", snapshot: { head: "abc123" } }),
      stderr: "",
    }),
    errors: { cardNotFound: "missing", workspaceUnavailable: "workspace" },
  });
  const result = await audit({ cardId: "card_1" });
  assert.equal(result.state, "verified");
  assert.equal(result.head, "abc123");
  assert.deepEqual(files, ["/project/state/context/recon-receipt.json"]);

  const unowned = createAuditTrailStatus({
    ...auditDeps(),
    workflowStateDir: async () => null,
  });
  assert.match((await unowned({ cardId: "card_1" })).detail, /ownership cannot be verified/);
});

function auditDeps() {
  return {
    bb: { sdk: { files: { read: async () => ({ content: "" }) } } },
    getCard: () => card(),
    cardWorkspace: async () => ({ path: "/project", hostId: "host_1" }),
    workflowStateDir: async () => "/project/state",
    runHelper: async () => ({ code: 1, stdout: "", stderr: "failed" }),
    errors: { cardNotFound: "missing", workspaceUnavailable: "workspace" },
  };
}

test("reseed preserves archived refusal and reclassified intent ordering", async () => {
  let seeded = false;
  const reseed = createCardReseed(reseedDeps({
    getCard: () => card({ status: "archived" }),
    seedWorkflow: async () => {
      seeded = true;
      return { error: null, dirHash: "new", stateDir: "/state" };
    },
  }));
  assert.deepEqual(await reseed({ cardId: "card_1", intent: "bugfix" }), {
    reseeded: false,
    error: "archived",
    reclassified: false,
  });
  assert.equal(seeded, false);

  const calls = [];
  const sqlDb = {
    prepare: (sql) => ({ run: (args) => calls.push(["write", sql, args]) }),
  };
  const success = createCardReseed(reseedDeps({
    db: sqlDb,
    getCard: () => card({ status: "draft", stage: "triage", intent: "unknown" }),
    seedWorkflow: async (args) => {
      calls.push(["seed", args.intent]);
      return { error: null, dirHash: "new_hash", stateDir: "/state" };
    },
    replacePrepared: async (args) => {
      calls.push(["replace", args]);
      return { id: "thread_2" };
    },
    updateCard: (...args) => calls.push(["update", ...args]),
    recordThread: (...args) => calls.push(["record", ...args]),
    lineage: async (...args) => calls.push(["lineage", ...args]),
    publishCard: (...args) => calls.push(["publish", ...args]),
  }));
  assert.deepEqual(await success({ cardId: "card_1", intent: "bugfix" }), {
    reseeded: true,
    error: null,
    reclassified: true,
  });
  assert.deepEqual(calls.map(([name]) => name), [
    "seed", "write", "write", "replace", "write", "update", "record", "lineage", "publish",
  ]);
  assert.equal(calls[1][1].includes("dir_hash"), true);
  assert.equal(calls[2][1].includes("ask_contracts"), true);
  assert.match(calls[3][1].input[0].text, /Batch independent questions into ONE ask call/);
  assert.match(calls[3][1].input[0].text, /each with its own --option labels/);
  assert.equal(calls[4][2], "bugfix");
});

function reseedDeps(overrides = {}) {
  const noSql = { prepare: () => ({ run: () => undefined }) };
  return {
    db: noSql,
    bb: { sdk: { files: {} }, realtime: { publish: () => undefined } },
    now: () => 10,
    getCard: () => card(),
    cardWorkspace: async () => ({ path: "/project", hostId: "host_1" }),
    workflowStateDir: async () => "/state",
    readStateConfig: async () => ({ appetite: "Lean", reviewGates: ["diff"] }),
    seedWorkflow: async () => ({ error: null, dirHash: "new", stateDir: "/state" }),
    getPresetById: () => preset(),
    pinCardPreset: () => true,
    getReliablePreset: () => preset(),
    presetParams: (value) => ({
      providerId: value.provider_id,
      modelId: value.model_id,
      reasoningLevel: value.reasoning_level,
      permissionMode: value.permission_mode,
      environmentKind: value.environment_kind,
      baseBranch: value.base_branch,
      machineId: value.machine_id,
      instructions: value.instructions,
    }),
    strategyList: () => [],
    strategyRounds: () => [],
    roundFile: () => "round.md",
    roundStamp: () => "stamp",
    roundRelativePath: (_state, _root, file) => file,
    ensureArtifactParent: async () => undefined,
    researchPrompt: () => "research",
    explorePrompt: () => "explore",
    attachments: () => [],
    continuingEnvironment: async (_value, environment) => environment,
    workerEnvironment: () => ({ type: "host" }),
    replacePrepared: async () => ({ id: "thread_2" }),
    resetAutoContinue: () => ({ count: 0, stage: null }),
    updateCard: () => undefined,
    recordThread: () => undefined,
    lineage: async () => undefined,
    publishCard: () => undefined,
    protocols: reseedProtocols,
    errors: reseedErrors,
    ...overrides,
  };
}

import assert from "node:assert/strict";
import test from "node:test";
import { createCardsServer, createCardStore } from "../server/cards.ts";
import { createCardInternal } from "../server/cards-create.ts";
import { CARD_COLUMNS } from "../server/cards-create-persist.ts";

const card = {
  id: "card_1",
  project_id: "proj_1",
  name: "a-card",
  display_name: "A card",
  prompt: "do work",
  intent: "feature",
  workspace_kind: "project",
  workspace_path: null,
  workspace_host_id: null,
  kind: "build",
  research_strategy: null,
  research_strategies: null,
  explore_stage: null,
  status: "triage",
  stage: "triage",
  worker_thread_id: null,
  activity: "idle",
  last_error: null,
  last_idle_at: null,
  updated_at: Date.now(),
  environment_label: null,
};

function harness() {
  const rows = [card];
  const db = {
    prepare(sql) {
      return {
        all: (..._values) => sql.includes("ORDER BY updated_at") ? rows : [],
        get: () => rows[0],
      };
    },
  };
  const bb = {
    sdk: {
      projects: {
        list: async () => [{ id: "proj_1", name: "Project" }],
        get: async () => ({ id: "proj_1", sources: [{ path: "/workspace", hostId: "host_1", isDefault: true }] }),
      },
      files: { read: async () => ({ content: "artifact" }) },
    },
  };
  const store = createCardStore(bb, db);
  const cards = createCardsServer({
    db,
    bb,
    now: () => card.updated_at,
    store,
    errors: { cardNotFound: "missing", workspaceUnavailable: "unavailable" },
    idleAttentionMs: 90_000,
    loadBoard: async () => ({ rootPath: null, workflows: [], error: null }),
    githubStatus: async () => ({ ok: true }),
    githubAutomationEnabled: () => false,
    strategyList: () => [],
    getReliablePreset: () => ({ name: "Default", provider_id: "pi", model_id: "model" }),
    fetchPendingQuestions: async () => [],
    openExpiredQuestionIds: () => [],
    create: {},
  });
  return { bb, cards, db };
}

test("card workspace resolution follows project source", async () => {
  const { cards } = harness();
  assert.deepEqual(await cards.cardWorkspace(card), { path: "/workspace", hostId: "host_1" });
});

test("list cards preserves project names and attention state", async () => {
  const { cards } = harness();
  const result = await cards.handlers.listCards({ projectId: "proj_1", kind: null });
  assert.equal(result.cards[0].projectName, "Project");
  assert.equal(result.cards[0].needsAttention, false);
  assert.equal(result.cards[0].scopeSummary.scopesTotal, 0);
});

test("read card files rejects workspace escapes and reads text", async () => {
  const { cards } = harness();
  assert.equal((await cards.handlers.readCardFile({ cardId: card.id, path: "../secret" })).error, "Path escapes the workspace.");
  assert.equal((await cards.handlers.readCardFile({ cardId: card.id, path: "notes.md" })).content, "artifact");
});

const creationRules = {
  cardOwnerRules: "owner", neverSeed: "never", cliEquivalents: "cli", reconProtocol: "recon",
  draftProtocol: "draft", turnDiscipline: "turn", commitStyle: "commit", interfacePick: "pick",
  doneProtocol: "done", splitProtocol: "split",
};

function creationPresetDeps(calls) {
  const basePreset = {
    id: "preset_1",
    provider_id: "pi",
    model_id: "model",
    reasoning_level: "medium",
    permission_mode: "auto",
    environment_kind: "project-default",
    base_branch: "main",
    machine_id: null,
    instructions: "follow the workflow",
  };
  const overridePreset = {
    ...basePreset,
    id: "card-override-card_created",
    provider_id: "acp-opencode",
    model_id: "opencode-go/muse-spark",
  };
  return {
    defaultPreset: () => basePreset,
    getPreset: (id) => id === overridePreset.id ? overridePreset : basePreset,
    getBandPresetId: () => null,
    getReliablePresetId: () => null,
    createCardOverride: () => {
      calls.push("create-override");
      return overridePreset;
    },
    pinCardPreset: () => {
      calls.push("pin-override");
      return true;
    },
    removeCardPreset: () => calls.push("remove-override"),
    presetParams: (value) => ({
      providerId: value.provider_id,
      modelId: value.model_id,
      reasoningLevel: value.reasoning_level,
      permissionMode: value.permission_mode,
      environmentKind: value.environment_kind,
      machineId: value.machine_id,
      instructions: value.instructions,
    }),
  };
}

function creationHost(calls) {
  let inserted;
  const db = {
    prepare(sql) {
      return {
        run: (...values) => {
          assert.match(sql, /^INSERT INTO cards/);
          inserted = values;
          calls.push("insert-card");
        },
      };
    },
  };
  const bb = {
    sdk: {
      projects: {
        get: async () => ({
          id: "proj_1",
          sources: [{ path: "/workspace", hostId: "host_1" }],
        }),
      },
    },
    storage: { kv: { set: async () => undefined } },
    realtime: { publish: () => undefined },
  };
  return { db, bb, getInserted: () => inserted };
}

function creationWorkflowDeps(calls, spawnError) {
  return {
    now: () => 100,
    randomId: () => "card_created",
    roundTimestamp: () => "stamp",
    seedBuildIntent: async () => "feature",
    seedWorkflow: async () => ({
      error: null,
      dirHash: "hash",
      stateDir: ".stelow/state",
    }),
    researchStrategy: () => null,
    exploreStage: () => null,
    researchIds: () => [],
    exploreIds: () => [],
    spawnInitial: async () => {
      calls.push("spawn");
      if (spawnError) throw spawnError;
      return { id: "thread_1" };
    },
    recordThread: () => undefined,
    lineage: async () => undefined,
    roundPath: (stateDir) => stateDir,
    roundFile: () => "round.md",
    ensureParent: async () => undefined,
    researchPrompt: () => "research",
    explorePrompt: () => "explore",
    rules: creationRules,
    describeManagedWorktree: () => false,
    recordStageEvent: () => undefined,
    comment: () => undefined,
    suggestCardName: async () => undefined,
  };
}

function creationHarness({ execution = null, spawnError = null } = {}) {
  const calls = [];
  const host = creationHost(calls);
  const create = createCardInternal({
    ...host,
    ...creationPresetDeps(calls),
    ...creationWorkflowDeps(calls, spawnError),
  });
  return {
    create: (input) => create({ ...input, execution }),
    calls,
    getInserted: host.getInserted,
  };
}

const creationInput = {
  projectId: "proj_1",
  prompt: "Improve the thing",
  attachments: [],
  intent: "feature",
  appetite: "Lean",
  reviewMode: "Auto",
};

test("deferred build creation stores the card kind and never spawns a worker", async () => {
  const { create, calls, getInserted } = creationHarness();
  const result = await create({ ...creationInput, start: false });
  assert.deepEqual(result, { cardId: "card_created", threadId: null });
  assert.equal(calls.includes("spawn"), false);
  assert.equal(getInserted()[CARD_COLUMNS.indexOf("kind")], "build");
});

test("divergent creation choices pin the override only after the card row exists", async () => {
  const { create, calls } = creationHarness({
    execution: {
      providerId: "acp-opencode",
      model: "opencode-go/muse-spark",
      reasoningLevel: "medium",
      permissionMode: "auto",
    },
  });
  const result = await create(creationInput);
  assert.equal(result.threadId, "thread_1");
  assert.ok(
    calls.indexOf("insert-card") < calls.indexOf("pin-override"),
    `override lifecycle calls: ${calls.join(", ")}`,
  );
  assert.equal(calls.includes("remove-override"), false);
});

test("spawn failure removes the staged override and never persists a card", async () => {
  const { create, calls } = creationHarness({
    execution: { providerId: "acp-opencode", model: "opencode-go/muse-spark" },
    spawnError: new Error("spawn failed"),
  });
  await assert.rejects(
    create(creationInput),
    /spawn failed/,
  );
  assert.ok(calls.includes("create-override"), `failure calls: ${calls.join(", ")}`);
  assert.ok(calls.includes("remove-override"));
  assert.equal(calls.includes("insert-card"), false);
  assert.equal(calls.includes("pin-override"), false);
});

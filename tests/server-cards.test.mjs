import assert from "node:assert/strict";
import test from "node:test";
import { createCardsServer, createCardStore } from "../server/cards.ts";
import { createCardInternal } from "../server/cards-create.ts";
import { CARD_COLUMNS } from "../server/cards-create-persist.ts";

const promptRules = {
  cardOwnerRules: "owner",
  neverSeed: "never",
  cliEquivalents: "cli",
  reconProtocol: "recon",
  draftProtocol: "draft",
  turnDiscipline: "turn",
  commitStyle: "commit",
  interfacePick: "pick",
  doneProtocol: "done",
  splitProtocol: "split",
};

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

test("deferred build creation stores the card kind and never spawns a worker", async () => {
  let inserted;
  const db = {
    prepare(sql) {
      return {
        get: () => sql.includes("stage_presets")
          ? { preset_id: "preset_1" }
          : undefined,
        run: (...values) => { inserted = values; },
      };
    },
  };
  const bb = {
    sdk: { projects: { get: async () => ({ id: "proj_1", sources: [{ path: "/workspace", hostId: "host_1" }] }) } },
    storage: { kv: { set: async () => undefined } },
    realtime: { publish: () => undefined },
  };
  const preset = {
    id: "preset_1",
    provider_id: "pi",
    model_id: "model",
    reasoning_level: "medium",
    permission_mode: "auto",
    environment_kind: "project",
    base_branch: "main",
    machine_id: null,
    instructions: "follow the workflow",
  };
  let spawned = false;
  const create = createCardInternal({
    db,
    bb,
    now: () => 100,
    randomId: () => "card_created",
    roundTimestamp: () => "stamp",
    seedBuildIntent: async () => "feature",
    seedWorkflow: async () => ({ error: null, dirHash: "hash", stateDir: ".stelow/state" }),
    researchStrategy: () => null,
    exploreStage: () => null,
    researchIds: () => [],
    exploreIds: () => [],
    defaultPreset: () => preset,
    getPreset: () => preset,
    getBandPresetId: () => "preset_1",
    getReliablePresetId: () => null,
    presetParams: (value) => ({
      providerId: value.provider_id,
      modelId: value.model_id,
      reasoningLevel: value.reasoning_level,
      permissionMode: value.permission_mode,
      environmentKind: value.environment_kind,
      machineId: value.machine_id,
      instructions: value.instructions,
    }),
    spawnInitial: async () => { spawned = true; return { id: "thread_1" }; },
    recordThread: () => undefined,
    lineage: async () => undefined,
    roundPath: (stateDir) => stateDir,
    roundFile: () => "round.md",
    ensureParent: async () => undefined,
    researchPrompt: () => "research",
    explorePrompt: () => "explore",
    rules: promptRules,
    describeManagedWorktree: () => false,
    recordStageEvent: () => undefined,
    comment: () => undefined,
    suggestCardName: async () => undefined,
  });

  const result = await create({
    projectId: "proj_1",
    prompt: "Improve the thing",
    attachments: [],
    intent: "feature",
    appetite: "Lean",
    reviewMode: "Auto",
    start: false,
  });
  assert.deepEqual(result, { cardId: "card_created", threadId: null });
  assert.equal(spawned, false);
  assert.equal(inserted[CARD_COLUMNS.indexOf("kind")], "build");
});

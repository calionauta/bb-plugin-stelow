import assert from "node:assert/strict";
import test from "node:test";
import { createCardsServer, createCardStore } from "../server/cards.ts";
import { createCardInternal } from "../server/cards-create.ts";
import { CARD_COLUMNS } from "../server/cards-create-persist.ts";
import { buildBoardColumnFor } from "../lib/workflow-vocabulary.mjs";

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
  status: "in-progress",
  stage: "triage",
  worker_thread_id: null,
  activity: "idle",
  last_error: null,
  last_idle_at: null,
  updated_at: Date.now(),
  environment_label: null,
};

function harness(overrides = {}) {
  const rows = [{ ...card, ...overrides }];
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

// The card list's status projection had no behavioural test at all, and the
// fixture it used carried `status: "triage"` — a STAGE name, on no status axis,
// in a test that never looked at `status`. So the one field the axis split exists
// to protect was unasserted at the surface that renders it.
//
// These two are the regression that was reproduced live: with the projection
// reading a card's status through the SCOPE normalizer, an archived card came
// back as `pending` and landed in the `analysis` column instead of the archived
// one. Nothing failed. Each of these asserts the stored value arriving intact,
// which is what "a card reads through the card reader" has to mean at a call
// site rather than only inside the function.
for (const stored of ["archived", "completed", "pending", "draft"]) {
  test(`list cards projects a ${stored} card's status intact`, async () => {
    const { cards } = harness({ status: stored });
    const result = await cards.handlers.listCards({ projectId: "proj_1", kind: null });
    assert.equal(
      result.cards[0].status,
      stored,
      "the stored card status must reach the projection unchanged",
    );
  });
}

test("an archived card lands in the archived column, not a phase", async () => {
  // The consequence, which is what a reader sees. `buildBoardColumnFor` reads the
  // PROJECTED status, so a status mangled by the wrong reader moves the card to a
  // live phase column and the board shows a finished card as work in progress.
  const { cards } = harness({ status: "archived" });
  const result = await cards.handlers.listCards({ projectId: "proj_1", kind: null });
  assert.equal(result.cards[0].status, "archived");
  assert.equal(buildBoardColumnFor(result.cards[0]), "archived");
});

test("read card files rejects workspace escapes and reads text", async () => {
  const { cards } = harness();
  assert.equal((await cards.handlers.readCardFile({ cardId: card.id, path: "../secret" })).error, "Path escapes the workspace.");
  assert.equal((await cards.handlers.readCardFile({ cardId: card.id, path: "notes.md" })).content, "artifact");
});

// One creation harness for both spawn decisions: the stub keeps the args the
// spawn was handed, because discarding them is exactly why a card could lose
// its reasoning level with the whole suite green.
function creationHarness(presetOverrides = {}) {
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
    ...presetOverrides,
  };
  const spawns = [];
  const insert = creationDb();
  const create = createCardInternal(
    creationDeps({ preset, db: insert.db, spawns }),
  );
  return { create, spawns, inserted: insert.values };
}

function creationDeps({ preset, db, spawns }) {
  return {
    db,
    bb: creationBb(),
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
    spawnInitial: async (args) => { spawns.push(args); return { id: "thread_1" }; },
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
  };
}

function creationDb() {
  const written = { values: null };
  const db = {
    prepare(sql) {
      return {
        get: () => sql.includes("stage_presets") ? { preset_id: "preset_1" } : undefined,
        run: (...values) => { written.values = values; },
      };
    },
  };
  return { db, values: () => written.values };
}

function creationBb() {
  return {
    sdk: { projects: { get: async () => ({ id: "proj_1", sources: [{ path: "/workspace", hostId: "host_1" }] }) } },
    storage: { kv: { set: async () => undefined } },
    realtime: { publish: () => undefined },
  };
}

const buildRequest = (start) => ({
  projectId: "proj_1",
  prompt: "Improve the thing",
  attachments: [],
  intent: "feature",
  appetite: "Lean",
  reviewMode: "Auto",
  start,
});

test("deferred build creation stores the card kind and never spawns a worker", async () => {
  const { create, spawns, inserted } = creationHarness();
  const result = await create(buildRequest(false));
  assert.deepEqual(result, { cardId: "card_created", threadId: null });
  assert.equal(spawns.length, 0);
  assert.equal(inserted()[CARD_COLUMNS.indexOf("kind")], "build");
});

test("the initial spawn carries the preset's reasoning level with its provider and model", async () => {
  const { create, spawns } = creationHarness({
    provider_id: "acp-opencode",
    model_id: "opencode/space-bunny-free",
    reasoning_level: "high",
  });
  await create(buildRequest(true));
  const args = spawns.at(-1);
  assert.equal(args.providerId, "acp-opencode");
  assert.equal(args.model, "opencode/space-bunny-free");
  // The host accepts provider, model and reasoning level only together, so the
  // three are pinned as a tuple: dropping the level, or making it conditional
  // while the other two are unconditional, must fail here.
  assert.equal(args.reasoningLevel, "high");
  assert.equal(args.executionInputSources.reasoningLevel, "explicit");
});

test("the composer's choice overrides the preset's level per field", async () => {
  const { create, spawns } = creationHarness({ reasoning_level: "high" });
  await create({ ...buildRequest(true), execution: { reasoningLevel: "banana" } });
  const args = spawns.at(-1);
  assert.equal(args.reasoningLevel, "high", "a level no host will spawn never reaches the worker");
});

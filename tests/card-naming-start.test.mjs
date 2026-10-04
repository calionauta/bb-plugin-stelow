import assert from "node:assert/strict";
import test from "node:test";
import { heuristicDisplayName } from "../lib/draft-burst.mjs";
import { needsNaming } from "../lib/card-naming.mjs";
import { createWorkers } from "../server/workers.ts";
import { workerTestDb } from "./helpers/worker-test-db.mjs";

test("heuristic-still title needs naming", () => {
  const prompt = "Fix the login redirect after SSO timeout handling";
  assert.equal(needsNaming({ displayName: heuristicDisplayName(prompt, "fix-the-login"), name: "fix-the-login", prompt }), true);
});

test("human-renamed title does not need naming", () => {
  assert.equal(needsNaming({ displayName: "SSO redirect fix", name: "fix-the-login", prompt: "Fix the login redirect after SSO timeout handling" }), false);
});

test("empty prompt falls back to slug and still counts as unsettled", () => {
  assert.equal(needsNaming({ displayName: "stelow", name: "stelow", prompt: "" }), true);
  assert.equal(needsNaming({ displayName: "stelow", name: "stelow", prompt: "   " }), true);
});

test("truncated heuristic title still matches", () => {
  const prompt = "word ".repeat(40).trim();
  const expected = heuristicDisplayName(prompt, "slug");
  assert.ok(expected.length <= 60);
  assert.equal(needsNaming({ displayName: expected, name: "slug", prompt }), true);
  assert.equal(needsNaming({ displayName: `${expected} extra`, name: "slug", prompt }), false);
});

test("empty or missing title never counts as unsettled", () => {
  assert.equal(needsNaming({ displayName: "", name: "slug", prompt: "Something" }), false);
  assert.equal(needsNaming({ displayName: null, name: "slug", prompt: "Something" }), false);
  assert.equal(needsNaming(), false);
  assert.equal(needsNaming(null), false);
});

test("prompt edit moves a heuristic title with it", () => {
  const before = "Fix the login redirect";
  const after = "Fix the login redirect after SSO timeout handling";
  const stale = heuristicDisplayName(before, "fix-the-login");
  assert.equal(needsNaming({ displayName: stale, name: "fix-the-login", prompt: after }), false);
  assert.equal(needsNaming({ displayName: heuristicDisplayName(after, "fix-the-login"), name: "fix-the-login", prompt: after }), true);
});

const startPreset = {
  id: "preset-a",
  name: "Primary",
  provider_id: "pi",
  model_id: "bifrost/harness-coding",
  reasoning_level: "medium",
  permission_mode: "full",
  environment_kind: "project-default",
  base_branch: null,
  machine_id: null,
  instructions: "",
  providerId: "pi",
  modelId: "bifrost/harness-coding",
  reasoningLevel: "medium",
  permissionMode: "full",
  environmentKind: "project-default",
  baseBranch: null,
  machineId: null,
};

function startCardFixture({ displayName, prompt }) {
  return {
    id: "card-1",
    project_id: "project-1",
    name: "fix-the-login-redirect",
    display_name: displayName,
    prompt,
    intent: "feature",
    status: "draft",
    stage: "triage",
    activity: "idle",
    worker_thread_id: null,
    worker_preset_id: startPreset.id,
    preset_restart_pending: 0,
    dir_hash: "hash-1",
    auto_continue_count: 0,
    auto_continue_stage: null,
    spawn_retry_count: 0,
    spawn_retry_thread: null,
    attachments: "[]",
    workspace_kind: "project",
    workspace_path: null,
    workspace_host_id: null,
    kind: "build",
    research_strategy: null,
    research_strategies: null,
    explore_stage: null,
    last_error: null,
    last_assistant_text: null,
    last_idle_at: null,
    environment_label: "Project source",
    created_at: 1,
    updated_at: 1,
  };
}

function startBbStub() {
  return {
    sdk: {
      threads: {
        spawn: async () => ({ id: "thread-new", environmentId: "env-ready" }),
        archive: async () => {},
        stop: async () => {},
        get: async () => ({ environmentId: "env-ready" }),
        list: async () => [],
        events: { list: async () => [] },
      },
      environments: { get: async () => ({ id: "env-ready", status: "ready", path: "/repo" }) },
      files: { write: async () => ({}) },
    },
    realtime: { publish: () => {} },
  };
}

function startHarness({ displayName, prompt, withRefresh = true }) {
  const db = workerTestDb();
  const fired = [];
  const calls = [];
  const current = startCardFixture({ displayName, prompt });
  const bb = startBbStub();
  const workers = createWorkers({
    db,
    bb,
    now: () => 100,
    getCard: () => current,
    updateCard: (cardId, fields) => calls.push(["updateCard", cardId, fields]),
    comment: () => {},
    getPreset: () => startPreset,
    getReliablePreset: () => startPreset,
    presetParams: (value) => value,
    prepareRespawn: async () => ({ prompt: "Continue", projectPath: "/repo", workspace: { path: "/repo", hostId: "host-a" } }),
    resetAutoContinue: () => ({ count: 0, stage: null }),
    ...(withRefresh ? { titleRefresh: { request: (cardId) => void fired.push(cardId) } } : {}),
    errors: { cardNotFound: "Card not found.", cardArchived: "This card is archived.", presetNotFound: "Preset not found." },
  });
  return { db, workers, fired, current };
}

test("Start fires the title hook once for a heuristic title", async () => {
  const prompt = "Fix the login redirect after SSO timeout handling";
  const { db, workers, fired } = startHarness({
    displayName: heuristicDisplayName(prompt, "fix-the-login-redirect"),
    prompt,
  });
  const result = await workers.fresh("card-1", "start");
  assert.deepEqual(result, { ok: true, error: null });
  assert.deepEqual(fired, ["card-1"]);
  workers.dispose();
  db.close();
});

test("Start does not fire the title hook for a human-renamed card", async () => {
  const { db, workers, fired } = startHarness({ displayName: "SSO redirect fix", prompt: "Fix the login redirect after SSO timeout handling" });
  const result = await workers.fresh("card-1", "start");
  assert.deepEqual(result, { ok: true, error: null });
  assert.deepEqual(fired, []);
  workers.dispose();
  db.close();
});

test("Start without a bound hook behaves as before", async () => {
  const prompt = "Fix the login redirect after SSO timeout handling";
  const { db, workers } = startHarness({
    displayName: heuristicDisplayName(prompt, "fix-the-login-redirect"),
    prompt,
    withRefresh: false,
  });
  const result = await workers.fresh("card-1", "start");
  assert.deepEqual(result, { ok: true, error: null });
  workers.dispose();
  db.close();
});

test("concurrent bursts for one card spawn a single title thread", async () => {
  const { createTitleBurst } = await import("../server/title-burst.ts");
  let releaseWait = () => {};
  const waited = new Promise((resolve) => { releaseWait = resolve; });
  const spawns = [];
  const titles = [];
  const card = {
    id: "card-9",
    project_id: "project-1",
    prompt: "Fix the login redirect after SSO timeout handling",
    kind: "build",
    display_name: "Fix login",
    name: "fix-the-login",
  };
  const suggestCardName = createTitleBurst({
    getCard: () => card,
    isArchivedCard: () => false,
    resolveGenerationPreset: () => ({ preset: { id: "p", name: "P" }, source: null }),
    presetParams: () => ({}),
    spawnTitle: async () => { spawns.push(card.id); return { id: "thread-t" }; },
    stopThread: async () => {},
    comment: () => {},
    publish: () => {},
    readOutput: async () => "A good title here",
    waitForThread: async () => { await waited; return { status: "idle", timedOut: false }; },
    writeTitle: (cardId, name) => titles.push([cardId, name]),
    log: () => {},
  });
  const first = suggestCardName(card.id);
  const second = suggestCardName(card.id);
  releaseWait();
  await Promise.all([first, second]);
  assert.equal(spawns.length, 1, "the second trigger while a burst is in flight spawns nothing");
  assert.deepEqual(titles, [[card.id, "A good title here"]]);
});

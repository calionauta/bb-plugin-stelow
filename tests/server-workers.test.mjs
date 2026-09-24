import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  createWorkers,
  runWorkerMigrations,
  workerEnvironment,
} from "../server/workers.ts";
import { createWorkerRetry } from "../server/workers-retry.ts";

const preset = {
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
};

function card(overrides = {}) {
  return {
    id: "card-1",
    project_id: "project-1",
    name: "card-one",
    display_name: "Card One",
    prompt: "Do the work",
    intent: "feature",
    status: "in-progress",
    stage: "triage",
    activity: "running",
    worker_thread_id: "thread-old",
    worker_preset_id: preset.id,
    preset_restart_pending: 0,
    dir_hash: "hash-1",
    auto_continue_count: 2,
    auto_continue_stage: "triage",
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
    ...overrides,
  };
}

function database() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE cards (id TEXT PRIMARY KEY);
    CREATE TABLE presets (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  `);
  db.prepare("INSERT INTO presets VALUES (?, ?)").run(preset.id, preset.name);
  runWorkerMigrations(db);
  db.prepare("INSERT INTO cards (id) VALUES (?)").run("card-1");
  return db;
}

function harness({ spawnError = null, environment = null } = {}) {
  const db = database();
  const calls = [];
  const current = card();
  const bb = {
    sdk: {
      threads: {
        spawn: async (args) => {
          calls.push(["spawn", args]);
          if (spawnError) throw new Error(spawnError);
          return { id: "thread-new", environmentId: "env-ready" };
        },
        archive: async (args) => calls.push(["archive", args]),
        stop: async (args) => calls.push(["stop", args]),
        get: async () => ({ environmentId: "env-ready" }),
        list: async () => [],
        events: { list: async () => [] },
      },
      environments: {
        get: async () => environment ?? { id: "env-ready", status: "ready", path: "/repo" },
      },
      files: { write: async () => ({}) },
    },
    realtime: { publish: (event, payload) => calls.push([event, payload]) },
  };
  const workers = createWorkers({
    db,
    bb,
    now: () => 100,
    getCard: () => current,
    updateCard: () => {},
    comment: (cardId, body) => calls.push(["comment", cardId, body]),
    getPreset: () => preset,
    getReliablePreset: () => preset,
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
    cardWorkspace: async () => ({ path: "/repo", hostId: "host-a" }),
    prepareRespawn: async () => ({
      prompt: "Continue the card",
      projectPath: "/repo",
      stateDir: "/repo/.stelow/2026-01-01/hash-1",
      workspace: { path: "/repo", hostId: "host-a" },
    }),
    resetAutoContinue: () => ({ count: 0, stage: null }),
    errors: {
      cardNotFound: "Card not found.",
      cardArchived: "This card is archived.",
      presetNotFound: "Preset not found.",
    },
  });
  return { db, bb, calls, workers, current };
}

test("worker migrations are idempotent and create the retry/ledger columns", () => {
  const db = database();
  runWorkerMigrations(db);
  const columns = db.prepare("PRAGMA table_info(cards)").all().map((row) => row.name);
  assert.ok(columns.includes("spawn_retry_thread"));
  assert.ok(columns.includes("environment_label"));
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'card_threads'").get();
  assert.equal(table.name, "card_threads");
  db.close();
});

test("environment selection pins project-default workers to declared source", () => {
  assert.deepEqual(workerEnvironment(
    { path: "/repo", hostId: "host-source" },
    { environmentKind: "project-default", machineId: "host-machine" },
  ), {
    type: "host",
    hostId: "host-machine",
    workspace: { type: "unmanaged", path: "/repo" },
  });
  assert.deepEqual(workerEnvironment(
    { path: "/repo", hostId: "host-source" },
    { environmentKind: "new-worktree", machineId: null },
    true,
  ), {
    type: "host",
    hostId: "host-source",
    workspace: { type: "unmanaged", path: "/repo" },
  });
});

test("respawn stops the predecessor only after the replacement exists", async () => {
  const { db, calls, workers } = harness();
  const result = await workers.respawn("card-1", preset.id, "restart");
  assert.deepEqual(result, { ok: true, threadId: "thread-new" });
  assert.deepEqual(calls.slice(0, 3).map(([name]) => name), ["spawn", "archive", "stop"]);
  const rows = db.prepare("SELECT thread_id, ended_reason, ended_at FROM card_threads ORDER BY started_at").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].thread_id, "thread-new");
  db.close();
});

test("failed respawn preserves the old worker instead of parking the card", async () => {
  const { db, calls, workers } = harness({ spawnError: "thread.start failed" });
  const result = await workers.respawn("card-1", preset.id, "restart");
  assert.equal(result.ok, false);
  assert.match(result.error, /thread.start failed/);
  assert.equal(calls.some(([name]) => name === "archive"), false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM card_threads").get().n, 0);
  db.close();
});

test("continuing workers reuse their live environment and ledger ownership is queryable", async () => {
  const { db, workers } = harness();
  workers.recordThread("card-1", "thread-old", preset.id, "initial");
  await new Promise((resolve) => setTimeout(resolve, 2));
  workers.recordThread("card-1", "thread-new", preset.id, "restart");
  assert.deepEqual(await workers.continuingEnvironment(card(), { type: "project-default" }), {
    type: "reuse",
    environmentId: "env-ready",
  });
  assert.equal(workers.ledgerCardId("thread-old"), "card-1");
  assert.deepEqual(workers.ledgerThreadIds("card-1", 1), ["thread-new"]);
  const history = await workers.history("card-1");
  assert.equal(history[0].threadId, "thread-new");
  assert.equal(history[0].presetName, "Primary");
  assert.equal(history[0].children.length, 0);
  db.close();
});

test("retry claims are persisted and terminal workers never schedule recovery", async () => {
  const db = database();
  const updates = [];
  const retry = createWorkerRetry({
    db,
    getCard: () => card(),
    updateCard: (cardId, fields) => updates.push([cardId, fields]),
    comment: () => {},
    publish: () => {},
    fresh: async () => ({ ok: true, error: null }),
    failedCause: async () => null,
  });
  await retry.applyFailed("card-1", "thread-old", "ApiError 502 Bad Gateway");
  const claimed = db.prepare("SELECT spawn_retry_count AS count, spawn_retry_thread AS thread FROM cards WHERE id = ?").get("card-1");
  assert.equal(claimed.count, 1);
  assert.equal(claimed.thread, "thread-old");
  assert.equal(updates[0][1].activity, "running");
  retry.dispose();
  db.close();

  const terminalDb = database();
  const terminalUpdates = [];
  const terminalRetry = createWorkerRetry({
    db: terminalDb,
    getCard: () => card({ status: "completed" }),
    updateCard: (cardId, fields) => terminalUpdates.push(fields),
    comment: () => {},
    publish: () => {},
    fresh: async () => ({ ok: true, error: null }),
    failedCause: async () => null,
  });
  await terminalRetry.applyFailed("card-1", "thread-old", "ApiError 502 Bad Gateway");
  assert.deepEqual(terminalUpdates, []);
  assert.equal(terminalDb.prepare("SELECT spawn_retry_count AS count FROM cards").get().count, 0);
  terminalDb.close();
});

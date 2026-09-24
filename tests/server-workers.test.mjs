import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  createWorkers,
  runWorkerMigrations,
  workerEnvironment,
} from "../server/workers.ts";

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

function workerHost(calls, spawnError, environment) {
  return {
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
}

function attachmentParams(value) {
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

function harness({
  spawnError = null,
  environment = null,
  workerThreadId = "thread-old",
  scheduler = undefined,
  retryDelayMs = undefined,
} = {}) {
  const db = database();
  const calls = [];
  const current = card({ worker_thread_id: workerThreadId });
  const bb = workerHost(calls, spawnError, environment);
  const workers = createWorkers({
    db,
    bb,
    now: () => 100,
    getCard: () => current,
    updateCard: (cardId, fields) => calls.push(["updateCard", cardId, fields]),
    comment: (cardId, body) => calls.push(["comment", cardId, body]),
    getPreset: () => preset,
    getReliablePreset: () => preset,
    presetParams: attachmentParams,
    prepareRespawn: async () => ({
      prompt: "Continue the card",
      projectPath: "/repo",
      workspace: { path: "/repo", hostId: "host-a" },
    }),
    resetAutoContinue: () => ({ count: 0, stage: null }),
    scheduler,
    retryDelayMs,
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

test("fresh start refuses invalid states and completes success side effects", async () => {
  const started = harness({ workerThreadId: null });
  started.db.prepare("UPDATE cards SET spawn_retry_count = 2, spawn_retry_thread = ? WHERE id = ?")
    .run("thread-old", "card-1");
  const result = await started.workers.fresh("card-1", "start");
  assert.deepEqual(result, { ok: true, error: null });
  assert.ok(started.calls.some(([name, , body]) => name === "comment" && body.includes("continuing from the triage stage")));
  assert.ok(started.calls.some(([name, , fields]) => name === "updateCard" && fields.auto_continue_count === 0));
  assert.ok(started.calls.some(([name]) => name === "card-state"));
  const retry = started.db.prepare("SELECT spawn_retry_count AS count, spawn_retry_thread AS thread FROM cards").get();
  assert.deepEqual(retry, { count: 0, thread: null });
  started.workers.dispose();
  started.db.close();

  const archived = harness({ workerThreadId: null });
  archived.current.status = "archived";
  assert.deepEqual(await archived.workers.fresh("card-1", "start"), {
    ok: false,
    error: "This card is archived.",
  });
  assert.equal(archived.calls.some(([name]) => name === "spawn"), false);
  archived.workers.dispose();
  archived.db.close();

  const existing = harness();
  assert.deepEqual(await existing.workers.fresh("card-1", "start"), {
    ok: false,
    error: "This card already has a worker thread.",
  });
  existing.workers.dispose();
  existing.db.close();
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

test("initial and prepared replacement spawns share the worker spawn seam", async () => {
  const initial = harness({ workerThreadId: null });
  const args = { projectId: "project-1", environment: { type: "project-default" }, prompt: "Start" };
  const spawned = await initial.workers.spawnInitial(args);
  assert.equal(spawned.id, "thread-new");
  assert.deepEqual(initial.calls[0], ["spawn", args]);
  const workflow = await initial.workers.spawnWorkflow({ ...args, prompt: "Workflow" });
  assert.equal(workflow.id, "thread-new");
  assert.deepEqual(initial.calls[1], ["spawn", { ...args, prompt: "Workflow" }]);
  initial.workers.dispose();
  initial.db.close();

  const replaced = harness();
  const next = await replaced.workers.replacePrepared(
    { projectId: "project-1", environment: { type: "project-default" }, prompt: "Restart" },
    "thread-old",
  );
  assert.equal(next.id, "thread-new");
  assert.deepEqual(replaced.calls.slice(0, 3).map(([name]) => name), ["spawn", "archive", "stop"]);
  replaced.workers.dispose();
  replaced.db.close();
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

test("deferred respawn is cancelled when the worker lifecycle is disposed", async () => {
  const { calls, workers } = harness();
  workers.scheduleRespawn("card-1", preset.id);
  workers.dispose();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.some(([name]) => name === "spawn"), false);
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
  assert.equal(workers.ledgerCardId("thread-missing"), null);
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

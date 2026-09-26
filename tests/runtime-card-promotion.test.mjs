import assert from "node:assert/strict";
import test from "node:test";
import { createCardPromotion } from "../server/runtime/card-promotion.ts";

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

test("promotion rollback restores exploratory ownership and publishes both views", async () => {
  const writes = [];
  const publishes = [];
  const promote = createCardPromotion({
    db: { prepare: (sql) => ({ run: (...args) => writes.push([sql, ...args]) }) },
    bb: {
      sdk: { projects: {
        list: async () => [],
        create: async () => ({ id: "proj_2" }),
      } },
      realtime: { publish: (...args) => publishes.push(args) },
    },
    now: () => 20,
    getCard: () => card(),
    cardWorkspace: async () => ({ path: "/project", hostId: "host_1" }),
    recoverySnapshot: async () => ({ kind: "promote" }),
    getReliablePreset: () => preset(),
    getCardPreset: () => preset(),
    respawn: async () => ({ ok: false, error: "spawn failed" }),
    logComment: () => undefined,
    errors: { cardNotFound: "missing", cardArchived: "archived", workspaceUnavailable: "workspace" },
  });
  const result = await promote({ cardId: "card_1", name: "Project" });
  assert.equal(result.ok, false);
  assert.match(result.error, /remains exploratory/);
  assert.equal(writes.length, 2);
  assert.match(writes[1][0], /workspace_kind = 'exploratory'/);
  assert.deepEqual(writes[1].slice(1), [
    "proj_1", "/project", "host_1", "running", null, 20, "card_1",
  ]);
  assert.deepEqual(publishes.map(([event]) => event), ["card-state", "board-changed"]);
});

test("promotion success records the worker handoff before publishing", async () => {
  const calls = [];
  const promote = createCardPromotion({
    db: { prepare: () => ({ run: () => calls.push(["write"]) }) },
    bb: {
      sdk: { projects: { list: async () => [], create: async () => ({ id: "proj_2" }) } },
      realtime: { publish: (...args) => calls.push(["publish", ...args]) },
    },
    now: () => 20,
    getCard: () => card(),
    cardWorkspace: async () => ({ path: "/project", hostId: "host_1" }),
    recoverySnapshot: async () => ({ kind: "promote" }),
    getReliablePreset: () => preset(),
    getCardPreset: () => preset(),
    respawn: async (...args) => {
      calls.push(["respawn", ...args]);
      return { ok: true, threadId: "thread_2" };
    },
    logComment: (...args) => calls.push(["comment", ...args]),
    errors: { cardNotFound: "missing", cardArchived: "archived", workspaceUnavailable: "workspace" },
  });
  assert.deepEqual(await promote({ cardId: "card_1", name: "Project" }), {
    ok: true,
    projectId: "proj_2",
    projectName: "Project",
    threadId: "thread_2",
    error: null,
  });
  assert.deepEqual(calls.map(([name]) => name), [
    "write", "respawn", "comment", "publish", "publish",
  ]);
  assert.match(calls[2][2], /new project worker continues from the current stage/);
});

test("promotion refuses an empty host before creating a project", async () => {
  let created = false;
  const promote = createCardPromotion({
    db: { prepare: () => ({ run: () => undefined }) },
    bb: {
      sdk: { projects: {
        list: async () => [],
        create: async () => {
          created = true;
          return { id: "proj_2" };
        },
      } },
      realtime: { publish: () => undefined },
    },
    now: () => 20,
    getCard: () => card(),
    cardWorkspace: async () => ({ path: "/project", hostId: "" }),
    recoverySnapshot: async () => ({ kind: "promote" }),
    getReliablePreset: () => preset(),
    getCardPreset: () => preset(),
    respawn: async () => ({ ok: true, threadId: "thread_2" }),
    logComment: () => undefined,
    errors: { cardNotFound: "missing", cardArchived: "archived", workspaceUnavailable: "workspace" },
  });
  assert.equal((await promote({ cardId: "card_1", name: "Project" })).error,
    "Workspace host is unavailable.");
  assert.equal(created, false);
});

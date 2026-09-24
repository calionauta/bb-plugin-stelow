import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { createDraftingServer } from "../server/drafting.ts";

function card(overrides = {}) {
  return {
    id: "card-1",
    project_id: "proj-1",
    name: "login-loop",
    display_name: "Login loop",
    prompt: "Fix the Safari login redirect loop",
    intent: "bugfix",
    status: "running",
    stage: "build",
    activity: "running",
    worker_thread_id: "worker-1",
    worker_preset_id: "band",
    preset_restart_pending: null,
    dir_hash: "hash-1",
    auto_continue_count: null,
    auto_continue_stage: null,
    spawn_retry_count: null,
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
    environment_label: null,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

const preset = (id, overrides = {}) => ({
  id,
  name: id,
  provider_id: "pi",
  model_id: "bifrost/draft",
  reasoning_level: "low",
  permission_mode: "accept-edits",
  environment_kind: "project-default",
  machine_id: null,
  ...overrides,
});

function harness(options = {}) {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE cards (id TEXT PRIMARY KEY, display_name TEXT, updated_at INTEGER)");
  const current = card(options.card);
  db.prepare("INSERT INTO cards VALUES (?, ?, ?)").run(
    current.id,
    current.display_name,
    current.updated_at,
  );
  const band = options.band ?? preset("band");
  const generation = options.generation === undefined ? preset("generation") : options.generation;
  const spawns = [];
  const stops = [];
  const comments = [];
  const events = [];
  const writes = [];
  let gets = 0;
  const bb = {
    sdk: {
      threads: {
        get: async () => {
          gets += 1;
          return { status: options.statuses?.[gets - 1] ?? "idle" };
        },
        output: async () => ({ output: options.output ?? "A useful draft" }),
      },
      files: {
        mkdir: async () => undefined,
        write: async (value) => writes.push(value),
      },
    },
  };
  const server = createDraftingServer({
    db,
    bb,
    now: () => 2_000,
    timestamp: () => "20260101-1200",
    getCard: () => structuredClone(current),
    getCardByWorkerThread: () => structuredClone(current),
    isArchivedCard: (value) => value.status === "archived",
    cardWorkspace: async () => options.workspace ?? { path: "/repo", hostId: "host-1" },
    continuingEnvironment: async (_value, fallback) => options.environment ?? fallback,
    getPreset: (id) => [generation, band].find((value) => value?.id === id) ?? null,
    getPresetForBand: () => band,
    getGenerationPresetId: () => generation?.id ?? null,
    presetParams: (value) => ({
      providerId: value.provider_id,
      modelId: value.model_id,
      reasoningLevel: value.reasoning_level,
      permissionMode: value.permission_mode,
      environmentKind: value.environment_kind,
      machineId: value.machine_id,
    }),
    spawnDisposable: async (args, site) => {
      if (options.spawnError) throw new Error(options.spawnError);
      spawns.push({ args, site });
      if (options.renameOnSpawn) {
        current.display_name = "Human title";
        db.prepare("UPDATE cards SET display_name = ? WHERE id = ?").run(current.display_name, current.id);
      }
      return { id: "draft-1" };
    },
    stopThread: async (id) => stops.push(id),
    comment: (id, body) => comments.push({ id, body }),
    publish: (event, payload) => events.push({ event, payload }),
    stateDir: async () => "/repo/.stelow/2026/hash-1",
    workspaceRelative: () => ".stelow/2026/hash-1/drafts/draft-20260101-1200.md",
    sleep: async () => undefined,
  });
  return {
    server,
    current,
    spawns,
    stops,
    comments,
    events,
    writes,
    row: () => db.prepare("SELECT * FROM cards WHERE id = ?").get(current.id),
  };
}

test("the command seam ignores non-draft commands and refuses missing context", async () => {
  const fixture = harness();
  assert.equal(await fixture.server.command(["status"]), null);
  assert.deepEqual(await fixture.server.command(["draft", "--prompt", "copy"]), {
    exitCode: 2,
    stderr: "No card in context (run from the worker thread or pass --card <card_id>).",
  });
  assert.deepEqual(await fixture.server.command(["draft", "--prompt", " "], "worker-1"), {
    exitCode: 2,
    stderr: "Pass --prompt <brief>: one disposable draft request (prose only, never protocol work).",
  });
  const archived = harness({ card: { status: "archived" } });
  assert.deepEqual(await archived.server.command(["draft", "--prompt", "copy"], "worker-1"), {
    exitCode: 1,
    stderr: "This card is archived.",
  });
  assert.equal(archived.spawns.length, 0, "archived cards never spend a generation turn");
});

test("a successful draft follows the generation, environment, lifecycle, and record cascade", async () => {
  const fixture = harness({ environment: { type: "reuse", environmentId: "env-1" } });
  const result = await fixture.server.command(
    ["draft", "--card", "card-1", "--prompt", "Three taglines", "--json"],
  );
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    draft: "A useful draft",
    truncated: false,
    threadId: "draft-1",
    path: ".stelow/2026/hash-1/drafts/draft-20260101-1200.md",
    source: "board",
  });
  assert.equal(fixture.spawns.length, 1);
  assert.equal(fixture.spawns[0].site, "draft-burst");
  assert.equal(fixture.spawns[0].args.visibility, "hidden");
  assert.equal(fixture.spawns[0].args.lifecycleOwnerThreadId, "worker-1");
  assert.deepEqual(fixture.spawns[0].args.environment, { type: "reuse", environmentId: "env-1" });
  assert.match(fixture.spawns[0].args.prompt, /Three taglines/);
  assert.deepEqual(fixture.stops, ["draft-1"]);
  assert.match(fixture.comments[0].body, /judge every word/);
  assert.match(fixture.writes[0].content, /Preset: generation/);
});

test("an unset generation designation safely falls back to the card band preset", async () => {
  const fixture = harness({ generation: null, output: "Band draft" });
  const result = await fixture.server.command(["draft", "--prompt", "copy"], "worker-1");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "Band draft");
  assert.equal(fixture.spawns[0].args.model, "bifrost/draft");
  assert.match(fixture.comments[0].body, /generation preset unset/);
  assert.match(fixture.comments[0].body, /ran on the band preset/);
});

test("spawn, terminal failure, and timeout all leave a safe do-it-yourself result", async () => {
  const failed = harness({ spawnError: "quota exhausted" });
  const spawnResult = await failed.server.command(["draft", "--prompt", "copy"], "worker-1");
  assert.equal(spawnResult.exitCode, 1);
  assert.match(spawnResult.stderr, /quota exhausted/);

  const errored = harness({ statuses: ["error"] });
  const errorResult = await errored.server.command(["draft", "--prompt", "copy"], "worker-1");
  assert.equal(errorResult.exitCode, 1);
  assert.match(errorResult.stderr, /do the draft yourself/);
  assert.deepEqual(errored.stops, ["draft-1"]);

  const timedOut = harness({ statuses: Array(36).fill("running") });
  const timeoutResult = await timedOut.server.command(["draft", "--prompt", "copy"], "worker-1");
  assert.equal(timeoutResult.exitCode, 1);
  assert.match(timeoutResult.stderr, /after 3 minutes/);
  assert.deepEqual(timedOut.stops, ["draft-1"]);
});

test("title suggestion is advisory and never overwrites a concurrent human rename", async () => {
  const fixture = harness({ output: "Fix Safari login loop" });
  await fixture.server.suggestCardName("card-1");
  assert.equal(fixture.spawns[0].site, "card-title");
  assert.equal(fixture.spawns[0].args.visibility, "hidden");
  assert.equal("lifecycleOwnerThreadId" in fixture.spawns[0].args, false);
  assert.equal(fixture.row().display_name, "Fix Safari login loop");
  assert.deepEqual(fixture.events, [{ event: "card-state", payload: { cardId: "card-1" } }]);

  const raced = harness({ output: "Generated title", renameOnSpawn: true });
  await raced.server.suggestCardName("card-1");
  assert.equal(raced.row().display_name, "Human title");
  assert.deepEqual(raced.events, []);
});

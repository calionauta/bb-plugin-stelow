import assert from "node:assert/strict";
import test from "node:test";
import { createBuildThreadSync } from "../server/runtime/build-thread-sync.ts";
import {
  projectRunningState,
  projectStateMetadata,
  shouldSyncThread,
} from "../server/runtime/thread-state-projection.ts";

function card(overrides = {}) {
  return {
    id: "card_1",
    project_id: "project_1",
    name: "Useful",
    display_name: "Useful card",
    prompt: "Build it",
    intent: "unknown",
    status: "triage",
    stage: "triage",
    activity: "running",
    worker_thread_id: "thread_1",
    worker_preset_id: "preset_1",
    preset_restart_pending: 0,
    dir_hash: null,
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
    environment_label: null,
    created_at: 1,
    updated_at: 2,
    ...overrides,
  };
}

function createThreadApi(calls, options) {
  return {
    sdk: {
      files: {
        read: async () => ({
          content: options.state ?? "name: Useful\nintent: feature\ncurrent_stage: planning\n",
        }),
      },
      threads: {
        get: async () => {
          calls.push(["thread.get"]);
          return { status: options.status ?? "active", createdAt: 1 };
        },
        output: async () => {
          calls.push(["thread.output"]);
          return { output: options.output ?? "working" };
        },
        events: {
          list: async () => {
            calls.push(["thread.events"]);
            return [];
          },
        },
        send: async (input) => {
          calls.push(["thread.send", input]);
        },
      },
    },
  };
}

function createSyncDeps(calls, getCurrent, options) {
  let current = getCurrent();
  const db = {
    prepare(sql) {
      return {
        run(...args) {
          calls.push(["run", sql, ...args]);
        },
      };
    },
  };
  return {
    bb: createThreadApi(calls, options),
    db,
    now: () => options.now ?? 100_000,
    getCard: () => current,
    cardWorkspace: async () => ({ path: "/project", hostId: "host_1" }),
    workflowStateDir: async () => options.stateDir === null ? null : "/project/.stelow/run",
    updateCard: (_id, fields) => {
      calls.push(["update", fields]);
      current = { ...current, ...fields };
    },
    syncResearch: async () => calls.push(["research"]),
    syncExplore: async () => calls.push(["explore"]),
    syncQuestions: async () => Object.hasOwn(options, "questions") ? options.questions : [],
    applyFailed: async (...args) => calls.push(["failed", ...args]),
    logComment: (id, body) => calls.push(["comment", id, body]),
    recordInbox: (...args) => calls.push(["inbox", ...args]),
    vetContinuation: async () => {
      calls.push(["vet"]);
      return true;
    },
    escalateIfStalled: () => calls.push(["escalate"]),
    stripMessageDirectives: (text) => text,
    interfacePick: "Choose the interface.",
    auditDoneNudge: "Run bb stelow done.",
    idleAttentionMs: 90_000,
  };
}

function harness(row, options = {}) {
  const calls = [];
  let current = row;
  const deps = createSyncDeps(calls, () => current, options);
  return { calls, deps, sync: createBuildThreadSync(deps), row: deps.getCard };
}

test("active build sync projects state metadata and running activity", async () => {
  const fixture = harness(card());
  await fixture.sync(fixture.row().id);

  assert.equal(shouldSyncThread(fixture.row()), true);
  assert.equal(projectStateMetadata(card(), "name: Useful\nintent: feature\n").intent, "feature");
  assert.equal(projectStateMetadata(card(), "name: Other\nintent: feature\n").intent, null);
  assert.deepEqual(
    projectRunningState(card(), "planning", "working", []),
    { activity: "running", last_assistant_text: "working", status: "triage", stage: "planning" },
  );
  const running = fixture.calls.find(
    ([name, fields]) => name === "update" && fields.activity === "running",
  );
  assert.deepEqual(running[1], {
    activity: "running",
    last_assistant_text: "working",
    status: "triage",
    stage: "planning",
  });
  const intentWrite = fixture.calls.findIndex(
    ([name, sql]) => name === "run" && sql.includes("SET intent"),
  );
  const threadRead = fixture.calls.findIndex(([name]) => name === "thread.get");
  assert.ok(intentWrite >= 0 && intentWrite < threadRead, "intent persists before a remote thread read");
  assert.equal(fixture.calls.at(-1)[0], "escalate");
});

test("idle no-progress transition persists attention instead of resuming", async () => {
  const fixture = harness(
    card({
      status: "in-progress",
      stage: "shape",
      activity: "running",
      last_assistant_text: "same output",
    }),
    {
      status: "idle",
      output: "same output",
      state: "name: Useful\ncurrent_stage: shape\n",
    },
  );
  await fixture.sync(fixture.row().id);

  const update = fixture.calls.find(([name, fields]) => name === "update" && fields.activity === "idle");
  assert.equal(update[1].last_idle_at, 10_000, "a silent stop backdates one attention window");
  assert.equal(fixture.calls.some(([name]) => name === "thread.send"), false, "no progress never resumes");
  assert.equal(fixture.calls.some(([name, , kind]) => name === "inbox" && kind === "paused"), true);
  assert.equal(fixture.calls.some(([name]) => name === "escalate"), true);
});

test("successful idle recovery sends before recording its budget", async () => {
  const fixture = harness(
    card({ status: "in-progress", stage: "shape", activity: "running" }),
    { status: "idle", output: "fresh progress" },
  );
  await fixture.sync(fixture.row().id);

  const send = fixture.calls.findIndex(([name]) => name === "thread.send");
  const update = fixture.calls.findIndex(
    ([name, fields]) => name === "update" && fields.auto_continue_count === 1,
  );
  assert.ok(send >= 0 && send < update, "the card records recovery only after send succeeds");
  const sentInput = fixture.calls[send][1];
  assert.equal(sentInput.threadId, "thread_1");
  assert.equal(sentInput.mode, "auto");
  assert.equal(sentInput.input[0].visibility, "agent-only");
  assert.equal(fixture.calls.some(([name, , kind]) => name === "inbox" && kind === "paused"), false);
  assert.equal(fixture.calls.some(([name]) => name === "escalate"), false);
});

test("question-read uncertainty stops sync without changing the card", async () => {
  const fixture = harness(card(), { questions: null });
  await fixture.sync(fixture.row().id);

  assert.equal(fixture.calls.some(([name, fields]) => name === "update" && fields.activity), false);
  assert.equal(fixture.calls.some(([name]) => name === "escalate"), false);
});

test("idle question wait keeps position and still records fresh output", async () => {
  const fixture = harness(
    card({ stage: "planning", activity: "running" }),
    { status: "idle", output: "before question", questions: ["question_1"] },
  );
  await fixture.sync(fixture.row().id);

  const wait = fixture.calls.find(
    ([name, fields]) => name === "update" && fields.activity === "awaiting-answer",
  );
  assert.deepEqual(wait[1], {
    activity: "awaiting-answer",
    last_assistant_text: "before question",
  });
  assert.equal(
    fixture.calls.some(([name, , body]) => name === "comment" && body === "before question"),
    true,
  );
});

test("audit idle never implies completion when the done budget is spent", async () => {
  const fixture = harness(
    card({
      status: "in-progress",
      stage: "audit",
      activity: "running",
      auto_continue_count: 2,
      auto_continue_stage: "audit",
    }),
    {
      status: "idle",
      output: "audit narrated",
      state: "name: Useful\ncurrent_stage: audit\n",
    },
  );
  await fixture.sync(fixture.row().id);

  assert.equal(fixture.calls.some(([name]) => name === "thread.send"), false);
  assert.equal(
    fixture.calls.some(([name, fields]) => name === "update" && fields.status === "completed"),
    false,
  );
  assert.equal(fixture.calls.filter(([name]) => name === "comment").length, 2);
  assert.equal(fixture.calls.at(-1)[0], "escalate");
});

test("terminal and unverifiable ownership refusals are negative controls", async () => {
  const completed = harness(card({ status: "completed" }));
  await completed.sync("card_1");
  assert.deepEqual(completed.calls, [], "completed cards never read or write worker state");

  const unverifiable = harness(card({ dir_hash: "hash_1" }), { stateDir: null });
  await unverifiable.sync("card_1");
  assert.equal(unverifiable.calls.some(([name]) => name === "thread.get"), false);
  assert.match(
    unverifiable.calls.find(([name]) => name === "update")[1].last_error,
    /ownership cannot be verified/,
  );
});

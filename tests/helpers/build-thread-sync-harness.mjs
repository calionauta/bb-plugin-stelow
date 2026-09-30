// The build-card sync harness, shared.
//
// It was inline in tests/build-thread-sync.test.mjs until the unreadable-read
// trace pushed that file past the 400-line budget — and the budget's answer is
// a split, not a baseline entry. Fixture and fake host in one place also means
// a second suite asserting on the same sync reads the same card row, so a
// fixture change cannot make two suites disagree about what a card is.
//
// Every dep the sync declares is a recorder here. That is deliberate: the
// tests assert on what the sync DID (which host reads, which writes, which
// notification), and a dep that is not a recorder is a dep no test can pin.
import { createBuildThreadSync } from "../../server/runtime/build-thread-sync.ts";

export function card(overrides = {}) {
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
            return options.events ?? [];
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
    resolveWorkflowStateDir: async () => {
      if (options.stateDir === null) return { kind: "unowned" };
      if (options.stateDir === "unreadable") return { kind: "unreadable" };
      return { kind: "resolved", path: "/project/.stelow/run", state: options.state ?? "name: Useful\nintent: feature\ncurrent_stage: planning\n" };
    },
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
    noteUnreadable: (id) => calls.push(["noteUnreadable", id]),
    noteReadable: (id) => calls.push(["noteReadable", id]),
    forgetUnreadable: (id) => calls.push(["forgetUnreadable", id]),
  };
}

/**
 * `options.stateDir` picks the ownership answer the fake host gives: `null` is
 * `unowned` (the reseed verdict), `"unreadable"` is a host that never
 * answered, and anything else is a resolved read. `options.events` is the
 * finished turn's event history, empty when the caller does not care.
 */
export function harness(row, options = {}) {
  const calls = [];
  let current = row;
  const deps = createSyncDeps(calls, () => current, options);
  return { calls, deps, sync: createBuildThreadSync(deps), row: deps.getCard };
}

/** The one inbox event the terminal park writes, for assertions on its copy. */
export function pausedSummary(calls, match = /./) {
  const found = calls.find(([name, , , summary]) => name === "inbox" && match.test(String(summary)));
  return found ? String(found[3]) : null;
}
import { createBuildThreadSync } from "../../server/runtime/build-thread-sync.ts";

/**
 * The shared harness for the build thread sync.
 *
 * It lives here because the sync is read by three suites — the projection
 * rules, the host-hold behaviour that sits on top of them, and the unreadable
 * -read streak — and a second copy of a 120-line fake is a second thing to
 * forget to update. Two of them grew here at the same time, on different
 * branches, which is exactly the case: each side's fake knew only its own
 * dep, and the merge that kept only one of them broke the other's suite with
 * `Cannot read properties of undefined`.
 *
 * The fake that motivated the split is the send: the host answers a dispatch
 * with a discriminated union, so a fake returning nothing makes every caller
 * read the missing field as "sent", which is precisely the bug the hold suite
 * exists to keep fixed. A duplicated fake would have hidden that again.
 */

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
    workflowStateDir: async () => (options.stateDir === null ? null : "/project/.stelow/run"),
    resolveWorkflowStateDir: async () => stateResolution(options),
    updateCard: (_id, fields) => {
      calls.push(["update", fields]);
      current = { ...current, ...fields };
    },
    syncResearch: async () => calls.push(["research"]),
    syncExplore: async () => calls.push(["explore"]),
    syncQuestions: async () => (Object.hasOwn(options, "questions") ? options.questions : []),
    readHold: async () => options.hold ?? null,
    // The unreadable-read streak, added by the shared-checkout work on master.
    // It lives here because this harness is the only place the sync's deps are
    // spelled out: a dep that is not a recorder here is a dep no test can pin.
    noteUnreadable: (id) => calls.push(["noteUnreadable", id]),
    noteReadable: (id) => calls.push(["noteReadable", id]),
    forgetUnreadable: (id) => calls.push(["forgetUnreadable", id]),
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

export function harness(row, options = {}) {
  const calls = [];
  let current = row;
  const deps = createSyncDeps(calls, () => current, options);
  return { calls, deps, sync: createBuildThreadSync(deps), row: deps.getCard };
}

/**
 * The paused sentence a run of calls produced, or null.
 *
 * It reads the inbox row's own summary rather than a shape the caller
 * reconstructs, so a test asking "what did the card tell the reader" cannot
 * pass by matching a string the test itself assembled.
 */
export function pausedSummary(calls, match = /./) {
  const found = calls.find(([name, , , summary]) => name === "inbox" && match.test(String(summary)));
  return found ? String(found[3]) : null;
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
          return options.delivery === "queued"
            ? { ok: true, delivery: "queued", queuedMessage: options.queuedMessage }
            : { ok: true, delivery: "sent" };
        },
        queuedMessages: {
          list: async () => {
            calls.push(["thread.queuedMessages"]);
            return options.queuedMessages ?? [];
          },
        },
      },
    },
  };
}

/**
 * The three answers the state lookup can give, and the two that are verdicts.
 *
 * Its own function because it is the one dep here that has a shape worth
 * reading: `unowned` is a verdict the sync turns into a refusal, and the other
 * two are not — a suite that could only produce the happy answer could not tell
 * a fail-soft path from a fail-closed one.
 */
function stateResolution(options) {
  if (options.stateDir === null) return { kind: "unowned" };
  if (options.stateDir === "unreadable") return { kind: "unreadable" };
  return {
    kind: "resolved",
    path: "/project/.stelow/run",
    state: options.state ?? "name: Useful\nintent: feature\ncurrent_stage: planning\n",
  };
}

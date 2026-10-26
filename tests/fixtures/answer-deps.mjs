/**
 * The answer doors' shared harness: a card row and the deps both answer suites
 * run against.
 *
 * Lives in `fixtures/` rather than in either test file because two suites need
 * it: the doors' own behaviour (`runtime-question-answers`) and what the wake
 * reports (`answer-delivery-wiring`). Copying it would let the two disagree
 * about what a host does with a dispatch, which is the one thing these tests
 * exist to pin.
 */

export function card(overrides = {}) {
  return {
    id: "card_1",
    project_id: "project_1",
    name: "Card",
    display_name: "Card",
    prompt: "Build",
    intent: "feature",
    status: "in-progress",
    stage: "shape",
    activity: "awaiting-answer",
    worker_thread_id: "thread_1",
    worker_preset_id: null,
    preset_restart_pending: null,
    dir_hash: "hash",
    auto_continue_count: null,
    auto_continue_stage: null,
    spawn_retry_count: null,
    spawn_retry_thread: null,
    attachments: "",
    workspace_kind: "project",
    workspace_path: null,
    workspace_host_id: null,
    kind: "build",
    research_strategy: null,
    research_strategies: null,
    explore_stage: null,
    last_error: "stale failure",
    last_assistant_text: null,
    last_idle_at: null,
    environment_label: null,
    created_at: 1_000,
    updated_at: 2_000,
    ...overrides,
  };
}

function dbStub(overrides, calls) {
  return {
    prepare(sql) {
      if (sql.includes("SELECT id, thread_id, question")) {
        return { all: () => overrides.expiredRows ?? [] };
      }
      return { run: (id) => calls.answered.push(id) };
    },
    transaction: (fn) => fn,
  };
}

export function answerDeps(overrides = {}) {
  const calls = { comments: [], sends: [], updates: [], answered: [] };
  const db = dbStub(overrides, calls);
  const bb = {
    sdk: {
      threads: {
        interactions: { respond: async () => undefined },
        // The host's dispatch is a discriminated union, never a bare truth.
        // A fake that returned `undefined` would make every answer read as a
        // hold, which is exactly the collapse this suite exists to catch.
        send: async (input) => {
          calls.sends.push(input);
          if (overrides.send) return overrides.send(input);
          return { delivery: "sent" };
        },
      },
    },
    realtime: { publish: () => undefined },
  };
  return {
    calls,
    deps: {
      bb,
      db,
      errors: { cardNotFound: "missing", cardArchived: "archived" },
      getCard: () => card(),
      isArchivedCard: () => false,
      pendingAsks: async () => overrides.asks ?? [{
        id: "ask_1",
        payload: {
          question: "Which direction?",
          multiple: false,
          options: [{ label: "A", description: "" }, { label: "B", description: "" }],
        },
      }],
      openExpiredQuestionIds: () => [],
      syncPendingQuestionInbox: () => undefined,
      syncOpenQuestionInbox: async () => [],
      markInboxQuestionsAnswered: (cardId, ids) => calls.answered.push(...ids),
      recordSplitAnswer: () => undefined,
      consumeAnsweredContract: () => ({ contract: "direction-contract", premise: null, verdict: null }),
      logCardComment: (...args) => calls.comments.push(args),
      updateCard: (cardId, fields) => calls.updates.push(fields),
      hasOpenQuestions: () => false,
      ...overrides.deps,
    },
  };
}

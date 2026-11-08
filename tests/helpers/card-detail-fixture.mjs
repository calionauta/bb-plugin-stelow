export function card(overrides = {}) {
  return {
    id: "card_1",
    project_id: "proj_1",
    name: "card",
    display_name: "Card",
    prompt: "Build a useful thing",
    intent: "feature",
    status: "in-progress",
    stage: "planning",
    activity: "running",
    worker_thread_id: null,
    worker_preset_id: null,
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
    read_miss_since: null,
    environment_label: null,
    created_at: 1,
    updated_at: 2,
    ...overrides,
  };
}

export function database() {
  return {
    prepare(_sql) {
      return {
        all: () => [],
        get: () => undefined,
        run: () => undefined,
      };
    },
  };
}

export function detailDeps(row, overrides = {}) {
  const events = [];
  const db = database();
  return {
    db,
    bb: {
      sdk: {
        projects: { get: async () => ({ name: "Project" }) },
        files: { read: async () => ({ content: "" }), listPaths: async () => ({ paths: [] }) },
        threads: { get: async () => ({ environmentId: "env_1" }) },
      },
      realtime: { publish: (...event) => events.push(event) },
    },
    now: () => 100,
    idleAttentionMs: 90_000,
    getCard: () => row,
    cardWorkspace: async () => null,
    syncThreadState: async () => undefined,
    fetchPendingQuestions: async () => [{
      id: "q1",
      title: "Question",
      question: "Choose",
      multiple: false,
      kind: "standard",
      options: [],
      expiresAt: null,
    }],
    resolveAskOptions: async (_card, options) => options,
    cardAttachments: () => [],
    detectMentionedFiles: async () => [],
    workspaceRelative: () => null,
    parseNextStages: () => ["execution"],
    getReliablePreset: () => ({ id: "p1", name: "Default", provider_id: "pi", model_id: "m1" }),
    strategyList: () => [],
    flowTimes: () => ({ leadMs: null, cycleMs: null }),
    verifiedHeadSha: () => null,
    workers: { history: async () => [] },
    executionLifecycle: { detailList: () => [] },
    stalenessForQuestions: async () => new Map(),
    stateDir: async () => null,
    fileTimestamp: (_file, fallback) => fallback,
    auditReceiptNote: () => null,
    cardNotFound: "Card not found.",
    ...overrides,
  };
}

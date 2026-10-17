// Fixtures for the runtime card-handler suite: the card row, the preset row,
// the reseed protocol/error strings, and the deps builders the reseed and
// audit-trail cases drive. Kept apart from the assertions so the test file
// reads as what each handler does rather than as the rows it is handed.
export function card(overrides = {}) {
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

const preset = (id = "preset_1") => ({
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
});

const reseedProtocols = {
  cardOwnerRules: "owner", neverSeed: "never seed", cliEquivalents: "cli",
  reconProtocol: "recon", draftProtocol: "draft", turnDiscipline: "turn",
  commitStyle: "commit", interfacePick: "pick", doneProtocol: "done", splitProtocol: "split",
 workflowIntro: "WORKFLOW_INTRO_SENTINEL",
 workflowSkills: "WORKFLOW_SKILLS_SENTINEL",

 commandFailureRule: "command failure rule",
  // The fixture must carry the phrases this test asserts on, and it must be a real
  // ask contract rather than a label: the reseed builder renders it verbatim, so a
  // placeholder here would pass the assertion while shipping a worker that cannot
  // read the rule. The two phrases are the ones the surrounding assertions pin.
  userInputContract:
    "Batch independent questions into ONE ask call by repeating --question groups (each with its own --option labels). ",
};
const reseedErrors = {
  cardNotFound: "missing", cardArchived: "archived",
  workspaceUnavailable: "workspace", presetNotFound: "preset missing",
};

export function auditDeps() {
  return {
    bb: { sdk: { files: { read: async () => ({ content: "" }) } } },
    getCard: () => card(),
    cardWorkspace: async () => ({ path: "/project", hostId: "host_1" }),
    workflowStateDir: async () => "/project/state",
    runHelper: async () => ({ code: 1, stdout: "", stderr: "failed" }),
    errors: { cardNotFound: "missing", workspaceUnavailable: "workspace" },
  };
}

export function reseedDeps(overrides = {}) {
  const noSql = { prepare: () => ({ run: () => undefined }) };
  return {
    db: noSql,
    bb: { sdk: { files: {} }, realtime: { publish: () => undefined } },
    now: () => 10,
    getCard: () => card(),
    cardWorkspace: async () => ({ path: "/project", hostId: "host_1" }),
    workflowStateDir: async () => "/state",
    readStateConfig: async () => ({ appetite: "Lean", reviewGates: ["diff"] }),
    seedWorkflow: async () => ({ error: null, dirHash: "new", stateDir: "/state" }),
    getPresetById: () => preset(),
    pinCardPreset: () => true,
    getReliablePreset: () => preset(),
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
    strategyList: () => [],
    strategyRounds: () => [],
    roundFile: () => "round.md",
    roundStamp: () => "stamp",
    roundRelativePath: (_state, _root, file) => file,
    ensureArtifactParent: async () => undefined,
    researchPrompt: () => "research",
    explorePrompt: () => "explore",
    attachments: () => [],
    continuingEnvironment: async (_value, environment) => environment,
    workerEnvironment: () => ({ type: "host" }),
    replacePrepared: async () => ({ id: "thread_2" }),
    resetAutoContinue: () => ({ count: 0, stage: null }),
    updateCard: () => undefined,
    recordThread: () => undefined,
    lineage: async () => undefined,
    publishCard: () => undefined,
    protocols: reseedProtocols,
    errors: reseedErrors,
    ...overrides,
  };
}

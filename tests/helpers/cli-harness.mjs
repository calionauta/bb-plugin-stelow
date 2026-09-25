import { createStelowCliRun } from "../../server/runtime/cli/cli-dispatcher.ts";

/** A card as the card store returns it: every field the CLI families read is
 * present, so a test exercises the same shape the composition root binds. */
export function buildCard(overrides = {}) {
  return {
    id: "card_1",
    name: "checkout",
    display_name: "Checkout",
    kind: "build",
    status: "in-progress",
    activity: "running",
    project_id: "proj_1",
    workspace_kind: "project",
    dir_hash: "hash1",
    worker_thread_id: "thr_worker",
    prompt: "Make checkout work",
    intent: "feature",
    stage: "execution",
    created_at: 1_700_000_000_000,
    attachments: null,
    research_strategies: [],
    research_strategy: null,
    explore_stage: null,
    ...overrides,
  };
}

export const NOW = 1_700_000_000_000;

/** The empty gap registry: no critique on the card, so every gap-driven gate
 * refuses instead of inventing rows. */
const NO_GAPS = {
  matched: false,
  failures: [],
  escalated: [],
  auditGapScopes: [],
  critiqueText: "",
  totals: { total: 0, fixed: 0, documented: 0, escalated: 0 },
};
export const WORKSPACE = "/w";

/** A db that records every statement, so "did this write?" and "what order
 * did these run in?" are observable rather than inferred. */
function fakeDb(calls, rows = {}, card = null) {
  return {
    prepare(sql) {
      return {
        run(...values) {
          calls.push(["run", sql.replace(/\s+/g, " ").trim(), values]);
        },
        get(...values) {
          calls.push(["get", sql.replace(/\s+/g, " ").trim(), values]);
          // The ask family resolves card ownership through SQL, exactly like
          // the host does, so the harness answers the same query.
          if (sql.includes("FROM cards WHERE worker_thread_id"))
            return values[0] === card?.worker_thread_id
              ? { id: card.id, status: card.status }
              : undefined;
          const key = Object.keys(rows).find((name) => sql.includes(name));
          return key ? rows[key] : undefined;
        },
        all(...values) {
          calls.push(["all", sql.replace(/\s+/g, " ").trim(), values]);
          return [];
        },
      };
    },
    transaction(fn) {
      return () => {
        calls.push(["transaction"]);
        fn();
      };
    },
  };
}

function fakeBb(calls, options = {}) {
  return {
    realtime: { publish: (...args) => calls.push(["publish", ...args]) },
    log: { warn: (...args) => calls.push(["warn", ...args]) },
    ui: {
      requestInput: async (payload) => {
        calls.push(["requestInput", payload]);
        return options.requestInput
          ? options.requestInput(payload)
          : { outcome: "submitted", value: { answers: [] } };
      },
    },
    sdk: {
      files: {
        read: async ({ path }) => {
          calls.push(["read", path]);
          const content = options.files?.[path];
          if (content === undefined) throw new Error("ENOENT");
          return { content };
        },
        write: async (payload) => calls.push(["write", payload]),
        mkdir: async (payload) => calls.push(["mkdir", payload]),
      },
      environments: {
        list: async () => {
          calls.push(["environments"]);
          return options.environments ?? [];
        },
      },
      threads: {
        get: async ({ threadId }) => {
          calls.push(["thread.get", threadId]);
          return options.reviewerThread ?? { status: "idle" };
        },
        output: async () => ({ output: options.reviewerOutput ?? "" }),
      },
      plugins: {
        callRpc: async (input) => {
          calls.push(["callRpc", input]);
          return options.rpcResult ?? { ok: true, created: [], error: null };
        },
      },
    },
  };
}

/** Deps a test can rely on by default: a live card, a workspace, a no-op
 * update trail, and seams that record instead of performing. */
function baseDeps(calls, options) {
  const card = options.card;
  return {
    ...cardDeps(calls, options, card),
    ...hostDeps(calls, options),
    ...claimDeps(calls, options),
    ...judgingDeps(calls, options),
    ...commandDeps(calls, options),
  };
}

/** Card reads and the lifecycle trail. */
function cardDeps(calls, options, card) {
  return {
    db: fakeDb(calls, options.rows, card),
    bb: fakeBb(calls, options),
    now: () => NOW,
    randomId: (prefix) => `${prefix}_1`,
    getCard: (id) => (id === card.id ? card : options.cards?.[id]),
    getCardByWorkerThread: (threadId) =>
      threadId === card.worker_thread_id ? card : undefined,
    cardWorkspace: async () =>
      options.noWorkspace ? null : { path: WORKSPACE, hostId: "host1" },
    updateCard: (...args) => calls.push(["updateCard", ...args]),
    logCardComment: (...args) => {
      calls.push(["comment", ...args]);
      return "cmt_1";
    },
    recordInboxEvent: (...args) => calls.push(["inbox", ...args]),
    recordStageEvent: (...args) => calls.push(["stage", ...args]),
    stageEvents: () => options.stageEvents ?? [],
    projectRoot: async () => WORKSPACE,
    workflowStateDir: async () => `${WORKSPACE}/.stelow/state`,
    ensureProjectArtifacts: async () => options.guard ?? null,
    runHelper: async (args) => {
      calls.push(["helper", args]);
      return options.helper ?? { code: 0, stdout: "", stderr: "" };
    },
    seedWorkflow: async () => {
      calls.push(["seed"]);
      return { error: null, statePath: `${WORKSPACE}/.stelow/state/state.md` };
    },
  };
}

/** The checkout, the Git identity, and the question surfaces. */
function hostDeps(calls, options) {
  return {
    cardCheckout: async () => (options.noCheckout ? null : { path: WORKSPACE }),
    gitEvidence: async () =>
      options.gitEvidence ?? {
        isGit: true,
        gitRoot: "/w",
        branch: "main",
        headSha: "a".repeat(40),
      },
    runGitIn: async () => ({ ok: true, stdout: "" }),
    workingDiffFor: async () => options.diff ?? "",
    testCommandForCheckout: () => options.testCommand ?? null,
    runHostTests: async () => options.hostTests ?? { exitCode: 0, output: "ok" },
    spawnDisposable: async (args, site) => {
      calls.push(["spawnDisposable", site]);
      return { id: "thr_review" };
    },
    cardStageSlug: async (target) => options.stage ?? target.stage,
    docDepths: async () => options.docDepths ?? [],
    passingReviewCovers: async () => options.reviewCovers ?? false,
    pendingQuestions: async () => options.pendingQuestions ?? [],
    pendingAsks: async () => options.pendingAsks ?? [],
    openExpiredQuestionIds: () => options.expiredQuestionIds ?? [],
    askContractChecklist: async () => options.contractChecklist ?? null,
    snapshotQuestionEvidence: async () => {
      calls.push(["snapshotEvidence"]);
    },
    strategyRounds: () => options.strategyRounds ?? [],
    readResearchIndex: async () =>
      options.researchIndex ?? { ok: false, error: "no index" },
    researchArtifacts: {
      researchReadiness: async () => options.readiness ?? null,
      exploreArtifact: async () => options.artifact ?? null,
    },
  };
}

/** Claims, card creation, and the worker ledger. */
function claimDeps(calls, options) {
  return {
    gapState: async () => options.gapState ?? NO_GAPS,
    createCard: async (input) => {
      calls.push(["createCard", input]);
      return { cardId: "card_new", threadId: null };
    },
    releaseCardClaims: async () => {
      calls.push(["releaseClaims"]);
    },
    notifyClaimWaiters: async () => {},
    lockBlockedSummary: () => "Waiting on the file.",
    workers: {
      ledgerCardId: () => options.ledgerCardId ?? null,
      ledgerThreadIds: () => [],
      continuingEnvironment: async () => ({ type: "project-default" }),
      stop: async () => {
        calls.push(["stopWorker"]);
      },
    },
  };
}

/** The preset pool, the review policy, and the advisory judges. */
function judgingDeps(calls, options) {
  return {
    presets: {
      getReviewPresetId: () => options.reviewPresetId ?? null,
      getPresetById: (id) => (id === "preset_rev" ? { id, name: "Reviewer" } : undefined),
      presetAttachmentParams: () => ({
        providerId: "pi",
        modelId: "m",
        reasoningLevel: "low",
        permissionMode: "full",
      }),
      handlers: options.presetHandlers ?? {},
    },
    reviewPolicy: () => ({ mode: options.reviewPolicy ?? "off" }),
    decisionRoute: () => ({ provider: null, endpoint: "", apiKey: null, model: null }),
    judgeCriteria: async () => ({ ok: true, findings: [], evaluated: 0 }),
    judgeScoredBatch: async () => options.judged ?? { ok: true, findings: [] },
  };
}

/** Preview control and the three delegating command families. */
function commandDeps(calls, options) {
  return {
    preview: {
      view: async () => options.previewView ?? { available: false, error: "none" },
      start: async () => options.previewStart ?? { ok: true },
      stop: async () => ({ ok: true }),
    },
    draftingCommand: async (argv) => {
      calls.push(["drafting", argv]);
      return options.draftingResult ?? null;
    },
    advanceCli: async () => {
      calls.push(["advance"]);
      return { exitCode: 0, stdout: "advanced" };
    },
    scopeCommand: async (argv) => {
      calls.push(["scopeCommand", argv]);
      return { exitCode: 0, stdout: "scoped" };
    },
    runInspection: async (argv) => {
      calls.push(["inspection", argv[0]]);
      return options.inspection ?? null;
    },
    skillsDir: "/plugin/skills",
  };
}

/** Wiring harness mirroring the composition root: one deps object, the real
 * dispatcher, so a test drives the same verb table the host registers. */
export function cliHarness(options = {}) {
  const calls = [];
  const card = options.card ?? buildCard();
  const deps = baseDeps(calls, { ...options, card });
  const run = createStelowCliRun(deps);
  const defaultContext = {
    threadId: card.worker_thread_id,
    projectId: card.project_id,
  };
  const invoke = (argv, ctx = defaultContext) => run(argv, ctx);
  return { calls, deps, run, invoke, card };
}

export function callsNamed(calls, name) {
  return calls.filter(([entry]) => entry === name);
}

export function firstCall(calls, name) {
  return calls.find(([entry]) => entry === name);
}

export function commentBodies(calls) {
  return callsNamed(calls, "comment").map(([, , , , , body]) => body);
}

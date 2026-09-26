/**
 * The card surfaces: the card server itself, and the RPC handlers that act on
 * one card.
 *
 * These are the only surfaces that create a card or reach into one another's
 * record — the workspace recovery imports a card, the detail view reports the
 * thread the execution layer synchronised, and the promotion restores a
 * recovered workspace. They are wired in one place because they share those
 * two dependencies, and because the order is the contract: the card server
 * exists before the recovery that imports into it, and the execution layer
 * exists before the detail view that reports what it did.
 */
import { PHASE_ENTRY_STAGES } from "../../../lib/workflow-vocabulary.mjs";
import {
  discardConfirm,
  discardEligibility,
  discardTrail,
} from "../../../lib/discard-policy.mjs";
import { resetAutoContinue } from "../../../lib/auto-continue.mjs";
import { buildContinueInput } from "../../../lib/worker-continuation.mjs";
import { createCardsServer } from "../../cards.js";
import { githubIssuesEnabled, type GithubAutomation } from "../../github-issues.js";
import { githubUnavailableStatus } from "../../github-status.js";
import { createWorkspacesRecovery } from "../../workspaces-recovery.js";
import { createCardDetailHandler } from "../card-detail.js";
import { createCardMutationHandlers } from "../card-mutations.js";
import { createCardLifecycleHandlers } from "../card-lifecycle.js";
import { createCardOperationsHandlers } from "../card-operations.js";
import { createCardPromotion } from "../card-promotion.js";
import { createResearchTrackHandlers } from "../research-track-handlers.js";
import { createCardCreator } from "./card-creator.js";
import { detectMentionedFiles } from "../mentioned-files.js";
import { recoveryNudge } from "../card-copy.js";
import { cardAttachments, workspaceRelative } from "../card-files.js";
import { EXPLORATORY_SCOPE } from "../exploratory-scope.js";
import { IDLE_ATTENTION_MS } from "../attention-window.js";
import { parseNextStages } from "../workflow-state.js";
import { fileTimestamp } from "../root-paths.js";
import { auditReceiptNote } from "../audit-receipts.js";
import { INTERFACE_PICK, SPLIT_REQUEST_NUDGE } from "../plugin-protocols.js";
import type { RuntimeCore } from "../runtime-core.js";
import type { ExecutionSurfaces } from "./execution-surfaces.js";

export type CardSurfaces = ReturnType<typeof createCardSurfaces>;

export type CardSurfaceDeps = {
  core: RuntimeCore;
  execution: ExecutionSurfaces;
  /**
   * The issue automation, read late. The host layer builds it, and the host
   * layer is built after this one, so this is a call rather than a value: the
   * board's status column is asked per request, long after both are wired.
   */
  githubAutomation: () => GithubAutomation | undefined;
};

export function createCardSurfaces(deps: CardSurfaceDeps) {
  const { core, execution } = deps;
  const cards = buildCardsServer(core, deps.githubAutomation);
  const workspacesRecovery = buildWorkspacesRecovery(core, cards);
  return {
    cards,
    workspacesRecovery,
    cardDetail: buildCardDetail(core, execution),
    cardMutations: buildCardMutations(core),
    cardLifecycle: buildCardLifecycle(core),
    cardOperations: buildCardOperations(core),
    promoteCard: buildPromotion(core, workspacesRecovery),
    researchTrack: buildResearchTrack(core, cards),
  };
}

/**
 * The card server: the board's own read of a project, and the one place a card
 * is created. Its `fetchPendingQuestions` is the core's read, not a local
 * stub, so the board and the detail view project a worker's questions the
 * same way.
 */
function buildCardsServer(
  core: RuntimeCore,
  githubAutomation: () => GithubAutomation | undefined,
) {
  const { bb, db, now, presetServer } = core;
  const ERRORS = core.ERRORS;
  return createCardsServer({
    db,
    bb,
    now,
    store: core.cardStore,
    errors: {
      cardNotFound: ERRORS.cardNotFound,
      workspaceUnavailable: ERRORS.workspaceUnavailable,
    },
    idleAttentionMs: 90_000,
    loadBoard: (projectId) => core.loadBoard(bb, projectId),
    // A board read must answer even when the automation is not there yet, so
    // the unavailable status is this feature's own, not a literal repeated
    // per caller. It never throws: the column is a column, not a gate.
    githubStatus: async () => (await githubAutomation()?.githubStatus()) ?? githubUnavailableStatus(),
    githubAutomationEnabled: githubIssuesEnabled,
    strategyList: core.strategyList,
    getReliablePreset: presetServer.getReliablePresetForBand,
    fetchPendingQuestions: core.fetchPendingQuestions,
    openExpiredQuestionIds: core.questions.openExpiredQuestionIds,
    create: createCardCreator(core),
  });
}

/** Recovery: re-attach a card to a checkout the host still has. */
function buildWorkspacesRecovery(
  core: RuntimeCore,
  cards: ReturnType<typeof buildCardsServer>,
) {
  const { bb, db, now, ledger } = core;
  const ERRORS = core.ERRORS;
  return createWorkspacesRecovery({
    db,
    now,
    publish: (event, payload) => bb.realtime.publish(event, payload),
    cardNotFound: ERRORS.cardNotFound,
    cardArchived: ERRORS.cardArchived,
    cards: {
      get: core.getCard,
      create: (args) => cards.createInternal(args),
      comment: ledger.logCardComment,
    },
    gitEvidence: core.git.recoveryGitEvidence,
    listProjects: () => bb.sdk.projects.list(),
    getProject: (projectId) => bb.sdk.projects.get({ projectId }),
    getThreadOutput: async (threadId) => {
      const result = await bb.sdk.threads.output({ threadId });
      return result.output ?? "";
    },
  });
}

/** The detail view: everything one card shows, in one read. */
function buildCardDetail(core: RuntimeCore, execution: ExecutionSurfaces) {
  const { bb, db, now, presetServer, workers } = core;
  return createCardDetailHandler({
    db,
    bb,
    now,
    idleAttentionMs: IDLE_ATTENTION_MS,
    getCard: core.getCard,
    cardWorkspace: core.cardWorkspace,
    syncThreadState: execution.syncThreadState,
    fetchPendingQuestions: core.fetchPendingQuestions,
    resolveAskOptions: core.asks.resolveAskOptions,
    cardAttachments,
    detectMentionedFiles,
    workspaceRelative,
    parseNextStages,
    getReliablePreset: presetServer.getReliablePresetForBand,
    strategyList: core.strategyList,
    flowTimes: core.ledger.flowTimesForCard,
    verifiedHeadSha: core.ledger.verifiedHeadShaForCard,
    workers,
    executionLifecycle: execution.executionLifecycle,
    stalenessForQuestions: core.stalenessForQuestions,
    stateDir: (sourcePath, card) =>
      card.dir_hash
        ? core.workflowStateDir(bb, sourcePath, card.id, card.dir_hash)
        : Promise.resolve(null),
    fileTimestamp,
    auditReceiptNote,
    cardNotFound: core.ERRORS.cardNotFound,
  });
}

/** The mutations: rename, update, and answer on a card's own record. */
function buildCardMutations(core: RuntimeCore) {
  const ERRORS = core.ERRORS;
  return createCardMutationHandlers({
    db: core.db,
    bb: core.bb,
    now: core.now,
    getCard: core.getCard,
    cardWorkspace: core.cardWorkspace,
    workflowStateDir: core.workflowStateDir,
    logCardComment: core.ledger.logCardComment,
    updateCard: core.updateCard,
    errors: {
      cardNotFound: ERRORS.cardNotFound,
      cardArchived: ERRORS.cardArchived,
    },
  });
}

/** The lifecycle: archive, unarchive, and the discard confirmation behind them. */
function buildCardLifecycle(core: RuntimeCore) {
  const { bb, db, getCard, cardWorkspace, presetServer } = core;
  return createCardLifecycleHandlers({
    db,
    bb,
    getCard,
    cardWorkspace,
    workflowStateDir: core.workflowStateDir,
    workers: core.workers,
    updateCard: core.updateCard,
    releaseClaims: core.claims.releaseCardClaimsAndNotify,
    removeCardPreset: presetServer.removeCardPreset,
    logCardComment: core.ledger.logCardComment,
    runGitIn: core.git.runGitIn,
    exploratoryScope: EXPLORATORY_SCOPE,
    discardEvidence: core.git.discardEvidence,
    discardEligibility,
    discardConfirm,
    discardTrail,
    errors: { cardNotFound: core.ERRORS.cardNotFound },
  });
}

/** The operations: nudge, continue, split, and the question the card asks. */
function buildCardOperations(core: RuntimeCore) {
  const ERRORS = core.ERRORS;
  return createCardOperationsHandlers({
    db: core.db,
    bb: core.bb,
    getCard: core.getCard,
    workers: core.workers,
    updateCard: core.updateCard,
    releaseClaims: core.claims.releaseCardClaimsAndNotify,
    recordStageEvent: core.ledger.recordStageEvent,
    cardStageSlug: core.seams.cardStageSlug,
    fetchPendingAsks: core.questions.fetchPendingAsks,
    openExpiredQuestionIds: core.questions.openExpiredQuestionIds,
    logCardComment: core.ledger.logCardComment,
    resetAutoContinue,
    buildNudge: (card) => recoveryNudge(card, INTERFACE_PICK),
    buildContinueInput,
    splitRequestNudge: SPLIT_REQUEST_NUDGE,
    phaseEntryStages: PHASE_ENTRY_STAGES,
    errors: {
      cardNotFound: ERRORS.cardNotFound,
      cardArchived: ERRORS.cardArchived,
    },
  });
}

/** The promotion: restore a card that lost its environment to its recovery. */
function buildPromotion(
  core: RuntimeCore,
  recovery: ReturnType<typeof buildWorkspacesRecovery>,
) {
  const { bb, db, now, presetServer, workers, ledger } = core;
  const ERRORS = core.ERRORS;
  return createCardPromotion({
    db,
    bb,
    now,
    getCard: core.getCard,
    cardWorkspace: core.cardWorkspace,
    recoverySnapshot: recovery.snapshot,
    getReliablePreset: presetServer.getReliablePresetForBand,
    getCardPreset: presetServer.getPresetForCard,
    respawn: workers.respawn,
    logComment: ledger.commentCard,
    errors: {
      cardNotFound: ERRORS.cardNotFound,
      cardArchived: ERRORS.cardArchived,
      workspaceUnavailable: ERRORS.workspaceUnavailable,
    },
  });
}

/** The lightweight track RPCs: a research round, an explore artifact. */
function buildResearchTrack(
  core: RuntimeCore,
  cards: ReturnType<typeof buildCardsServer>,
) {
  const { bb, db, now, presetServer, workers, researchArtifacts } = core;
  const ERRORS = core.ERRORS;
  return createResearchTrackHandlers({
    db,
    bb,
    now,
    getCard: core.getCard,
    cardWorkspace: core.cardWorkspace,
    createCard: cards.createInternal,
    readResearchIndex: researchArtifacts.readResearchIndex,
    researchRoundFiles: researchArtifacts.researchRoundFiles,
    strategyRounds: core.strategyRounds,
    strategyList: core.strategyList,
    workflowStateDir: (rootPath, workflowId, dirHash) =>
      core.workflowStateDir(bb, rootPath, workflowId, dirHash),
    roundRelPath: core.roundRelPath,
    ensureParent: core.seams.ensureArtifactParent,
    logCardComment: core.ledger.logCardComment,
    reliablePreset: presetServer.getReliablePresetForBand,
    presetName: (presetId) => presetServer.getPresetById(presetId)?.name,
    respawn: (cardId, presetId, reason, options) =>
      workers.respawn(cardId, presetId, reason, options),
    errors: {
      cardNotFound: ERRORS.cardNotFound,
      cardArchived: ERRORS.cardArchived,
    },
  });
}

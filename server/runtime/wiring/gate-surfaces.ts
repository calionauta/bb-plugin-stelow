/**
 * The gate surfaces: what a card must satisfy, and prove, before it moves.
 *
 * These are the surfaces that answer a yes/no question about one card — the
 * question contract, the audit-gap state, the answers, the review gates, the
 * diff, the reseed, the promotion. They are wired together here because they
 * answer each other: the ask evidence reads the card's stage, the critique gap
 * state reads the scopes the card registered, and the gap summary reports what
 * the gap state found.
 *
 * They depend on the runtime core alone. A surface that needs something the
 * core does not have — a worker thread, an execution lifecycle — belongs to a
 * later layer, so this one never has to know about a worker to be built.
 */
import { execFile } from "node:child_process";
import { loadCardScopes } from "../../scopes.js";
import { summarizeTimeline } from "../../../lib/card-metrics.mjs";
import { isDoneStatus } from "../../../lib/trackables.mjs";
import { isArchivedCard } from "../../../lib/worker-action-policy.mjs";
import { recordSplitAnswer } from "../../../lib/split-proposal.mjs";
import { consumeAskContract } from "../../../lib/ask-contracts.mjs";
import { resetAutoContinue } from "../../../lib/auto-continue.mjs";
import { workerEnvironment } from "../../workers.js";
import { cardAttachments } from "../card-files.js";
import { seedWorkflow } from "../workflow-seeding.js";
import { createQuestionContractsGate } from "../question-contracts-gate.js";
import { createCritiqueGapState } from "../critique-gap-state.js";
import { createQuestionAnswers, type AnswerBoundaryPort, type BoundaryPortReader } from "../question-answers.js";
import { createGapSummary } from "../gap-summary.js";
import { createQualitySeal } from "../quality-seal.js";
import { createCardAdvance, createGateHandlers } from "../card-gates.js";
import { createAuditTrailStatus } from "../card-audit-trail.js";
import { createCardDiff } from "../card-diff.js";
import { createCardReseed } from "../card-reseed.js";
import { recoveredCheckoutIntegrity } from "../../workspaces-recovery.js";
import {
  CARD_OWNER_RULES,
  CLI_EQUIVALENTS,
  COMMIT_STYLE,
  DONE_PROTOCOL,
  DRAFT_PROTOCOL,
  INTERFACE_PICK,
  NEVER_SEED,
  RECON_PROTOCOL,
  SPLIT_PROTOCOL,
  TURN_DISCIPLINE,
} from "../plugin-protocols.js";
import type { RuntimeCore } from "../runtime-core.js";
import type { Deferred } from "./deferred.js";

export type GateSurfaces = ReturnType<typeof createGateSurfaces>;

export type GateSurfaceDeps = {
  core: RuntimeCore;
  /**
   * The execution layer's boundary port, not built yet: an answer that is this
   * run's own native boundary resumes the run instead of the worker thread, and
   * the run lives one layer up. Read as undefined until it is bound, which is
   * the order the composition root wires.
   */
  boundary: Deferred<AnswerBoundaryPort>;
};

/** The protocol clauses the reseed prompt quotes into a restarted card. */
const RESEED_PROTOCOLS = {
  cardOwnerRules: CARD_OWNER_RULES,
  neverSeed: NEVER_SEED,
  cliEquivalents: CLI_EQUIVALENTS,
  reconProtocol: RECON_PROTOCOL,
  draftProtocol: DRAFT_PROTOCOL,
  turnDiscipline: TURN_DISCIPLINE,
  commitStyle: COMMIT_STYLE,
  interfacePick: INTERFACE_PICK,
  doneProtocol: DONE_PROTOCOL,
  splitProtocol: SPLIT_PROTOCOL,
} as const;

export function createGateSurfaces(deps: GateSurfaceDeps) {
  const { core } = deps;
  const questionContractsGate = buildQuestionContractsGate(core);
  const critiqueGapState = buildCritiqueGapState(core);
  const answers = buildQuestionAnswers(core, deps.boundary);
  return {
    questionContractsGate,
    critiqueGapState,
    answerQuestions: answers.answerQuestions,
    answerExpiredQuestions: answers.answerExpiredQuestions,
    gapSummary: buildGapSummary(core, critiqueGapState),
    qualitySeal: buildQualitySeal(core),
    gateHandlers: buildGateHandlers(core),
    advanceCard: buildAdvanceCard(core, questionContractsGate),
    auditTrailStatus: buildAuditTrailStatus(core),
    cardDiff: buildCardDiff(core),
    reseedCard: buildReseedCard(core),
  };
}

/** The contract a card's stage requires, read through its own state file. */
function buildQuestionContractsGate(core: RuntimeCore) {
  return createQuestionContractsGate({
    bb: core.bb,
    db: core.db,
    syncOpenQuestionInbox: core.questions.syncOpenQuestionInbox,
  });
}

/** What the critique stage found, read from the card's registered scopes. */
function buildCritiqueGapState(core: RuntimeCore) {
  const { bb, cardWorkspace } = core;
  return createCritiqueGapState({
    bb,
    cardWorkspace,
    workflowStateDir: (card, rootPath) =>
      core.workflowStateDir(bb, rootPath, card.id, card.dir_hash!),
    loadCardScopes,
  });
}

/** The two answer entry points: live asks, and the expired ones. */
function buildQuestionAnswers(
  core: RuntimeCore,
  boundary: BoundaryPortReader,
) {
  const { bb, db, getCard, updateCard, questions } = core;
  const ERRORS = core.ERRORS;
  return createQuestionAnswers({
    bb,
    db,
    errors: {
      cardNotFound: ERRORS.cardNotFound,
      cardArchived: ERRORS.cardArchived,
    },
    getCard,
    isArchivedCard,
    pendingAsks: async (threadId) =>
      questions.pendingAsks(await bb.sdk.threads.interactions.list({ threadId })),
    openExpiredQuestionIds: questions.openExpiredQuestionIds,
    syncPendingQuestionInbox: core.syncPendingQuestionInbox,
    syncOpenQuestionInbox: questions.syncOpenQuestionInbox,
    markInboxQuestionsAnswered: core.markInboxQuestionsAnswered,
    recordSplitAnswer,
    consumeAskContract,
    logCardComment: core.ledger.logCardComment,
    updateCard,
    hasOpenQuestions: questions.hasOpenQuestions,
    boundary,
  });
}

/** The board's gap column: what critique left open, in one line per scope. */
function buildGapSummary(
  core: RuntimeCore,
  critiqueGapState: ReturnType<typeof buildCritiqueGapState>,
) {
  return createGapSummary({
    getCard: core.getCard,
    stageEvents: core.ledger.stageEvents,
    summarizeTimeline,
    critiqueGapState,
    isDoneStatus,
    now: core.now,
  });
}

/** The seal a finished card carries: its rounds, its thread, its evidence. */
function buildQualitySeal(core: RuntimeCore) {
  return createQualitySeal({
    bb: core.bb,
    getCard: core.getCard,
    getCardByWorkerThread: core.ledger.getCardByWorkerThread,
    cardWorkspace: core.cardWorkspace,
    strategyRounds: core.strategyRounds,
    readResearchIndex: core.researchArtifacts.readResearchIndex,
  });
}

/** The gate RPCs: approve, request, and the review queue behind them. */
function buildGateHandlers(core: RuntimeCore) {
  return createGateHandlers({
    db: core.db,
    bb: core.bb,
    getCard: core.getCard,
    cardWorkspace: core.cardWorkspace,
    boardFromRoot: core.boardFromRoot,
    loadBoard: core.loadBoard,
  });
}

/** The advance RPC: the one that moves a card to the stage it asked for. */
function buildAdvanceCard(
  core: RuntimeCore,
  questionGate: ReturnType<typeof buildQuestionContractsGate>,
) {
  const { bb, getCard, cardWorkspace, presetServer, workers } = core;
  const ERRORS = core.ERRORS;
  return createCardAdvance({
    getCard,
    cardWorkspace,
    workflowStateDir: (rootPath, card) =>
      core.workflowStateDir(bb, rootPath, card.id, card.dir_hash!),
    ensureArtifacts: (rootPath, stateDir, requireOwnedState) =>
      core.ensureProjectArtifacts(bb, rootPath, stateDir, requireOwnedState),
    questionGate,
    runHelper: core.runHelper,
    getReliablePreset: presetServer.getReliablePresetForBand,
    getCardPreset: presetServer.getPresetForCard,
    respawn: workers.respawn,
    updateCard: cardUpdater(core),
    publishCard: (cardId) => bb.realtime.publish("card-state", { cardId }),
    errors: {
      cardNotFound: ERRORS.cardNotFound,
      cardArchived: ERRORS.cardArchived,
      workspaceUnavailable: ERRORS.workspaceUnavailable,
    },
  });
}

/** The audit-trail read: what a card recorded, and whether it still holds. */
function buildAuditTrailStatus(core: RuntimeCore) {
  const { bb, getCard, cardWorkspace } = core;
  const ERRORS = core.ERRORS;
  return createAuditTrailStatus({
    bb,
    getCard,
    cardWorkspace,
    workflowStateDir: (rootPath, card) =>
      core.workflowStateDir(bb, rootPath, card.id, card.dir_hash!),
    runHelper: core.runHelper,
    errors: {
      cardNotFound: ERRORS.cardNotFound,
      workspaceUnavailable: ERRORS.workspaceUnavailable,
    },
  });
}

/** The diff RPC: the card's own checkout, never the project's by accident. */
function buildCardDiff(core: RuntimeCore) {
  const ERRORS = core.ERRORS;
  return createCardDiff({
    execFile,
    getCard: core.getCard,
    cardCheckout: core.seams.cardCheckout,
    recoveredIntegrity: (card, path) =>
      recoveredCheckoutIntegrity(
        { db: core.db, gitEvidence: core.git.recoveryGitEvidence },
        card,
        path,
      ),
    resolveLocalBin: core.previewHost.resolveLocalBin,
    errors: {
      cardNotFound: ERRORS.cardNotFound,
      workspaceUnavailable: ERRORS.workspaceUnavailable,
    },
  });
}

/** The reseed RPC: restart a card's workflow with what it learned. */
function buildReseedCard(core: RuntimeCore) {
  const { bb, db, now, getCard, cardWorkspace, presetServer } = core;
  const ERRORS = core.ERRORS;
  const workers = core.workers;
  return createCardReseed({
    db,
    bb,
    now,
    getCard,
    cardWorkspace,
    workflowStateDir: (rootPath, card) =>
      core.workflowStateDir(bb, rootPath, card.id, card.dir_hash!),
    readStateConfig: async (rootPath, card) =>
      core.trackProjection.readReseedConfig(card, rootPath),
    seedWorkflow: ({ rootPath, card, intent, appetite, reviewGates }) =>
      seedWorkflow(
        bb,
        rootPath,
        card.id,
        card.name,
        intent,
        appetite,
        reviewGates,
        true,
      ),
    getPresetById: presetServer.getPresetById,
    pinCardPreset: presetServer.pinCardPreset,
    getReliablePreset: presetServer.getReliablePresetForBand,
    presetParams: presetServer.presetAttachmentParams,
    ...reseedArtifacts(core),
    continuingEnvironment: workers.continuingEnvironment,
    workerEnvironment,
    replacePrepared: workers.replacePrepared,
    resetAutoContinue,
    updateCard: cardUpdater(core),
    recordThread: workers.recordThread,
    lineage: workers.lineage,
    publishCard: (cardId) => bb.realtime.publish("card-state", { cardId }),
    protocols: RESEED_PROTOCOLS,
    errors: {
      cardNotFound: ERRORS.cardNotFound,
      cardArchived: ERRORS.cardArchived,
      workspaceUnavailable: ERRORS.workspaceUnavailable,
      presetNotFound: ERRORS.presetNotFound,
    },
  });
}

/**
 * What a reseeded card writes: its strategy history, its rounds, and the
 * prompt that tells the new worker which track it is on. Grouped because a
 * reseed that quoted a different strategy list than the card it restarts would
 * produce a card whose history and instructions disagree.
 */
function reseedArtifacts(core: RuntimeCore) {
  return {
    strategyList: core.strategyList,
    strategyRounds: core.strategyRounds,
    roundFile: core.roundFileName,
    roundStamp: core.roundTimestamp,
    roundRelativePath: core.roundRelPath,
    ensureArtifactParent: core.seams.ensureArtifactParent,
    researchPrompt: core.prompts.researchWorkerPrompt,
    explorePrompt: core.prompts.exploreWorkerPrompt,
    attachments: cardAttachments,
  };
}

/**
 * The card updater the surfaces share, narrowed to the patch they hand it.
 * Every surface builds its patch from its own row shape, so the narrowing
 * lives once here instead of at each call site that would need it.
 */
function cardUpdater(
  core: RuntimeCore,
): (cardId: string, fields: Record<string, unknown>) => void {
  return (cardId, fields) =>
    core.updateCard(cardId, fields as Parameters<RuntimeCore["updateCard"]>[1]);
}

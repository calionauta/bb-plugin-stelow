import { execFile } from "node:child_process";
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import { PHASE_ENTRY_STAGES } from "../lib/workflow-vocabulary.mjs";
import { consumeAskContract } from "../lib/ask-contracts.mjs";
import {
  discardConfirm,
  discardEligibility,
  discardTrail,
} from "../lib/discard-policy.mjs";
import { workflowIdForName } from "../lib/workflow-state-identity.mjs";
import {
  roundTimestamp,
  roundFileName,
} from "../lib/research-rounds.mjs";

import { normalizeKind } from "../lib/tracks.mjs";
import { isArchivedCard } from "../lib/worker-action-policy.mjs";
import { resetAutoContinue } from "../lib/auto-continue.mjs";
import { buildContinueInput } from "../lib/worker-continuation.mjs";
import { recordSplitAnswer } from "../lib/split-proposal.mjs";
import { isDoneStatus } from "../lib/trackables.mjs";
import { recordTrackableEvent } from "../lib/trackable-events.mjs";
import {
  legacyLabelForGates,
  normalizeReviewGates,
} from "../lib/review-gates.mjs";
import { summarizeTimeline } from "../lib/card-metrics.mjs";
import {
  createWorkspacesRecovery,
  recoveredCheckoutIntegrity,
} from "./workspaces-recovery.js";
import {
  createGithubAutomation,
  githubIssuesEnabled,
} from "./github-issues.js";
import { createCardsServer } from "./cards.js";
import type { PresetRow } from "./presets.js";
import { createArtifactsPublication } from "./artifacts-publication.js";
import {
  workerEnvironment,
  type WorkerCard,
} from "./workers.js";
import {
  loadCardScopes,
  normalizeStatus,
  runScopeCommand,
} from "./scopes.js";
import { createPlatformHandlers } from "./runtime/platform.js";
import { createInspectionCommand } from "./runtime/cli-inspection.js";
import { createStelowCliRun } from "./runtime/cli/cli-dispatcher.js";
import { cardAttachments, workspaceRelative } from "./runtime/card-files.js";
import { createResearchTrackSync } from "./runtime/research-track-sync.js";
import {
  type ExploreWorkerPromptInput,
  type ResearchWorkerPromptInput,
} from "./runtime/track-prompts.js";
import { registerMentionProviders } from "./runtime/mentions.js";
import {
  registerAutomationSchedule,
  registerRpcHandlers,
  registerRuntimeLifecycle,
  registerStelowCli,
  registerWorkerSkills,
} from "./runtime/composition.js";
import { createExecutionNative } from "./execution-native.js";
import { createExecutionLifecycle } from "./execution-lifecycle.js";
import { createExecutionReconcile } from "./execution-reconcile.js";
import { createExecutionAdvance } from "./execution-advance.js";
import { createWorktreeCleanup } from "./worktree-cleanup.js";
import { flowMetrics } from "./runtime/flow-metrics.js";
import { createPendingQuestions } from "./runtime/pending-questions.js";
import { createCardDetailHandler } from "./runtime/card-detail.js";
import { createCardMutationHandlers } from "./runtime/card-mutations.js";
import { createCardLifecycleHandlers } from "./runtime/card-lifecycle.js";
import { createCardOperationsHandlers } from "./runtime/card-operations.js";
import { createResearchTrackHandlers } from "./runtime/research-track-handlers.js";
import { createBuildThreadSync } from "./runtime/build-thread-sync.js";
import { createQuestionContractsGate } from "./runtime/question-contracts-gate.js";
import { createCritiqueGapState } from "./runtime/critique-gap-state.js";
import { createGapSummary } from "./runtime/gap-summary.js";
import { createQualitySeal } from "./runtime/quality-seal.js";
import { createQuestionAnswers } from "./runtime/question-answers.js";
import { createCardAdvance, createGateHandlers } from "./runtime/card-gates.js";
import { createAuditTrailStatus } from "./runtime/card-audit-trail.js";
import { createCardDiff } from "./runtime/card-diff.js";
import { createCardReseed } from "./runtime/card-reseed.js";
import { createCardPromotion } from "./runtime/card-promotion.js";

// The composition root wires slices; every path, board read, and state
// projection it consumes is owned by the module imported here.
import { boardWorkflowDefaultsSchema } from "./contracts.js";
import { rpcContract } from "./rpc-contract.js";
import { isManagedWorktreeEnvironment } from "../lib/card-environment.mjs";
import {
  BUILD_INFO,
  PLUGIN_SKILLS_DIR,
  pluginDir,
  readPinnedStelowVersion,
} from "./plugin-paths.js";
import { fileTimestamp } from "./runtime/root-paths.js";
import { parseNextStages } from "./runtime/workflow-state.js";
import { seedWorkflow } from "./runtime/workflow-seeding.js";
import { auditReceiptNote } from "./runtime/audit-receipts.js";
import { detectMentionedFiles } from "./runtime/mentioned-files.js";
import { recoveryNudge, statusLabelForSummary } from "./runtime/card-copy.js";
import { createRuntimeCore } from "./runtime/runtime-core.js";
import { EXPLORATORY_SCOPE } from "./runtime/exploratory-scope.js";
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
  SPLIT_REQUEST_NUDGE,
  TURN_DISCIPLINE,
} from "./runtime/plugin-protocols.js";
import {
  AUDIT_DONE_NUDGE,
  IDLE_ATTENTION_MS,
} from "./runtime/attention-window.js";

export default async function plugin(bb: BbPluginApi) {
  // The runtime core owns every shared seam; the surfaces below are wired
  // against these names, so a seam can move without touching a call site.
  const core = createRuntimeCore(bb);

  const {
    db,
    now,
    randomId,
    cardStore,
    presetServer,
    inbox,
    getCard,
    cardWorkspace,
    updateCard,
    notifyClaimWaiters,
    recordInboxEvent,
    resolveInboxEvents,
    syncPendingQuestionInbox,
    markInboxQuestionsAnswered,
    judgePresetCriteria,
    judgeScoredBatch,
    pluginUpdates,
    workers,
    drafting,
    spawnDisposable,
    requestGatePreReview,
    trackCapabilities,
    stalenessForQuestions,
    researchArtifacts,
    cardPreview,
  } = core;
  const { researchWorkerPrompt, exploreWorkerPrompt } = core.prompts;
  const ERRORS = core.ERRORS;
  const ERR_CARD_NOT_FOUND = ERRORS.cardNotFound;
  const ERR_CARD_ARCHIVED = ERRORS.cardArchived;
  const ERR_WORKSPACE_UNAVAILABLE = ERRORS.workspaceUnavailable;
  const ERR_PRESET_NOT_FOUND = ERRORS.presetNotFound;
  const {
    getDefaultPreset,
    getPresetById,
    getPresetForCard,
    getReliablePresetForBand,
    presetAttachmentParams,
    pinCardPreset,
    removeCardPreset,
  } = presetServer;
  const {
    recordStageEvent,
    stageEvents,
    flowTimesForCard,
    verifiedHeadShaForCard,
    getCardByWorkerThread,
    logCardComment,
  } = core.ledger;
  const {
    runGitIn,
    workingDiffFor,
    testCommandForCheckout,
    runHostTests,
    recoveryGitEvidence,
    dropLinkedWorktree,
    discardEvidence,
  } = core.git;
  const {
    lockBlockedSummary,
    releaseCardClaimsAndNotify,
    escalateIfStalled,
  } = core.claims;
  const {
    openExpiredQuestionIds,
    pendingAsks,
    fetchPendingAsks,
    syncOpenQuestionInbox,
    hasOpenQuestions,
  } = core.questions;
  const {
    cardCheckout,
    cardStageSlug,
    askContractChecklist,
    ensureArtifactParent,
    buildDocDepthsForCard,
    passingReviewCovers,
  } = core.seams;
  const { resolveAskOptions, snapshotQuestionEvidence } = core.asks;
  const { readReseedConfig, markThreadRunning, noteAgentOutput } = core.trackProjection;
  const { resolveLocalBin, homeDir, localBinDir } = core.previewHost;
  const {
    loadBoard,
    boardFromRoot,
    workflowStateDir,
    ensureProjectArtifacts,
    runHelper,
    projectRoot,
  } = core;
  const { roundRelPath, strategyList, strategyRounds, stripMessageDirectives } = core;
  const decisionApi = core.decision;
  const seedBuildIntentFromRouter = decisionApi.seedBuildIntent;
  const vetAutoContinueNudge = decisionApi.vetAutoContinue;
  const maybeBumpSeverity = decisionApi.maybeBumpSeverity;



  type CardRow = WorkerCard;











  const {
    view: previewView,
    start: previewStart,
    stop: previewStop,
    share: previewShare,
  } = cardPreview;


  const platform = createPlatformHandlers({
    bb,
    pluginDir,
    pluginSkillsDir: PLUGIN_SKILLS_DIR,
    buildInfo: BUILD_INFO,
    readPinnedStelowVersion,
    refreshPluginUpdate: pluginUpdates.refresh,
    getPluginUpdate: pluginUpdates.getState,
    getGithubRelease: pluginUpdates.getRelease,
    resolveLocalBin,
    homeDir,
    localBinDir,
    preview: {
      view: previewView,
      start: previewStart,
      stop: previewStop,
      share: previewShare,
    },
  });

  const {
    researchRoundFiles,
    readResearchIndex,
    researchReadiness,
    exploreArtifact,
  } = researchArtifacts;




  let fetchPendingQuestions: (
    threadId: string | null,
  ) => Promise<
    Awaited<
      ReturnType<typeof rpcContract.cardDetail.output.parse>
    >["pendingQuestions"]
  > = async () => [];
  const cards = createCardsServer({
    db,
    bb,
    now,
    store: cardStore,
    errors: {
      cardNotFound: "Card not found.",
      workspaceUnavailable: "Workspace is unavailable.",
    },
    idleAttentionMs: 90_000,
    loadBoard: (projectId) => loadBoard(bb, projectId),
    githubStatus: () => github.githubStatus(),
    githubAutomationEnabled: githubIssuesEnabled,
    strategyList,
    getReliablePreset: (band, cardId) => getReliablePresetForBand(band, cardId),
    fetchPendingQuestions,
    openExpiredQuestionIds,
    create: {
      db,
      bb,
      now,
      randomId,
      roundTimestamp,
      seedBuildIntent: seedBuildIntentFromRouter,
      seedWorkflow: (
        plugin,
        rootPath,
        cardId,
        slug,
        intent,
        appetite,
        reviewGates,
      ) =>
        seedWorkflow(
          plugin,
          rootPath,
          cardId,
          slug,
          intent,
          appetite,
          reviewGates,
        ),
      researchStrategy: trackCapabilities.researchStrategy,
      exploreStage: trackCapabilities.exploreStage,
      researchIds: trackCapabilities.researchIds,
      exploreIds: trackCapabilities.exploreIds,
      defaultPreset: getDefaultPreset,
      getPreset: getPresetById,
      getBandPresetId: presetServer.getBandPresetId,
      getReliablePresetId: presetServer.getReliablePresetId,
      createCardOverride: (cardId, base, override) =>
        presetServer.createCardOverride(cardId, base as PresetRow, override),
      pinCardPreset,
      removeCardPreset,
      presetParams: (preset) => presetAttachmentParams(preset as PresetRow),
      spawnInitial: (args) => workers.spawnInitial(args),
      recordThread: (cardId, threadId, presetId, reason) =>
        workers.recordThread(cardId, threadId, presetId, reason),
      lineage: (rootPath, dirHash, threadId, presetId, reason) =>
        workers.lineage(rootPath, dirHash, threadId, presetId, reason),
      roundPath: roundRelPath,
      roundFile: roundFileName,
      ensureParent: ensureArtifactParent,
      researchPrompt: (input) =>
        researchWorkerPrompt(input as unknown as ResearchWorkerPromptInput),
      explorePrompt: (input) =>
        exploreWorkerPrompt(input as unknown as ExploreWorkerPromptInput),
      rules: {
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
      },
      describeManagedWorktree: isManagedWorktreeEnvironment,
      recordStageEvent,
      comment: (cardId, body) => {
        logCardComment(cardId, "card", cardId, "agent", body);
      },
      suggestCardName: (cardId) => drafting.suggestCardName(cardId),
    },
  });
  const createCardInternal = cards.createInternal;

  const workspacesRecovery = createWorkspacesRecovery({
    db,
    now,
    publish: (event, payload) => bb.realtime.publish(event, payload),
    cardNotFound: ERR_CARD_NOT_FOUND,
    cardArchived: ERR_CARD_ARCHIVED,
    cards: {
      get: (cardId) => getCard(cardId),
      create: (args) => createCardInternal(args),
      comment: (cardId, target, targetId, author, body) =>
        logCardComment(cardId, target, targetId, author, body),
    },
    gitEvidence: recoveryGitEvidence,
    listProjects: () => bb.sdk.projects.list(),
    getProject: (projectId) => bb.sdk.projects.get({ projectId }),
    getThreadOutput: async (threadId) => {
      const result = await bb.sdk.threads.output({ threadId });
      return result.output ?? "";
    },
  });
  const recoverySnapshot = workspacesRecovery.snapshot;
  const recoveryIntegrityDeps = { db, gitEvidence: recoveryGitEvidence };

  // ::name{...} directives are bb's thread renderer syntax (the worker emits
  // ::stelow-artifact chips per produced file). Card comments are rendered as
  // plain Markdown, so strip the directive syntax there — the file names it
  // carried are already present as natural text in the same message.



  // Workspace claim coordination (lib/card-claims). A card that hits a file




  const questionContractsGate = createQuestionContractsGate({
    bb,
    db,
    syncOpenQuestionInbox,
  });
  const critiqueGapState = createCritiqueGapState({
    bb,
    cardWorkspace,
    workflowStateDir: (card, rootPath) =>
      workflowStateDir(bb, rootPath, card.id, card.dir_hash!),
    loadCardScopes,
  });
  const { answerQuestions, answerExpiredQuestions } = createQuestionAnswers({
    bb,
    db,
    errors: {
      cardNotFound: ERR_CARD_NOT_FOUND,
      cardArchived: ERR_CARD_ARCHIVED,
    },
    getCard,
    isArchivedCard,
    pendingAsks: async (threadId) =>
      pendingAsks(await bb.sdk.threads.interactions.list({ threadId })),
    openExpiredQuestionIds,
    syncPendingQuestionInbox,
    syncOpenQuestionInbox,
    markInboxQuestionsAnswered,
    recordSplitAnswer,
    consumeAskContract,
    logCardComment,
    updateCard,
    hasOpenQuestions,
  });
  const gapSummary = createGapSummary({
    getCard,
    stageEvents,
    summarizeTimeline,
    critiqueGapState,
    isDoneStatus,
    now,
  });
  const qualitySeal = createQualitySeal({
    bb,
    getCard,
    getCardByWorkerThread,
    cardWorkspace,
    strategyRounds,
    readResearchIndex,
  });
  const gateHandlers = createGateHandlers({
    db,
    bb,
    getCard,
    cardWorkspace,
    boardFromRoot,
    loadBoard,
  });
  const advanceCard = createCardAdvance({
    getCard,
    cardWorkspace,
    workflowStateDir: (rootPath, card) =>
      workflowStateDir(bb, rootPath, card.id, card.dir_hash!),
    ensureArtifacts: (rootPath, stateDir, requireOwnedState) =>
      ensureProjectArtifacts(bb, rootPath, stateDir, requireOwnedState),
    questionGate: questionContractsGate,
    runHelper,
    getReliablePreset: getReliablePresetForBand,
    getCardPreset: getPresetForCard,
    respawn: (cardId, presetId) => workers.respawn(cardId, presetId),
    updateCard: (cardId, fields) =>
      updateCard(cardId, fields as Parameters<typeof updateCard>[1]),
    publishCard: (cardId) => bb.realtime.publish("card-state", { cardId }),
    errors: {
      cardNotFound: ERR_CARD_NOT_FOUND,
      cardArchived: ERR_CARD_ARCHIVED,
      workspaceUnavailable: ERR_WORKSPACE_UNAVAILABLE,
    },
  });
  const auditTrailStatus = createAuditTrailStatus({
    bb,
    getCard,
    cardWorkspace,
    workflowStateDir: (rootPath, card) =>
      workflowStateDir(bb, rootPath, card.id, card.dir_hash!),
    runHelper,
    errors: {
      cardNotFound: ERR_CARD_NOT_FOUND,
      workspaceUnavailable: ERR_WORKSPACE_UNAVAILABLE,
    },
  });
  const cardDiff = createCardDiff({
    execFile,
    getCard,
    cardCheckout,
    recoveredIntegrity: (card, path) =>
      recoveredCheckoutIntegrity(recoveryIntegrityDeps, card, path),
    resolveLocalBin,
    errors: {
      cardNotFound: ERR_CARD_NOT_FOUND,
      workspaceUnavailable: ERR_WORKSPACE_UNAVAILABLE,
    },
  });
  const reseedCard = createCardReseed({
    db,
    bb,
    now,
    getCard,
    cardWorkspace,
    workflowStateDir: (rootPath, card) =>
      workflowStateDir(bb, rootPath, card.id, card.dir_hash!),
    readStateConfig: async (rootPath, card) => readReseedConfig(card, rootPath),
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
    getPresetById,
    pinCardPreset,
    getReliablePreset: getReliablePresetForBand,
    presetParams: presetAttachmentParams,
    strategyList,
    strategyRounds,
    roundFile: (strategyId, roundNo, stamp) =>
      roundFileName(strategyId, roundNo, stamp),
    roundStamp: roundTimestamp,
    roundRelativePath: roundRelPath,
    ensureArtifactParent,
    researchPrompt: researchWorkerPrompt,
    explorePrompt: exploreWorkerPrompt,
    attachments: cardAttachments,
    continuingEnvironment: workers.continuingEnvironment,
    workerEnvironment,
    replacePrepared: workers.replacePrepared,
    resetAutoContinue,
    updateCard: (cardId, fields) =>
      updateCard(cardId, fields as Parameters<typeof updateCard>[1]),
    recordThread: workers.recordThread,
    lineage: workers.lineage,
    publishCard: (cardId) => bb.realtime.publish("card-state", { cardId }),
    protocols: {
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
    },
    errors: {
      cardNotFound: ERR_CARD_NOT_FOUND,
      cardArchived: ERR_CARD_ARCHIVED,
      workspaceUnavailable: ERR_WORKSPACE_UNAVAILABLE,
      presetNotFound: ERR_PRESET_NOT_FOUND,
    },
  });
  const promoteCard = createCardPromotion({
    db,
    bb,
    now,
    getCard,
    cardWorkspace,
    recoverySnapshot,
    getReliablePreset: getReliablePresetForBand,
    getCardPreset: getPresetForCard,
    respawn: workers.respawn,
    logComment: (cardId, body) => logCardComment(cardId, "card", cardId, "agent", body),
    errors: {
      cardNotFound: ERR_CARD_NOT_FOUND,
      cardArchived: ERR_CARD_ARCHIVED,
      workspaceUnavailable: ERR_WORKSPACE_UNAVAILABLE,
    },
  });



  fetchPendingQuestions = createPendingQuestions({
    fetchPendingAsks,
    getCardByWorkerThread,
    resolveAskOptions,
  });

  const executionNative = createExecutionNative({
    db,
    bb,
    randomId,
    cardWorkspace,
    stateDir: (card, rootPath) =>
      workflowStateDir(bb, rootPath, card.id, card.dir_hash!),
    logComment: (cardId, targetId, body) =>
      logCardComment(cardId, "card", targetId, "agent", body),
  });
  const executionLifecycle = createExecutionLifecycle({
    db,
    bb,
    randomId,
    getCard,
    logComment: (cardId, targetId, body) =>
      logCardComment(cardId, "card", targetId, "agent", body),
    native: executionNative,
  });
  const executionReconcile = createExecutionReconcile({
    db,
    bb,
    now,
    randomId,
    getCard,
    cardWorkspace,
    fetchPendingQuestions,
    logComment: (cardId, targetId, body) =>
      logCardComment(cardId, "card", targetId, "agent", body),
    publishCard: (cardId) => bb.realtime.publish("card-state", { cardId }),
    native: executionNative,
    lifecycle: executionLifecycle,
  });
  const executionAdvance = createExecutionAdvance({
    errors: {
      cardNotFound: ERR_CARD_NOT_FOUND,
      cardArchived: ERR_CARD_ARCHIVED,
      workspaceUnavailable: ERR_WORKSPACE_UNAVAILABLE,
    },
    getCard,
    getCardByWorkerThread,
    cardWorkspace,
    projectRoot: (projectId) => projectRoot(bb, projectId),
    stateDir: (card, rootPath) =>
      workflowStateDir(bb, rootPath, card.id, card.dir_hash!),
    ensureArtifacts: (rootPath, stateDir, requireOwnedState) =>
      ensureProjectArtifacts(bb, rootPath, stateDir, requireOwnedState),
    questionGate: (card, stateDir) => questionContractsGate(card, stateDir),
    runHelper,
    native: executionNative,
    reworkNote: async (card) => {
      if (card.stage !== "audit") return "";
      const gaps = await critiqueGapState(card).catch(() => null);
      if (!gaps?.matched) return "";
      const open = gaps.auditGapScopes.filter(
        (scope) => !isDoneStatus(scope.status),
      );
      return open.length > 0
        ? `\n(rework loop: back to execution from audit — picking up ${open.length} open audit-gap scope(s): ${open.map((scope) => scope.id).join(", ")})`
        : "\n(rework loop: back to execution from audit — no open audit-gap scopes)";
    },
    updateCard: (cardId, fields) =>
      updateCard(cardId, fields as Parameters<typeof updateCard>[1]),
    recordStageEvent,
    recordExecutionEntry: (cardId, evidence, transition) =>
      recordTrackableEvent(db, {
        cardId,
        kind: "scope",
        trackableId: "all",
        transition,
        actor: "host",
        evidence,
      }),
    getReliablePreset: (band, cardId) => getReliablePresetForBand(band, cardId),
    getCardPresetId: (cardId) => getPresetForCard(cardId).id,
    respawn: (cardId, presetId) => workers.respawn(cardId, presetId),
    scheduleRespawn: (cardId, presetId) =>
      workers.scheduleRespawn(cardId, presetId),
    requestGatePreReview,
    publishCard: (cardId) => bb.realtime.publish("card-state", { cardId }),
    isArchivedCard,
  });

  const worktreeCleanup = createWorktreeCleanup({
    getCard: (cardId) => getCard(cardId),
    evidence: (card) =>
      discardEvidence(card as Parameters<typeof discardEvidence>[0]),
    dropWorktree: dropLinkedWorktree,
    stopWorker: (threadId) => workers.stop(threadId),
    log: (cardId, body) =>
      logCardComment(cardId, "card", cardId, "agent", body),
    publish: (event, payload) => bb.realtime.publish(event, payload),
  });

  // completion contract differs (valid index vs valid stage artifact).
  const trackSync = createResearchTrackSync({
    bb,
    db,
    now,
    getCard,
    updateCard,
    recordInboxEvent,
    resolvePausedEvents: (cardId, at) =>
      resolveInboxEvents(cardId, at, ["paused"], "completed"),
    recordStageEvent,
    markThreadRunning,
    syncQuestions: syncOpenQuestionInbox,
    noteAgentOutput,
    applyFailed: (cardId, threadId, error) =>
      workers.applyFailed(cardId, threadId, error),
    escalateIfStalled,
    researchReadiness,
    exploreArtifact,
    idleAttentionMs: IDLE_ATTENTION_MS,
  });

  const syncThreadState = createBuildThreadSync({
    bb,
    db,
    now,
    getCard,
    cardWorkspace,
    workflowStateDir,
    updateCard,
    syncResearch: trackSync.syncResearch,
    syncExplore: trackSync.syncExplore,
    syncQuestions: syncOpenQuestionInbox,
    applyFailed: (cardId, threadId, error) => workers.applyFailed(cardId, threadId, error),
    logComment: (cardId, body) =>
      logCardComment(cardId, "card", cardId, "agent", body),
    recordInbox: recordInboxEvent,
    vetContinuation: vetAutoContinueNudge,
    escalateIfStalled,
    stripMessageDirectives,
    interfacePick: INTERFACE_PICK,
    auditDoneNudge: AUDIT_DONE_NUDGE,
    idleAttentionMs: IDLE_ATTENTION_MS,
  });


  registerRuntimeLifecycle({
    bb,
    db,
    syncThreadState,
    applyFailed: (cardId, threadId, error) =>
      workers.applyFailed(cardId, threadId, error),
    executionReconcile,
    getCard,
    cardWorkspace,
    maybeBumpSeverity,
    notifyClaimWaiters,
    disposeWorkers: () => workers.dispose(),
  });

  // Workflow mechanics are private to workers created by the Build panel.
  // Manifest skills are static registrations in BB, so configure() is the
  // boundary that keeps them out of every other thread/session.
  registerWorkerSkills(bb);

  // The helper and skills are pinned to one upstream commit at plugin release
  // time. Do not mutate them at boot: a running plugin must remain able to
  // explain exactly which Stelow behavior produced an audit receipt.

  // NOTE: v0.6.0–v0.6.2 shipped a one-pass pw- → sw- boot migration. It ran,
  // production converged (zero pw- hashes and dirs), and the code was
  // removed: early alpha, no compat shims for dead prefixes.

  // NOTE: a previous revision stopped every live worker thread here. Removed:
  // dispose fires on every hot-reload (dev + build:reload), so it massacred
  // in-flight work with a "Stopped manually" on each update. Workers now
  // survive reloads; boot reconcile re-syncs their state, and a truly dead
  // plugin surfaces as an honest worker error on the next bb stelow call.

  // Shared continue copy: the manual Retry action and the auto-continue
  // watchdog send the same nudge, so a worker cannot tell (or behave
  // differently for) a human resume from an automatic one.
  // The audit-stage variant: reaching audit is not completing. The worker
  // commits with `bb stelow done`; the host verifies in code. Narrating
  // completion ("Workflow concluído") without running done leaves the card
  // waiting — this nudge is the only thing an audit-idle resume says.
  // Decision API, review policy, migrations, handlers, and execution seams
  // live behind one factory. Preset judging remains host-owned and injected.

  // GitHub issues live decoupled in server/github-issues.ts: tables,
  // backfills, matcher wiring, scheduler, and RPCs. One seam in, one out.
  const github = createGithubAutomation({
    db,
    bb,
    now,
    randomId,
    presets: {
      getWorktreePresetId: presetServer.getWorktreePresetId,
      getEffectiveBuildEnvironmentKind:
        presetServer.getEffectiveBuildEnvironmentKind,
      pinCardPreset,
    },
    cards: {
      get: (cardId) => getCard(cardId),
      create: (args) => createCardInternal(args),
      comment: (cardId, target, targetId, author, body) =>
        logCardComment(cardId, target, targetId, author, body),
      workspace: (card) => cardWorkspace(card as CardRow),
      scopes: (card, rootPath) =>
        rootPath ? loadCardScopes(rootPath, card.id) : [],
      normalizeStatus: (value) => normalizeStatus(value),
      statusLabel: (status) => statusLabelForSummary(status),
    },
  });

  // The scheduler lives with the feature it drives: disabling the module
  // (STELOW_GITHUB_ISSUES=0) stops the ticks along with the RPCs.
  registerAutomationSchedule(bb, () => github.runAutomationRules());

  const artifactsPublication = createArtifactsPublication({
    db,
    bb,
    now,
    randomId,
    cardNotFound: ERR_CARD_NOT_FOUND,
    cards: {
      get: (cardId) => getCard(cardId),
      checkout: (card) => cardCheckout(card as CardRow),
    },
    normalizeStatus,
  });

  const cardDetail = createCardDetailHandler({
    db,
    bb,
    now,
    idleAttentionMs: IDLE_ATTENTION_MS,
    getCard,
    cardWorkspace,
    syncThreadState,
    fetchPendingQuestions,
    resolveAskOptions,
    cardAttachments,
    detectMentionedFiles,
    workspaceRelative,
    parseNextStages,
    getReliablePreset: getReliablePresetForBand,
    strategyList,
    flowTimes: flowTimesForCard,
    verifiedHeadSha: verifiedHeadShaForCard,
    workers,
    executionLifecycle,
    stalenessForQuestions,
    stateDir: (sourcePath, card) =>
      card.dir_hash
        ? workflowStateDir(bb, sourcePath, card.id, card.dir_hash)
        : Promise.resolve(null),
    fileTimestamp,
    auditReceiptNote,
    cardNotFound: ERR_CARD_NOT_FOUND,
  });
  const cardMutations = createCardMutationHandlers({
    db,
    bb,
    now,
    getCard,
    cardWorkspace,
    workflowStateDir,
    logCardComment,
    updateCard,
    errors: {
      cardNotFound: ERR_CARD_NOT_FOUND,
      cardArchived: ERR_CARD_ARCHIVED,
    },
  });
  const cardLifecycle = createCardLifecycleHandlers({
    db,
    bb,
    getCard,
    cardWorkspace,
    workflowStateDir,
    workers,
    updateCard,
    releaseClaims: releaseCardClaimsAndNotify,
    removeCardPreset,
    logCardComment,
    runGitIn,
    exploratoryScope: EXPLORATORY_SCOPE,
    discardEvidence,
    discardEligibility,
    discardConfirm,
    discardTrail,
    errors: { cardNotFound: ERR_CARD_NOT_FOUND },
  });
  const cardOperations = createCardOperationsHandlers({
    db,
    bb,
    getCard,
    workers,
    updateCard,
    releaseClaims: releaseCardClaimsAndNotify,
    recordStageEvent,
    cardStageSlug,
    fetchPendingAsks,
    openExpiredQuestionIds,
    logCardComment,
    resetAutoContinue,
    buildNudge: (card) => recoveryNudge(card, INTERFACE_PICK),
    buildContinueInput,
    splitRequestNudge: SPLIT_REQUEST_NUDGE,
    phaseEntryStages: PHASE_ENTRY_STAGES,
    errors: { cardNotFound: ERR_CARD_NOT_FOUND, cardArchived: ERR_CARD_ARCHIVED },
  });

  const researchTrack = createResearchTrackHandlers({
    db,
    bb,
    now,
    getCard,
    cardWorkspace,
    createCard: createCardInternal,
    readResearchIndex,
    researchRoundFiles,
    strategyRounds,
    strategyList,
    workflowStateDir: (rootPath, workflowId, dirHash) =>
      workflowStateDir(bb, rootPath, workflowId, dirHash),
    roundRelPath,
    ensureParent: ensureArtifactParent,
    logCardComment,
    reliablePreset: (band, cardId) => getReliablePresetForBand(band, cardId),
    presetName: (presetId) => getPresetById(presetId)?.name,
    respawn: (cardId, presetId, reason, options) =>
      workers.respawn(cardId, presetId, reason, options),
    errors: { cardNotFound: ERR_CARD_NOT_FOUND, cardArchived: ERR_CARD_ARCHIVED },
  });

  registerRpcHandlers(
    bb,
    rpcContract,
    {
      ...decisionApi.handlers,
      ...github.handlers,
      ...inbox.handlers,
      ...workspacesRecovery.handlers,
      ...artifactsPublication.handlers,
      ...executionLifecycle.handlers,
      ...executionReconcile.handlers,
      ...executionAdvance.handlers,
      ...worktreeCleanup.handlers,
      ...cardMutations,
      ...cardLifecycle,
      ...cardOperations,
      cardDetail: cardDetail as never,
      draftDoneComment: ({ cardId }: { cardId: string }) =>
        drafting.draftDoneComment(cardId),
      board: cards.handlers.board as never,
      projects: async () => {
        const list = await bb.sdk.projects.list();
        return {
          projects: list.map((project) => ({
            id: project.id,
            name: project.name,
          })),
        };
      },
      flowMetrics: (input) => flowMetrics(db, input),
      async boardWorkflowDefaults() {
        const stored = await bb.storage.kv.get<unknown>(
          "board-workflow-defaults",
        );
        const parsed = boardWorkflowDefaultsSchema.safeParse(stored);
        if (!parsed.success)
          return {
            appetite: "Lean" as const,
            reviewMode: "Auto" as const,
            reviewGates: [] as Array<
              "spec" | "interface" | "scope" | "tech" | "diff"
            >,
          };
        // Explicit migration, never a silent safeParse fallback: a stored
        // ladder string maps to its set, so a saved "Tech Review" default
        // survives instead of degrading to Auto.
        const record = stored as {
          reviewMode?: unknown;
          reviewGates?: unknown;
        };
        const reviewGates = normalizeReviewGates(
          record.reviewGates ?? record.reviewMode ?? [],
        ) as Array<"spec" | "interface" | "scope" | "tech" | "diff">;
        return {
          appetite: parsed.data.appetite,
          reviewMode: legacyLabelForGates(reviewGates) ?? "Auto",
          reviewGates,
        };
      },

      ...gateHandlers,

      cardDiff,
      auditTrailStatus,
      reseedCard,
      promoteCard,
      advanceCard,
      answerQuestions,

      async startWorkflow({ projectId, prompt }) {
        const thread = await workers.spawnWorkflow({
          projectId,
          environment: { type: "project-default" },
          title: `Stelow: ${prompt.slice(0, 70)}`,
          prompt: `Use the stelow workflow to shape and execute this request. The Stelow workflow skills (stelow-workflow-entry, stelow-workflow-router, \
stelow-workflow-*) are provided by bb-plugin-stelow — load them first. The product strategy playbooks (stelow-product-*) are also provided by \
this plugin \u2014 check \`bb skill list\` first, and only fetch via \`npx skills add calionauta/stelow\` if one is missing. Use \`bb stelow \
advance <stage>\` to change stages; do NOT hand-write stage transitions. Preserve every gate \
(product, interface, tech plan, diff). ${CLI_EQUIVALENTS}\n\nRequest:\n${prompt}`,
        });
        return { threadId: thread.id };
      },

      async ensureWorkflow({ projectId, name, intent }) {
        const rootPath = await projectRoot(bb, projectId);
        if (!rootPath)
          return {
            rootPath: null,
            statePath: null,
            error: "Project workspace path is unavailable.",
          };
        const result = await seedWorkflow(
          bb,
          rootPath,
          workflowIdForName(name),
          name,
          intent,
        );
        if (result.error)
          return { rootPath, statePath: null, error: result.error };
        bb.realtime.publish("board-changed", { reason: "seeded" });
        return { rootPath, statePath: result.statePath, error: null };
      },

      listCards: cards.handlers.listCards,

      async cardByWorkerThread({ threadId }) {
        const row = getCardByWorkerThread(threadId);
        if (!row) return { cardId: null, kind: null };
        // The thread→card relation outlives archiving: a stopped thread on an
        // archived card still answers "which card was this", so the thread
        // header keeps its way back. Card detail renders archived cards.
        return { cardId: row.id, kind: normalizeKind(row.kind) };
      },

      readCardFile: cards.handlers.readCardFile,

      createCard: cards.handlers.createCard,

      gapSummary,
      qualitySeal,

      ...researchTrack,

      answerExpiredQuestions,

      async advance({ projectId, stage }) {
        const rootPath = await projectRoot(bb, projectId);
        if (!rootPath)
          return {
            stage: "",
            stdout: "",
            error: "Project workspace path is unavailable.",
          };
        const guard = await ensureProjectArtifacts(bb, rootPath);
        if (guard) return { stage, stdout: "", error: guard };
        const result = await runHelper(["advance", stage], rootPath);
        if (result.code !== 0)
          return {
            stage,
            stdout: result.stdout,
            error: result.stderr || "stelow advance failed",
          };
        bb.realtime.publish("board-changed", { stage });
        return { stage, stdout: result.stdout, error: null };
      },

      ...presetServer.handlers,

      ...platform,
    },
  );

  const runInspection = createInspectionCommand({
    skillsDir: PLUGIN_SKILLS_DIR,
    errors: {
      archived: ERR_CARD_ARCHIVED,
      workspace: ERR_WORKSPACE_UNAVAILABLE,
    },
    getCard,
    getCardForThread: getCardByWorkerThread,
    cardWorkspace,
    loadBoard: (projectId) => loadBoard(bb, projectId),
    boardFromRoot: (root, dirHash) => boardFromRoot(bb, root, dirHash),
    projectRoot: (projectId) => projectRoot(bb, projectId),
    workflowStateDir: (root, cardId, dirHash) =>
      workflowStateDir(bb, root, cardId, dirHash),
    ensureProjectArtifacts: (root, stateDir, hasOwnedState) =>
      ensureProjectArtifacts(bb, root, stateDir, hasOwnedState),
    runHelper: (args, root, stateDir) => runHelper(args, root, stateDir),
    readText: (path) =>
      bb.sdk.files
        .read({ path })
        .then((file) => file.content)
        .catch(() => null),
    researchStrategySkill: trackCapabilities.researchStrategySkill,
    exploreTechnique: trackCapabilities.exploreTechnique,
  });

  const runStelowCli = createStelowCliRun({
    db,
    bb,
    now,
    randomId,
    getCard,
    getCardByWorkerThread,
    cardWorkspace,
    updateCard,
    logCardComment,
    recordInboxEvent,
    recordStageEvent,
    stageEvents,
    projectRoot: (projectId) => projectRoot(bb, projectId),
    workflowStateDir: (rootPath, workflowId, dirHash) =>
      workflowStateDir(bb, rootPath, workflowId, dirHash),
    ensureProjectArtifacts: (rootPath, stateDir, requireOwnedState) =>
      ensureProjectArtifacts(bb, rootPath, stateDir, requireOwnedState),
    runHelper: (args, cwd, stateDir) => runHelper(args, cwd, stateDir),
    seedWorkflow: (rootPath, workflowId, name, intent) =>
      seedWorkflow(bb, rootPath, workflowId, name, intent),
    cardCheckout,
    gitEvidence: (path) => recoveryGitEvidence(path),
    runGitIn: (cwd, args) => runGitIn(cwd, args),
    workingDiffFor,
    testCommandForCheckout,
    runHostTests,
    spawnDisposable,
    cardStageSlug,
    docDepths: (card) => buildDocDepthsForCard(card),
    passingReviewCovers,
    pendingQuestions: (threadId) => fetchPendingQuestions(threadId),
    pendingAsks: (threadId) => fetchPendingAsks(threadId),
    openExpiredQuestionIds,
    askContractChecklist,
    snapshotQuestionEvidence,
    strategyRounds,
    readResearchIndex,
    researchArtifacts: { researchReadiness, exploreArtifact },
    gapState: (card) => critiqueGapState(card),
    createCard: (input) => createCardInternal(input),
    releaseCardClaims: (cardId) => releaseCardClaimsAndNotify(cardId),
    notifyClaimWaiters,
    lockBlockedSummary,
    workers,
    presets: presetServer,
    reviewPolicy: () => decisionApi.reviewPolicy(),
    decisionRoute: (point, config) => decisionApi.routeConfig(point, config),
    judgeCriteria: judgePresetCriteria,
    judgeScoredBatch,
    preview: { view: previewView, start: previewStart, stop: previewStop },
    draftingCommand: (argv, threadId) => drafting.command(argv, threadId),
    advanceCli: (argv, context) => executionAdvance.cli(argv, context),
    scopeCommand: (argv, context) =>
      runScopeCommand(argv, context, {
        bb,
        getCardByWorkerThread,
        cardWorkspace,
        projectRoot: (projectId) => projectRoot(bb, projectId),
        workflowStateDir: (rootPath, card) =>
          workflowStateDir(bb, rootPath, card.id, card.dir_hash!),
        ensureProjectArtifacts: (rootPath, stateDir, requireOwnedState) =>
          ensureProjectArtifacts(bb, rootPath, stateDir, requireOwnedState),
        runHelper,
        recordTrackableEvent: (event) => {
          recordTrackableEvent(db, event);
        },
      }),
    runInspection,
    skillsDir: PLUGIN_SKILLS_DIR,
  });

  registerStelowCli(bb, (argv, context) => runStelowCli(argv, context));

  registerMentionProviders(bb, {
    db,
    loadBoard: (projectId) => loadBoard(bb, projectId),
  });
}

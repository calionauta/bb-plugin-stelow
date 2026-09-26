/**
 * The execution layer: the run loop, and the thread-state projection it feeds.
 *
 * A card's worker runs because something spawns it, something reconciles it
 * when the host disagrees with the database, and something re-synchronises
 * every card's thread state on boot. All three are the same concern seen from
 * three angles, and all three must agree on one lifecycle — so they are wired
 * here, in order: the native record, then the lifecycle that writes it, then
 * the reconciler that repairs it, then the advance that moves a card on.
 *
 * The layer depends on the gate surfaces only for the question contract an
 * advance must clear, and on nothing else: it never creates a card and never
 * reads a card's artifacts, so it can be built before either exists.
 */
import { createExecutionNative } from "../../execution-native.js";
import { createBoundaryVersionReader } from "../../execution-boundary.js";
import { createExecutionLifecycle } from "../../execution-lifecycle.js";
import { createExecutionReconcile } from "../../execution-reconcile.js";
import { createExecutionAdvance } from "../../execution-advance.js";
import { createScopeMapReader } from "../../scope-map-reader.js";
import { createWorktreeCleanup } from "../../worktree-cleanup.js";
import { createResearchTrackSync } from "../research-track-sync.js";
import { createBuildThreadSync } from "../build-thread-sync.js";
import { registerRuntimeLifecycle } from "../composition.js";
import { recordTrackableEvent } from "../../../lib/trackable-events.mjs";
import { isDoneStatus } from "../../../lib/trackables.mjs";
import { isArchivedCard } from "../../../lib/worker-action-policy.mjs";
import { IDLE_ATTENTION_MS, AUDIT_DONE_NUDGE } from "../attention-window.js";
import { INTERFACE_PICK } from "../plugin-protocols.js";
import type { AnswerBoundaryPort } from "../question-answers.js";
import type { RuntimeCore } from "../runtime-core.js";
import type { GateSurfaces } from "./gate-surfaces.js";
import type { Deferred } from "./deferred.js";

export type ExecutionSurfaces = ReturnType<typeof createExecutionSurfaces>;

export type ExecutionSurfaceDeps = {
  core: RuntimeCore;
  gates: GateSurfaces;
  /**
   * Where the answer doors read the boundary port from. This layer binds it as
   * soon as the lifecycle exists, which is what lets an answer that names a
   * run's boundary resume the run rather than the worker thread.
   */
  boundary: Deferred<AnswerBoundaryPort>;
};

export function createExecutionSurfaces(deps: ExecutionSurfaceDeps) {
  const { core, gates, boundary } = deps;
  const executionNative = buildNative(core);
  const scopeMaps = createScopeMapReader(core.bb);
  const executionLifecycle = buildLifecycle(core, executionNative);
  boundary.bind({
    routeAnswerContinuation: executionLifecycle.routeAnswerContinuation,
    resumeAfterAnswers: executionLifecycle.resumeAfterAnswers,
  });
  const executionReconcile = buildReconcile(core, executionNative, executionLifecycle);
  return {
    executionNative,
    executionLifecycle,
    executionReconcile,
    executionAdvance: buildAdvance(core, gates, executionNative, scopeMaps.scopeMapApproved),
    scopeMaps,
    worktreeCleanup: buildWorktreeCleanup(core),
    ...buildThreadSync(core),
  };
}

/** The execution rows themselves: one card's run, recorded in the database. */
function buildNative(core: RuntimeCore) {
  const { bb, db, randomId, cardWorkspace } = core;
  return createExecutionNative({
    db,
    bb,
    randomId,
    cardWorkspace,
    stateDir: (card, rootPath) =>
      core.workflowStateDir(bb, rootPath, card.id, card.dir_hash!),
    logComment: (cardId, targetId, body) =>
      core.ledger.logCardComment(cardId, "card", targetId, "agent", body),
  });
}

/** Spawn and stop: the two calls that change whether a worker exists. */
function buildLifecycle(
  core: RuntimeCore,
  native: ReturnType<typeof buildNative>,
) {
  const { bb, db, randomId, getCard, cardWorkspace } = core;
  return createExecutionLifecycle({
    db,
    bb,
    randomId,
    getCard,
    logComment: (cardId, targetId, body) =>
      core.ledger.logCardComment(cardId, "card", targetId, "agent", body),
    native,
    // A boundary answer is only an answer if the card's shape has not moved
    // since the question was asked; the reader compares the run's contract
    // against what the card holds now.
    boundaryVersions: createBoundaryVersionReader({
      bb,
      getCard,
      cardWorkspace,
      stateDir: (card, rootPath) =>
        core.workflowStateDir(bb, rootPath, card.id, card.dir_hash!),
    }),
  });
}

/**
 * The reconciler. It runs at boot and after every spawn: the host knows which
 * threads exist, the database knows what they were doing, and the difference
 * is a card whose state is now a guess.
 */
function buildReconcile(
  core: RuntimeCore,
  native: ReturnType<typeof buildNative>,
  lifecycle: ReturnType<typeof buildLifecycle>,
) {
  const { bb, db, now, randomId, getCard, cardWorkspace } = core;
  return createExecutionReconcile({
    db,
    bb,
    now,
    randomId,
    getCard,
    cardWorkspace,
    fetchPendingQuestions: core.fetchPendingQuestions,
    logComment: (cardId, targetId, body) =>
      core.ledger.logCardComment(cardId, "card", targetId, "agent", body),
    publishCard: (cardId) => bb.realtime.publish("card-state", { cardId }),
    native,
    lifecycle,
  });
}

/** The advance: the transition, and the evidence it leaves on the card. */
function buildAdvance(
  core: RuntimeCore,
  gates: GateSurfaces,
  native: ReturnType<typeof buildNative>,
  scopeMapApproved: (stateDir: string | null) => Promise<boolean>,
) {
  const { bb, getCard, cardWorkspace, updateCard, presetServer, workers } = core;
  const ERRORS = core.ERRORS;
  return createExecutionAdvance({
    errors: {
      cardNotFound: ERRORS.cardNotFound,
      cardArchived: ERRORS.cardArchived,
      workspaceUnavailable: ERRORS.workspaceUnavailable,
    },
    getCard,
    getCardByWorkerThread: core.ledger.getCardByWorkerThread,
    cardWorkspace,
    projectRoot: (projectId) => core.projectRoot(bb, projectId),
    stateDir: (card, rootPath) =>
      core.workflowStateDir(bb, rootPath, card.id, card.dir_hash!),
    // A broad refactor may not enter execution on scope blocks alone: it needs
    // a recorded, approved map of what it delivers.
    scopeMapApproved,
    ensureArtifacts: (rootPath, stateDir, requireOwnedState) =>
      core.ensureProjectArtifacts(bb, rootPath, stateDir, requireOwnedState),
    questionGate: gates.questionContractsGate,
    runHelper: core.runHelper,
    native,
    reworkNote: (card) => auditReworkNote(card, gates.critiqueGapState),
    updateCard: (cardId, fields) =>
      updateCard(cardId, fields as Parameters<typeof updateCard>[1]),
    recordStageEvent: core.ledger.recordStageEvent,
    recordExecutionEntry: (cardId, evidence, transition) =>
      recordExecutionEntry(core.db, cardId, evidence, transition),
    getReliablePreset: presetServer.getReliablePresetForBand,
    getCardPresetId: (cardId) => presetServer.getPresetForCard(cardId).id,
    respawn: (cardId, presetId) => workers.respawn(cardId, presetId),
    scheduleRespawn: (cardId, presetId) => workers.scheduleRespawn(cardId, presetId),
    requestGatePreReview: core.requestGatePreReview,
    publishCard: (cardId) => bb.realtime.publish("card-state", { cardId }),
    isArchivedCard,
  });
}

/** Cleanup: drop a worktree the card is done with, and say so on the card. */
function buildWorktreeCleanup(core: RuntimeCore) {
  const { bb, getCard, workers } = core;
  return createWorktreeCleanup({
    getCard,
    evidence: (card) => core.git.discardEvidence(card as never),
    dropWorktree: core.git.dropLinkedWorktree,
    stopWorker: (threadId) => workers.stop(threadId),
    log: core.ledger.commentCard,
    publish: (event, payload) => bb.realtime.publish(event, payload),
  });
}

/**
 * The two synchronisations, and the lifecycle registration that drives them.
 * A track's completion contract differs from a build's (a valid index versus
 * a valid stage artifact), so each has its own projection and they agree only
 * on the lifecycle they share.
 */
function buildThreadSync(core: RuntimeCore) {
  const { bb, db, now, getCard, cardWorkspace, updateCard, workers } = core;
  const trackSync = createResearchTrackSync({
    bb,
    db,
    now,
    getCard,
    updateCard,
    recordInboxEvent: core.recordInboxEvent,
    resolvePausedEvents: (cardId, at) =>
      core.resolveInboxEvents(cardId, at, ["paused"], "completed"),
    recordStageEvent: core.ledger.recordStageEvent,
    markThreadRunning: core.trackProjection.markThreadRunning,
    syncQuestions: core.questions.syncOpenQuestionInbox,
    noteAgentOutput: core.trackProjection.noteAgentOutput,
    applyFailed: (cardId, threadId, error) =>
      workers.applyFailed(cardId, threadId, error),
    escalateIfStalled: core.claims.escalateIfStalled,
    researchReadiness: core.researchArtifacts.researchReadiness,
    exploreArtifact: core.researchArtifacts.exploreArtifact,
    idleAttentionMs: IDLE_ATTENTION_MS,
  });
  const syncThreadState = createBuildThreadSync({
    bb,
    db,
    now,
    getCard,
    cardWorkspace,
    workflowStateDir: core.workflowStateDir,
    updateCard,
    syncResearch: trackSync.syncResearch,
    syncExplore: trackSync.syncExplore,
    syncQuestions: core.questions.syncOpenQuestionInbox,
    applyFailed: (cardId, threadId, error) =>
      workers.applyFailed(cardId, threadId, error),
    logComment: core.ledger.commentCard,
    recordInbox: core.recordInboxEvent,
    vetContinuation: core.decision.vetAutoContinue,
    escalateIfStalled: core.claims.escalateIfStalled,
    stripMessageDirectives: core.stripMessageDirectives,
    interfacePick: INTERFACE_PICK,
    auditDoneNudge: AUDIT_DONE_NUDGE,
    idleAttentionMs: IDLE_ATTENTION_MS,
  });
  return { trackSync, syncThreadState };
}

/** Register the boot reconcile and the interval that keeps it honest. */
export function registerExecutionLifecycle(
  core: RuntimeCore,
  execution: ExecutionSurfaces,
): void {
  const { bb, db, getCard, cardWorkspace, workers } = core;
  registerRuntimeLifecycle({
    bb,
    db,
    syncThreadState: execution.syncThreadState,
    applyFailed: (cardId, threadId, error) =>
      workers.applyFailed(cardId, threadId, error),
    executionReconcile: execution.executionReconcile,
    getCard,
    cardWorkspace,
    maybeBumpSeverity: core.decision.maybeBumpSeverity,
    notifyClaimWaiters: core.notifyClaimWaiters,
    disposeWorkers: () => workers.dispose(),
  });
}

/** An execution transition recorded on the card's trackable history. */
function recordExecutionEntry(
  db: RuntimeCore["db"],
  cardId: string,
  evidence: string,
  transition: string,
): void {
  recordTrackableEvent(db, {
    cardId,
    kind: "scope",
    trackableId: "all",
    transition,
    actor: "host",
    evidence,
  });
}

/**
 * Why an audit card went back to execution instead of forward. Only an audit
 * card with a matched gap set says anything; a gap read that fails is silence,
 * not a false claim that the audit found nothing.
 */
async function auditReworkNote(
  card: Parameters<GateSurfaces["critiqueGapState"]>[0],
  critiqueGapState: GateSurfaces["critiqueGapState"],
): Promise<string> {
  if (card.stage !== "audit") return "";
  const gaps = await critiqueGapState(card).catch(() => null);
  if (!gaps?.matched) return "";
  const open = (gaps.auditGapScopes ?? []).filter(
    (scope) => !isDoneStatus(scope.status),
  );
  return open.length > 0
    ? `\n(rework loop: back to execution from audit — picking up ${open.length} open audit-gap scope(s): ${open.map((scope) => scope.id).join(", ")})`
    : "\n(rework loop: back to execution from audit — no open audit-gap scopes)";
}

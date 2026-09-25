/**
 * The CLI surfaces: the `bb stelow` command, and the inspection it dispatches
 * into.
 *
 * One command surface, one context object. The inspection command is built
 * first because the dispatcher hands it the argv it could not route itself,
 * and the scope command is a seam of its own because it records trackable
 * events the CLI does not own. Everything here reads the same core the RPC
 * surfaces read, so `bb stelow` and the UI can never disagree about a card.
 */
import { createStelowCliRun } from "../cli/cli-dispatcher.js";
import { createInspectionCommand } from "../cli-inspection.js";
import { registerStelowCli } from "../composition.js";
import { runScopeCommand } from "../../scopes.js";
import { seedWorkflow } from "../workflow-seeding.js";
import { PLUGIN_SKILLS_DIR } from "../../plugin-paths.js";
import { recordTrackableEvent } from "../../../lib/trackable-events.mjs";
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import type { WorkerCard } from "../../workers-types.js";
import type { RuntimeCore } from "../runtime-core.js";
import type { GateSurfaces } from "./gate-surfaces.js";
import type { ExecutionSurfaces } from "./execution-surfaces.js";
import type { CardSurfaces } from "./card-surfaces.js";

export type CliSurfaceDeps = {
  bb: BbPluginApi;
  core: RuntimeCore;
  gates: GateSurfaces;
  execution: ExecutionSurfaces;
  cards: CardSurfaces;
};

/** Register `bb stelow` on the host, wired against the assembled surfaces. */
export function registerStelowCommand(deps: CliSurfaceDeps): void {
  const runInspection = createInspectionCommand(inspectionDeps(deps));
  const run = createStelowCliRun({
    ...cliDeps(deps),
    runInspection,
    scopeCommand: scopeCommand(deps),
  });
  registerStelowCli(deps.bb, (argv, context) => run(argv, context));
}

/** The inspection command: reads, never writes, and refuses what it cannot. */
type InspectionConfig = Parameters<typeof createInspectionCommand>[0];

function inspectionDeps(deps: CliSurfaceDeps): InspectionConfig {
  const { bb, core } = deps;
  const ERRORS = core.ERRORS;
  return {
    skillsDir: PLUGIN_SKILLS_DIR,
    errors: {
      archived: ERRORS.cardArchived,
      workspace: ERRORS.workspaceUnavailable,
    },
    getCard: core.getCard,
    getCardForThread: core.ledger.getCardByWorkerThread,
    cardWorkspace: core.cardWorkspace,
    loadBoard: (projectId) => core.loadBoard(bb, projectId),
    boardFromRoot: (root, dirHash) => core.boardFromRoot(bb, root, dirHash),
    projectRoot: (projectId) => core.projectRoot(bb, projectId),
    workflowStateDir: (root, cardId, dirHash) =>
      core.workflowStateDir(bb, root, cardId, dirHash),
    ensureProjectArtifacts: (root, stateDir, hasOwnedState) =>
      core.ensureProjectArtifacts(bb, root, stateDir, hasOwnedState),
    runHelper: (args, root, stateDir) => core.runHelper(args, root, stateDir),
    readText: (path) =>
      bb.sdk.files
        .read({ path })
        .then((file) => file.content)
        .catch(() => null),
    researchStrategySkill: core.trackCapabilities.researchStrategySkill,
    exploreTechnique: core.trackCapabilities.exploreTechnique,
  };
}

/** The dispatcher context: every seam the routed command families read. */
type CliRunConfig = Omit<
  Parameters<typeof createStelowCliRun>[0],
  "runInspection" | "scopeCommand"
>;

function cliDeps(deps: CliSurfaceDeps): CliRunConfig {
  const { bb, core, execution, cards, gates } = deps;
  const { seams, cardPreview, workers } = core;
  return {
    db: core.db,
    bb,
    now: core.now,
    randomId: core.randomId,
    getCard: core.getCard,
    cardWorkspace: core.cardWorkspace,
    updateCard: core.updateCard,
    logCardComment: core.ledger.logCardComment,
    recordInboxEvent: core.recordInboxEvent,
    ...ledgerReads(core),
    projectRoot: (projectId) => core.projectRoot(bb, projectId),
    workflowStateDir: (rootPath, workflowId, dirHash) =>
      core.workflowStateDir(bb, rootPath, workflowId, dirHash),
    ensureProjectArtifacts: (rootPath, stateDir, requireOwnedState) =>
      core.ensureProjectArtifacts(bb, rootPath, stateDir, requireOwnedState),
    runHelper: (args, cwd, stateDir) => core.runHelper(args, cwd, stateDir),
    seedWorkflow: (rootPath, workflowId, name, intent) =>
      seedWorkflow(bb, rootPath, workflowId, name, intent),
    cardCheckout: seams.cardCheckout,
    ...gitReads(core),
    spawnDisposable: core.spawnDisposable,
    cardStageSlug: seams.cardStageSlug,
    docDepths: (card) => seams.buildDocDepthsForCard(card),
    passingReviewCovers: seams.passingReviewCovers,
    pendingQuestions: core.fetchPendingQuestions,
    ...questionReads(core),
    ...researchReads(core),
    gapState: gates.critiqueGapState,
    createCard: (input) => cards.cards.createInternal(input),
    ...claimSeams(core),
    workers,
    presets: core.presetServer,
    ...decisionSeams(core),
    preview: {
      view: cardPreview.view,
      start: cardPreview.start,
      stop: cardPreview.stop,
    },
    draftingCommand: (argv, threadId) => core.drafting.command(argv, threadId),
    advanceCli: (argv, context) => execution.executionAdvance.cli(argv, context),
    skillsDir: PLUGIN_SKILLS_DIR,
  };
}

/**
 * The research reads: the round history, the index, and the two lightweight
 * track artifacts. A CLI readiness verdict reads the same readiness the track
 * sync writes.
 */
function researchReads(core: RuntimeCore) {
  const { researchArtifacts } = core;
  return {
    strategyRounds: core.strategyRounds,
    readResearchIndex: researchArtifacts.readResearchIndex,
    researchArtifacts: {
      researchReadiness: researchArtifacts.researchReadiness,
      exploreArtifact: researchArtifacts.exploreArtifact,
    },
  };
}

/**
 * The card ledger reads a CLI command reports against: which stage events
 * exist, and which card a thread belongs to.
 */
function ledgerReads(core: RuntimeCore) {
  return {
    recordStageEvent: core.ledger.recordStageEvent,
    stageEvents: core.ledger.stageEvents,
    getCardByWorkerThread: core.ledger.getCardByWorkerThread,
  };
}

/**
 * The host-side git a CLI command runs itself: a diff, a test run, a checkout
 * probe. These are the same functions the host-facing surfaces use, so a CLI
 * verdict and an RPC verdict about the same tree come from the same run.
 */
function gitReads(core: RuntimeCore) {
  const { git } = core;
  return {
    gitEvidence: git.recoveryGitEvidence,
    runGitIn: git.runGitIn,
    workingDiffFor: git.workingDiffFor,
    testCommandForCheckout: git.testCommandForCheckout,
    runHostTests: git.runHostTests,
  };
}

/**
 * The claim seams: release a claim the CLI took, and the summary that explains
 * why a scope is still waiting on someone else's file.
 */
function claimSeams(core: RuntimeCore) {
  const { claims } = core;
  return {
    releaseCardClaims: claims.releaseCardClaimsAndNotify,
    notifyClaimWaiters: core.notifyClaimWaiters,
    lockBlockedSummary: claims.lockBlockedSummary,
  };
}

/**
 * The decision seams: the review policy, the route a decision point resolves
 * through, and the two preset judges. A CLI verdict and an RPC verdict about
 * the same artifact must come from the same judge.
 */
function decisionSeams(core: RuntimeCore): Pick<
  CliRunConfig,
  "reviewPolicy" | "decisionRoute" | "judgeCriteria" | "judgeScoredBatch"
> {
  return {
    reviewPolicy: () => core.decision.reviewPolicy(),
    decisionRoute: (point, config) => core.decision.routeConfig(point, config),
    judgeCriteria: core.judgePresetCriteria,
    judgeScoredBatch: core.judgeScoredBatch,
  };
}

/**
 * The reads a CLI command needs to reason about a card's questions: what is
 * still open, what was asked, and the evidence the ask captured. They come
 * from the core rather than from a CLI-local read, so a command that reports
 * an open question and the card view that shows it cannot disagree.
 */
function questionReads(core: RuntimeCore) {
  const { questions, seams, asks } = core;
  return {
    pendingAsks: questions.fetchPendingAsks,
    openExpiredQuestionIds: questions.openExpiredQuestionIds,
    askContractChecklist: seams.askContractChecklist,
    snapshotQuestionEvidence: asks.snapshotQuestionEvidence,
  };
}

/**
 * The scope command, recorded as a trackable event on the card. It is wired
 * here rather than handed to the dispatcher whole because the event write is
 * the one thing the CLI does not own the schema for.
 */
type ScopeCommand = Parameters<typeof createStelowCliRun>[0]["scopeCommand"];

/**
 * The scope command reads the same card row every other surface reads. It is
 * generic over the row so the command family can be driven by a narrow card
 * in a test; the plugin only ever has the full one.
 */
type ScopeCommandDeps = NonNullable<
  Parameters<typeof runScopeCommand<WorkerCard>>[2]
>;

function scopeCommand(deps: CliSurfaceDeps): ScopeCommand {
  const { bb, core } = deps;
  const scopeDeps: ScopeCommandDeps = {
    bb,
    getCardByWorkerThread: core.ledger.getCardByWorkerThread,
    cardWorkspace: core.cardWorkspace,
    projectRoot: (projectId) => core.projectRoot(bb, projectId),
    workflowStateDir: (rootPath, card) =>
      core.workflowStateDir(bb, rootPath, card.id, card.dir_hash!),
    ensureProjectArtifacts: (rootPath, stateDir, requireOwnedState) =>
      core.ensureProjectArtifacts(bb, rootPath, stateDir, requireOwnedState),
    runHelper: core.runHelper,
    recordTrackableEvent: (event) => {
      recordTrackableEvent(core.db, event);
    },
  };
  return (argv, context) => runScopeCommand(argv, context, scopeDeps);
}

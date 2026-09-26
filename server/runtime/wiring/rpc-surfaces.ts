/**
 * The RPC registry: the one object every handler is registered from.
 *
 * This is where a surface stops being a module and becomes a capability. Each
 * key here is a name a client calls; the value is the handler its owning
 * module built. The registry adds nothing of its own except the handful of
 * handlers whose body is genuinely one decision — the projects list, the
 * stored board defaults, the workflow spawn and seed, the stage advance — and
 * those live in their own functions below rather than inline, so this file
 * reads as a table of names.
 */
import { boardWorkflowDefaultsSchema } from "../../contracts.js";
import { rpcContract } from "../../rpc-contract.js";
import { registerRpcHandlers } from "../composition.js";
import { workflowIdForName } from "../../../lib/workflow-state-identity.mjs";
import {
  legacyLabelForGates,
  normalizeReviewGates,
} from "../../../lib/review-gates.mjs";
import { seedWorkflow } from "../workflow-seeding.js";
import { flowMetrics } from "../flow-metrics.js";

type FlowMetricsInput = Parameters<typeof flowMetrics>[1];
import { startWorkflowPrompt } from "../start-workflow-prompt.js";
import { createCardByWorkerThread } from "../thread-card-lookup.js";
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import type { RuntimeCore } from "../runtime-core.js";
import type { GateSurfaces } from "./gate-surfaces.js";
import type { ExecutionSurfaces } from "./execution-surfaces.js";
import type { CardSurfaces } from "./card-surfaces.js";
import type { HostSurfaces } from "./host-surfaces.js";

export type RpcSurfacesDeps = {
  bb: BbPluginApi;
  core: RuntimeCore;
  gates: GateSurfaces;
  execution: ExecutionSurfaces;
  cards: CardSurfaces;
  host: HostSurfaces;
};

/** Register every Stelow RPC on the host, from the assembled surfaces. */
export function registerStelowRpc(deps: RpcSurfacesDeps): void {
  registerRpcHandlers(deps.bb, rpcContract, createRpcHandlers(deps));
}

/** The handler table: the surfaces by name, plus the inline decisions. */
export function createRpcHandlers(deps: RpcSurfacesDeps) {
  const { bb, core, gates, execution, cards, host } = deps;
  return {
    ...core.decision.handlers,
    ...host.github.handlers,
    ...core.inbox.handlers,
    ...cards.workspacesRecovery.handlers,
    ...host.artifactsPublication.handlers,
    ...execution.executionLifecycle.handlers,
    ...execution.executionReconcile.handlers,
    ...execution.executionAdvance.handlers,
    ...execution.worktreeCleanup.handlers,
    ...cards.cardMutations,
    ...cards.cardLifecycle,
    ...cards.cardOperations,
    cardDetail: cards.cardDetail as never,
    draftDoneComment: ({ cardId }: { cardId: string }) =>
      core.drafting.draftDoneComment(cardId),
    board: cards.cards.handlers.board as never,
    projects: listProjects(bb),
    flowMetrics: (input: FlowMetricsInput) => flowMetrics(core.db, input),
    boardWorkflowDefaults: () => readBoardWorkflowDefaults(bb),
    ...gates.gateHandlers,
    cardDiff: gates.cardDiff,
    auditTrailStatus: gates.auditTrailStatus,
    reseedCard: gates.reseedCard,
    promoteCard: cards.promoteCard,
    advanceCard: gates.advanceCard,
    answerQuestions: gates.answerQuestions,
    startWorkflow: startWorkflow(deps),
    ensureWorkflow: ensureWorkflow(deps),
    listCards: cards.cards.handlers.listCards,
    cardByWorkerThread: createCardByWorkerThread(
      core.ledger.getCardByWorkerThread,
    ),
    readCardFile: cards.cards.handlers.readCardFile,
    createCard: cards.cards.handlers.createCard,
    gapSummary: gates.gapSummary,
    qualitySeal: gates.qualitySeal,
    ...cards.researchTrack,
    answerExpiredQuestions: gates.answerExpiredQuestions,
    advance: advanceStage(deps),
    ...core.presetServer.handlers,
    ...host.platform,
  };
}

/** Every project the host knows, as the id/name pair the board lists. */
function listProjects(bb: BbPluginApi) {
  return async () => {
    const list = await bb.sdk.projects.list();
    return {
      projects: list.map((project) => ({ id: project.id, name: project.name })),
    };
  };
}

/**
 * The board's default appetite and review ladder.
 *
 * An explicit migration, never a silent safeParse fallback: a stored ladder
 * string maps to its set, so a saved "Tech Review" default survives instead of
 * degrading to Auto.
 */
type BoardWorkflowDefaults = z.infer<typeof boardWorkflowDefaultsSchema>;

async function readBoardWorkflowDefaults(bb: BbPluginApi): Promise<BoardWorkflowDefaults> {
  const stored = await bb.storage.kv.get<unknown>("board-workflow-defaults");
  const parsed = boardWorkflowDefaultsSchema.safeParse(stored);
  if (!parsed.success) return DEFAULT_BOARD_WORKFLOW_DEFAULTS;
  const record = stored as {
    reviewMode?: unknown;
    reviewGates?: unknown;
  };
  const reviewGates = normalizeReviewGates(
    record.reviewGates ?? record.reviewMode ?? [],
  ) as BoardWorkflowDefaults["reviewGates"];
  return {
    appetite: parsed.data.appetite,
    reviewMode: legacyLabelForGates(reviewGates) ?? "Auto",
    reviewGates,
  };
}

const DEFAULT_BOARD_WORKFLOW_DEFAULTS: BoardWorkflowDefaults = {
  appetite: "Lean",
  reviewMode: "Auto",
  reviewGates: [],
};

/** Spawn the workflow thread that shapes and executes a free-text request. */
function startWorkflow(deps: RpcSurfacesDeps) {
  const { core } = deps;
  return async function startWorkflowThread({
    projectId,
    prompt,
  }: {
    projectId: string | null;
    prompt: string;
  }) {
    if (!projectId) {
      throw new Error("A workflow needs a project to run in.");
    }
    const thread = await core.workers.spawnWorkflow({
      projectId,
      environment: { type: "project-default" },
      title: `Stelow: ${prompt.slice(0, 70)}`,
      prompt: startWorkflowPrompt(prompt),
    });
    return { threadId: thread.id };
  };
}

/** Seed (or adopt) the workflow a named board column tracks. */
function ensureWorkflow(deps: RpcSurfacesDeps) {
  const { core } = deps;
  const { bb } = core;
  return async function ensureWorkflowSeeded({
    projectId,
    name,
    intent,
  }: {
    projectId: string | null;
    name: string;
    intent: string;
  }) {
    if (!projectId) {
      return {
        rootPath: null,
        statePath: null,
        error: "Project workspace path is unavailable.",
      };
    }
    const rootPath = await core.projectRoot(bb, projectId);
    if (!rootPath) {
      return {
        rootPath: null,
        statePath: null,
        error: "Project workspace path is unavailable.",
      };
    }
    const result = await seedWorkflow(
      bb,
      rootPath,
      workflowIdForName(name),
      name,
      intent,
    );
    if (result.error) return { rootPath, statePath: null, error: result.error };
    bb.realtime.publish("board-changed", { reason: "seeded" });
    return { rootPath, statePath: result.statePath, error: null };
  };
}

/**
 * Advance the project's own stage. The board's stage is a different contract
 * from a card's (a valid index, not a valid stage artifact), so it gets its
 * own handler rather than the card advance.
 */
function advanceStage(deps: RpcSurfacesDeps) {
  const { bb, core } = deps;
  return async function advanceProjectStage({
    projectId,
    stage,
  }: {
    projectId: string | null;
    stage: string;
  }) {
    if (!projectId) {
      return { stage: "", stdout: "", error: "Project workspace path is unavailable." };
    }
    const rootPath = await core.projectRoot(bb, projectId);
    if (!rootPath) {
      return { stage: "", stdout: "", error: "Project workspace path is unavailable." };
    }
    const guard = await core.ensureProjectArtifacts(bb, rootPath);
    if (guard) return { stage, stdout: "", error: guard };
    const result = await core.runHelper(["advance", stage], rootPath);
    if (result.code !== 0) {
      return {
        stage,
        stdout: result.stdout,
        error: result.stderr || "stelow advance failed",
      };
    }
    bb.realtime.publish("board-changed", { stage });
    return { stage, stdout: result.stdout, error: null };
  };
}



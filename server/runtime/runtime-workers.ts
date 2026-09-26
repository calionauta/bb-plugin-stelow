/**
 * Workers: the thread lifecycle, plus the two surfaces that spawn their own.
 *
 * Construction order is the contract. The respawn preparation must exist
 * before the workers that call it, and the workers must exist before the
 * drafting server (which resumes into their environment) or the gate
 * pre-review (which stops their threads). Drafts and gate reviews are
 * disposable spawns, so they die with the card's worker rather than
 * outliving it.
 */
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import { createWorkers } from "../workers.js";
import { createDraftingServer } from "../drafting.js";
import { createGatePreReview } from "../review-preflight.js";
import { createWorkerRespawnPreparation } from "./worker-respawn-preparation.js";
import { createDisposableSpawner } from "./disposable-spawn.js";
import { strategyList, strategyRounds } from "./track-projection.js";
import { text } from "./values.js";
import { roundRelPath } from "./card-seams.js";
import { workspaceRelative } from "./card-files.js";
import { boardFromRoot } from "./board-read.js";
import { workflowStateDir } from "./workflow-state.js";
import { isArchivedCard } from "../../lib/worker-action-policy.mjs";
import { resetAutoContinue } from "../../lib/auto-continue.mjs";
import { roundTimestamp } from "../../lib/research-rounds.mjs";
import { ERRORS } from "./card-errors.js";
import { WORKER_PROTOCOL_CLAUSES } from "./worker-protocol-clauses.js";
import type { RuntimeServices } from "./runtime-services.js";
import type { CardLedger } from "./card-ledger.js";
import type { TrackPrompts } from "./track-prompts.js";

export type WorkerRuntimeDeps = {
  bb: BbPluginApi;
  db: ReturnType<BbPluginApi["storage"]["database"]>;
  now: () => number;
  services: RuntimeServices;
  ledger: CardLedger;
  prompts: TrackPrompts;
};

export function createWorkerRuntime(deps: WorkerRuntimeDeps) {
  const spawnDisposable = createDisposableSpawner(deps.bb);
  const { services, ledger, prompts } = deps;
  const workers = createWorkers({
    db: deps.db,
    bb: deps.bb,
    now: deps.now,
    getCard: services.getCard,
    updateCard: services.updateCard,
    comment: (cardId, body) =>
      ledger.logCardComment(cardId, "card", cardId, "agent", body),
    getPreset: (presetId) => services.presetServer.getPresetById(presetId),
    getReliablePreset: services.presetServer.getReliablePresetForBand,
    presetParams: services.presetParams,
    prepareRespawn: createWorkerRespawnPreparation({
      bb: deps.bb,
      presetParams: services.presetParams,
      cardWorkspace: services.cardWorkspace,
      workflowStateDir,
      strategyList,
      strategyRounds,
      researchWorkerPrompt: prompts.researchWorkerPrompt,
      exploreWorkerPrompt: prompts.exploreWorkerPrompt,
      roundRelPath,
      text,
      protocols: WORKER_PROTOCOL_CLAUSES,
    }),
    resetAutoContinue,
    errors: {
      cardNotFound: ERRORS.cardNotFound,
      cardArchived: ERRORS.cardArchived,
      presetNotFound: ERRORS.presetNotFound,
    },
  });
  return { workers, spawnDisposable };
}

export function createDraftRuntime(
  deps: WorkerRuntimeDeps & {
    workers: ReturnType<typeof createWorkers>;
    spawnDisposable: ReturnType<typeof createDisposableSpawner>;
  },
) {
  const { services, ledger, workers, spawnDisposable } = deps;
  return createDraftingServer({
    db: deps.db,
    bb: deps.bb,
    now: deps.now,
    timestamp: roundTimestamp,
    getCard: services.getCard,
    getCardByWorkerThread: ledger.getCardByWorkerThread,
    isArchivedCard,
    cardWorkspace: services.cardWorkspace,
    continuingEnvironment: workers.continuingEnvironment,
    getPreset: (presetId) => services.presetServer.getPresetById(presetId),
    getPresetForBand: services.presetServer.getPresetForBand,
    getGenerationPresetId: services.presetServer.getGenerationPresetId,
    presetParams: services.presetParams,
    spawnDisposable,
    stopThread: (threadId) => workers.stop(threadId),
    comment: (cardId, body) =>
      ledger.logCardComment(cardId, "card", cardId, "agent", body),
    publish: (event, payload) => deps.bb.realtime.publish(event, payload),
    stateDir: (card, workspace) =>
      workflowStateDir(deps.bb, workspace.path, card.id, card.dir_hash!),
    workspaceRelative,
  });
}

export function createGatePreReviewRuntime(
  deps: WorkerRuntimeDeps & {
    spawnDisposable: ReturnType<typeof createDisposableSpawner>;
    workers: ReturnType<typeof createWorkers>;
  },
) {
  const { services, ledger, spawnDisposable, workers } = deps;
  return createGatePreReview({
    bb: deps.bb,
    getCard: services.getCard,
    getReviewPresetId: services.presetServer.getReviewPresetId,
    getPresetById: services.presetServer.getPresetById,
    presetAttachmentParams: services.presetServer.presetAttachmentParams,
    cardWorkspace: services.cardWorkspace,
    boardFromRoot,
    spawnDisposable,
    stopThread: (threadId) => workers.stop(threadId),
    logCardComment: ledger.logCardComment,
  });
}

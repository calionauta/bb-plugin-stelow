/**
 * The runtime core: every seam a surface may reach for, built once.
 *
 * The composition root used to spell this out inline, hand-copying twenty-odd
 * arguments into every factory. Here the shared seams are constructed in
 * dependency order and handed to each surface as one object, so a new
 * surface takes what it needs instead of an argument list that can silently
 * drift from the factory's contract.
 *
 * Order is the reason this is a function and not a bag of consts: the
 * services must exist before the workers that respawn into them, the workers
 * before the checkout seam, and the checkout seam before the ask seam that
 * reads the stage through it.
 */
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import { createTrackCapabilities } from "./track-capabilities.js";
import { createTrackPrompts } from "./track-prompts.js";
import { createDecisionSurface } from "./decision-surface.js";
import { createRuntimeServices } from "./runtime-services.js";
import { startRuntimeServices } from "./lifecycle-startup.js";
import { createCardLedger, randomId } from "./card-ledger.js";
import { createReadRuntime } from "./read-runtime.js";
import {
  createDraftRuntime,
  createGatePreReviewRuntime,
  createWorkerRuntime,
} from "./runtime-workers.js";
import { loadBoard, boardFromRoot } from "./board-read.js";
import { roundRelPath } from "./card-seams.js";
import { strategyList, strategyRounds } from "./track-projection.js";
import { stripMessageDirectives } from "./message-text.js";
import { workflowStateDir, ensureProjectArtifacts } from "./workflow-state.js";
import { runHelper } from "./helper-script.js";
import { projectRoot } from "./root-paths.js";
import { BUILD_INFO } from "../plugin-paths.js";
import { WORKER_PROTOCOL_CLAUSES } from "./worker-protocol-clauses.js";
import { REVIEW_PROTOCOL } from "./plugin-protocols.js";

export type RuntimeCore = ReturnType<typeof createRuntimeCore>;

export function createRuntimeCore(bb: BbPluginApi) {
  const db = bb.storage.database();
  const now = () => Date.now();
  const ledger = createCardLedger({ db, now });
  const { updates: pluginUpdates } = startRuntimeServices({
    bb,
    db,
    now,
    installedVersion: BUILD_INFO.version,
  });
  const services = createRuntimeServices({ bb, db, now, randomId });
  const prompts = createTrackPrompts({
    cardOwnerRules: WORKER_PROTOCOL_CLAUSES.cardOwnerRules,
    doneProtocol: WORKER_PROTOCOL_CLAUSES.doneProtocol,
    reviewProtocol: REVIEW_PROTOCOL,
    draftProtocol: WORKER_PROTOCOL_CLAUSES.draftProtocol,
  });
  const workers = createWorkerRuntime({ bb, db, now, services, ledger, prompts });
  return {
    bb,
    db,
    now,
    randomId,
    ledger,
    prompts,
    pluginUpdates,
    ...services,
    ...workers,
    drafting: createDraftRuntime({
      bb, db, now, services, ledger, prompts, ...workers,
    }),
    requestGatePreReview: createGatePreReviewRuntime({
      bb, db, now, services, ledger, prompts, ...workers,
    }),
    ...createReadRuntime({
      bb,
      db,
      now,
      services,
      ledger,
      workerEnvironmentOf: workers.workers.workerEnvironmentOf,
    }),
    decision: createDecisionSurface({
      db,
      bb,
      now,
      judgeViaPreset: services.judgeViaPreset,
      presetExists: (id) => services.presetServer.getPresetById(id) !== null,
    }),
    trackCapabilities: createTrackCapabilities(),
    roundRelPath,
    strategyList,
    strategyRounds,
    stripMessageDirectives,
    // Unbound, so a call site that already holds the host keeps passing it.
    loadBoard,
    boardFromRoot,
    workflowStateDir,
    ensureProjectArtifacts,
    runHelper,
    projectRoot,
  };
}

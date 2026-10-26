import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { failureCauseFromEvents } from "../lib/worker-failure.mjs";
import { needsNaming } from "../lib/card-naming.mjs";
import { clearPresetStaleness, recordWorkerThread } from "../lib/worker-ledger.mjs";
import { resetSpawnRetry } from "../lib/spawn-retry.mjs";
import { mergeLineageFile, writeMergedFile } from "../lib/workflow-lineage.mjs";
import { presetBandsForCardKindStage } from "../lib/preset-staleness.mjs";
import { stageLabel } from "../lib/workflow-vocabulary.mjs";
import { createWorkerHistory } from "./workers-history.js";
import { createWorkerRetry } from "./workers-retry.js";
import { createRespawnScheduler, defaultWorkerScheduler } from "./workers-scheduler.js";
import { recoverInterruptedRespawns } from "./workers-respawn-guard.js";
import { replaceCardWorker, spawnCardWorker, stopThread } from "./workers-spawn.js";
import { respawn, type RespawnDeps } from "./workers-respawn.js";
import {
  continuingEnvironment,
  workerEnvironmentOf,
  type PresetParams,
  type ThreadEnvironment,
} from "./workers-environment.js";
import type {
  Preset,
  RespawnOptions,
  RespawnPreparation,
  WorkerCard,
  WorkerScheduler,
  WorkerSpawnArgs,
} from "./workers-types.js";

export { runWorkerMigrations } from "./workers-migrations.js";
// Re-exported so the callers that already imported these from here keep
// working; the declarations moved to workers-types.ts so the replacement
// module can name them without importing this file back.
export type { WorkerCard, Preset, RespawnOptions, RespawnPreparation } from "./workers-types.js";
export type { PresetParams } from "./workers-environment.js";
export { workerEnvironment } from "./workers-environment.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type SpawnArgs = Parameters<BbPluginApi["sdk"]["threads"]["spawn"]>[0];

export type WorkerDeps = {
  db: Db;
  bb: BbPluginApi;
  now: () => number;
  getCard: (cardId: string) => WorkerCard | undefined;
  updateCard: (cardId: string, fields: Record<string, unknown>) => void;
  comment: (cardId: string, body: string) => void;
  getPreset: (presetId: string) => Preset | null;
  getReliablePreset: (band: string | string[], cardId: string) => Preset;
  presetParams: (preset: Preset) => PresetParams;
  prepareRespawn: (
    card: WorkerCard,
    preset: Preset,
    reason: string,
    options?: RespawnOptions,
  ) => Promise<RespawnPreparation>;
  resetAutoContinue: () => { count: number; stage: string | null };
  scheduler?: WorkerScheduler;
  retryDelayMs?: (attempt: number) => number;
  /**
   * Late-bound title-burst hook. The drafting server (which owns
   * suggestCardName) is constructed after the workers, so the composition
   * root passes a holder and fills `request` once drafting exists. Absent
   * means naming stays creation-only — the pre-change behavior.
   */
  titleRefresh?: { request: ((cardId: string) => void) | null };
  errors: { cardNotFound: string; cardArchived: string; presetNotFound: string };
};

function recordThread(
  deps: WorkerDeps,
  cardId: string,
  threadId: string,
  presetId: string | null,
  reason: string,
): number {
  const closed = recordWorkerThread(deps.db, cardId, threadId, presetId, reason);
  // A fresh spawn is the explicit clear for preset staleness: the new thread
  // was born after every override, so a carried flag would offer a Restart
  // for staleness that no longer exists.
  try {
    clearPresetStaleness(deps.db, cardId);
  } catch {
    /* the flag is advisory; the spawn already committed */
  }
  return closed;
}

type LineageInput = {
  rootPath: string;
  dirHash: string;
  threadId: string;
  presetId: string | null;
  reason: string;
};

async function lineage(deps: WorkerDeps, input: LineageInput): Promise<void> {
  try {
    const path = join(input.rootPath, "stelow.json");
    await writeMergedFile(
      deps.bb.sdk.files,
      path,
      input.rootPath,
      (existing) => mergeLineageFile(existing, input.dirHash, {
        threadId: input.threadId,
        presetId: input.presetId,
        endedReason: input.reason,
      }),
    );
  } catch { /* audit-only */ }
}

function continuationText(card: WorkerCard): string {
  if (card.kind === "research") return "continuing the research";
  if (card.kind === "explore") return "continuing the explore run";
  // The label, with no "the ... stage" around it. That wrapper read fine for a
  // one-word noun ("the Triage stage") and badly for every label that already
  // contains a noun ("the Technical Review stage"), and a sentence that has to be
  // reworded as the catalog grows is a sentence the catalog should not own.
  return `continuing from ${stageLabel(card.stage)}`;
}

async function fresh(
  deps: WorkerDeps,
  cardId: string,
  reason: "start" | "restart",
  options?: { automatic?: boolean },
): Promise<{ ok: boolean; error: string | null }> {
  const card = deps.getCard(cardId);
  if (!card) return { ok: false, error: deps.errors.cardNotFound };
  if (card.status === "archived") return { ok: false, error: deps.errors.cardArchived };
  if (reason === "start" && card.worker_thread_id) {
    return { ok: false, error: "This card already has a worker thread." };
  }
  const effective = deps.getReliablePreset(presetBandsForCardKindStage(card.kind, card.stage), cardId);
  const previousThreadId = card.worker_thread_id;
  const result = await respawn(respawnDeps(deps), cardId, effective.id, reason);
  if (!result.ok) return { ok: false, error: result.error ?? null };
  const presetName = deps.getPreset(effective.id)?.name ?? effective.id;
  const trail = reason === "start" || !previousThreadId
    ? `Worker started on preset "${presetName}", ${continuationText(card)}.`
    : `Worker restarted on preset "${presetName}", ${continuationText(card)}. Previous worker thread: ${previousThreadId} (archived).`;
  deps.comment(cardId, trail);
  if (reason === "start") refreshUnsettledTitle(deps, card);
  const reset = deps.resetAutoContinue();
  deps.updateCard(cardId, { auto_continue_count: reset.count, auto_continue_stage: reset.stage });
  // A person starting or restarting a card opens a new failure episode. An
  // automatic retry must NOT: its replacement can die before it starts, and
  // clearing the budget there is what turned a permanent provider error into
  // an endless spawn loop. The episode clears on the first worker output
  // (`build-thread-sync`), which is the real proof that it started.
  if (!options?.automatic) resetSpawnRetry(deps.db, cardId);
  deps.bb.realtime.publish("card-state", { cardId });
  return { ok: true, error: null };
}

/**
 * The three closures `workers-respawn.ts` needs from here.
 *
 * They stay private to this file and are handed over as a slice rather than
 * exported individually: the replacement is the only caller, and an export is a
 * promise that somebody else might start relying on.
 */
function respawnDeps(deps: WorkerDeps): RespawnDeps {
  return {
    ...deps,
    recordThread: (cardId, threadId, presetId, reason) => recordThread(deps, cardId, threadId, presetId, reason),
    lineage: (input) => lineage(deps, input),
    continuingEnvironment: (card, fallback) => continuingEnvironment(deps, card, fallback),
    noteLinkFailure: (cardId, body) => deps.comment(cardId, body),
  };
}

/**
 * Start-time title reuse: a parked card whose title is still the unsettled
 * heuristic gets the same suggestCardName burst creation fires. Human-set
 * titles never reach the hook (needsNaming is false), and a failure here
 * never breaks the Start itself — naming is advisory.
 */
function refreshUnsettledTitle(deps: WorkerDeps, card: WorkerCard): void {
  try {
    const request = deps.titleRefresh?.request;
    if (!request) return;
    if (!needsNaming({ displayName: card.display_name ?? card.name, name: card.name, prompt: card.prompt })) return;
    request(card.id);
  } catch { /* naming never breaks Start */ }
}

async function failedCause(deps: WorkerDeps, threadId: string): Promise<string | null> {
  try {
    const events = await deps.bb.sdk.threads.events.list({
      threadId,
      types: ["provider/error", "system/error"],
      order: "desc",
      limit: "5",
    });
    return failureCauseFromEvents(events ?? []);
  } catch {
    return null;
  }
}

function workerFacade(
  deps: WorkerDeps,
  retry: ReturnType<typeof createWorkerRetry>,
  history: ReturnType<typeof createWorkerHistory>,
  respawnScheduler: ReturnType<typeof createRespawnScheduler>,
) {
  return {
    stop: (threadId: string | null) => stopThread(deps.bb, threadId),
    spawnInitial: (args: WorkerSpawnArgs) => spawnCardWorker(deps.bb, args),
    spawnWorkflow: (args: WorkerSpawnArgs) => spawnCardWorker(deps.bb, args),
    replacePrepared: (args: WorkerSpawnArgs, previousThreadId: string | null) =>
      replaceCardWorker(deps.bb, args, previousThreadId),
    recordThread: (cardId: string, threadId: string, presetId: string | null, reason: string) =>
      recordThread(deps, cardId, threadId, presetId, reason),
    lineage: (rootPath: string, dirHash: string, threadId: string, presetId: string | null, reason: string) =>
      lineage(deps, { rootPath, dirHash, threadId, presetId, reason }),
    workerEnvironmentOf: (card: WorkerCard) => workerEnvironmentOf(deps, card),
    continuingEnvironment: (card: WorkerCard, fallback: ThreadEnvironment) =>
      continuingEnvironment(deps, card, fallback),
    respawn: (cardId: string, presetId: string, reason?: string, options?: RespawnOptions) =>
      respawn(respawnDeps(deps), cardId, presetId, reason, options),
    fresh: (
      cardId: string,
      reason: "start" | "restart",
      options?: { automatic?: boolean },
    ) => fresh(deps, cardId, reason, options),
    scheduleRespawn: respawnScheduler.schedule,
    applyFailed: retry.applyFailed,
    ...history,
    dispose: () => {
      respawnScheduler.dispose();
      retry.dispose();
    },
  };
}

export function createWorkers(deps: WorkerDeps) {
  const scheduler = deps.scheduler ?? defaultWorkerScheduler;
  // Boot sweep first: a kill -9 between claim and release leaves a pending
  // row whose holder is gone. Reap it now so the card says so instead of
  // refusing its next replacement against a dead claim.
  try {
    recoverInterruptedRespawns(deps.db, {
      nowMs: deps.now(),
      getCard: deps.getCard,
      comment: deps.comment,
    });
  } catch {
    /* recovery is owed, never load-bearing for startup */
  }
  const retry = createWorkerRetry({
    db: deps.db,
    getCard: deps.getCard,
    updateCard: deps.updateCard,
    comment: deps.comment,
    publish: (cardId) => deps.bb.realtime.publish("card-state", { cardId }),
    fresh: (cardId, reason, options) => fresh(deps, cardId, reason, options),
    failedCause: (threadId) => failedCause(deps, threadId),
    scheduler,
    retryDelayMs: deps.retryDelayMs,
  });
  const history = createWorkerHistory(deps.db, deps.bb);
  const respawnScheduler = createRespawnScheduler(
    scheduler,
    (cardId, presetId) => { void respawn(respawnDeps(deps), cardId, presetId); },
  );
  return workerFacade(deps, retry, history, respawnScheduler);
}

export type Workers = ReturnType<typeof createWorkers>;

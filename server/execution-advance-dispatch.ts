/**
 * The dispatch rule: what actually happens once the state has moved. Three
 * outcomes, in this order — the run is recorded as entered, then the route is
 * taken. Coordinator-sequential is recorded on the card because it is a decision
 * a reader will want to find later; native reports its run id or the reason it
 * deferred; anything else is a plain stage advance with a note.
 */
import { STAGE_TO_BAND } from "../lib/workflow-vocabulary.mjs";
import type { ExecutionRouteInfo } from "./execution-native.js";
import type { AdvanceDeps } from "./execution-advance-types.js";
import type { WorkerCard } from "./workers-types.js";

type DispatchDeps = Pick<AdvanceDeps, "native" | "recordExecutionEntry">;
type BandDeps = Pick<AdvanceDeps, "getReliablePreset" | "getCardPresetId" | "respawn" | "scheduleRespawn">;

export type DispatchInput = {
  card: WorkerCard;
  stage: string;
  route: ExecutionRouteInfo | null;
  note: string;
  evidence: string;
};

export type DispatchResult = { stdout: string; error: string | null };

export function createAdvanceDispatcher(deps: DispatchDeps) {
  return {
    dispatchAdvance: (input: DispatchInput) => dispatchAdvance(deps, input),
  };
}

export function createBandRouter(deps: BandDeps) {
  return {
    applyBand: (card: WorkerCard, stage: string, deferred: boolean) =>
      applyBand(deps, card, stage, deferred),
  };
}

export async function dispatchAdvance(
  deps: DispatchDeps,
  input: DispatchInput,
): Promise<DispatchResult> {
  if (input.stage === "execution") {
    recordEntered(deps, input);
  }
  if (input.route?.route.mode === "coordinator-sequential") {
    deps.native.recordCoordinatorSequentialRoute(
      input.card.id,
      input.stage,
      input.route.recipeId,
      input.route.route,
    );
    return { stdout: `${input.note}\n(coordinator-sequential fallback selected)`.trim(), error: null };
  }
  if (input.route?.route.mode === "native") {
    return dispatchNative(deps, input);
  }
  return { stdout: input.note, error: null };
}

async function dispatchNative(
  deps: DispatchDeps,
  input: DispatchInput,
): Promise<DispatchResult> {
  const started = await deps.native.startNativeStageForCard(
    input.card,
    input.route!.recipeId,
    { prompt: input.card.prompt },
    input.stage,
  );
  if (!started.run) return { stdout: input.note, error: null };
  const dispatchNote = started.ok
    ? `\n(native run: ${started.run.runId})`
    : `\n(native execution deferred: ${started.error ?? "unavailable"})`;
  return { stdout: `${input.note}${dispatchNote}`.trim(), error: null };
}

function recordEntered(deps: DispatchDeps, input: DispatchInput): void {
  try {
    deps.recordExecutionEntry(
      input.card.id,
      input.evidence || "execution preflight passed",
      "execution-entered",
    );
  } catch {
    /* the trail never blocks a stage transition */
  }
}

/**
 * Each band runs on its own preset. A deferred advance schedules the swap for
 * the moment the card stops running; an immediate one does it now, because the
 * next worker thread has to be the one the band asked for.
 */
export async function applyBand(
  deps: BandDeps,
  card: WorkerCard,
  stage: string,
  deferred: boolean,
): Promise<void> {
  const band = STAGE_TO_BAND[stage];
  if (!band) return;
  const preset = deps.getReliablePreset(band, card.id);
  const currentPresetId = card.worker_preset_id ?? deps.getCardPresetId(card.id);
  if (!preset || preset.id === currentPresetId) return;
  if (deferred) deps.scheduleRespawn(card.id, preset.id);
  else await deps.respawn(card.id, preset.id);
}

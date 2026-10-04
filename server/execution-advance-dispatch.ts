/**
 * The dispatch rule: what actually happens once the state has moved. Three
 * outcomes, in this order — the run is recorded as entered, then the route is
 * taken. Coordinator-sequential is recorded on the card because it is a decision
 * a reader will want to find later; native reports its run id or the reason it
 * deferred; anything else is a plain stage advance with a note.
 */
import { STAGE_TO_BAND } from "../lib/workflow-vocabulary.mjs";
import { sequentialTaskPlan } from "../lib/sequential-receipts.mjs";
import type { ExecutionRouteInfo } from "./execution-native.js";
import type { SequentialRoute } from "./execution-native-route.js";
import type { AdvanceDeps } from "./execution-advance-types.js";
import type { WorkerCard } from "./workers-types.js";

type DispatchDeps = Pick<AdvanceDeps, "native" | "recordExecutionEntry">;
type BandDeps = Pick<AdvanceDeps, "getReliablePreset" | "getCardPresetId" | "respawn" | "scheduleRespawn" | "suggestTier">;

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
    const plan = input.route.recipe ? sequentialTaskPlan(input.route.recipe, {}) : null;
    deps.native.recordCoordinatorSequentialRoute(
      input.card.id,
      input.stage,
      input.route.recipeId,
      withSequentialChecklist(input.route, plan),
    );
    return { stdout: `${input.note}\n${sequentialFallbackNote(plan)}`.trim(), error: null };
  }
  if (input.route?.route.mode === "native") {
    return dispatchNative(deps, input);
  }
  return { stdout: input.note, error: null };
}

/**
 * The coordinator worker gets the same explicit checklist a native run
 * enforces by schema: every required artifact up front. Fields already set
 * by the route (width 0, human boundary) are never overwritten here.
 */
function withSequentialChecklist(
  route: ExecutionRouteInfo,
  plan: ReturnType<typeof sequentialTaskPlan> | null,
): SequentialRoute {
  if (!plan) return route.route;
  return {
    ...route.route,
    requiredOutputs: plan.requiredOutputs,
    effectiveWidth: typeof route.route.effectiveWidth === "number"
      ? route.route.effectiveWidth
      : plan.width,
  };
}

function sequentialFallbackNote(plan: ReturnType<typeof sequentialTaskPlan> | null): string {
  const outputs = plan?.requiredOutputs ?? [];
  if (outputs.length === 0) return "(coordinator-sequential fallback selected)";
  return `(coordinator-sequential fallback selected; expected outputs: ${outputs.join(", ")})`;
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
  // Shadow only, after the real decision: the suggestion is recorded by the
  // verb itself and can never change this swap. Absent in tests and in any
  // wiring that does not opt in; a throwing provider is swallowed here so
  // observation can never break a band swap.
  try {
    await deps.suggestTier?.(card, stage);
  } catch {
    /* shadow never breaks the swap */
  }
}

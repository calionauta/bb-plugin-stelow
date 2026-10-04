/**
 * The routing rule: whether a card's stage runs natively here, falls back to the
 * coordinator, or is refused outright — and the one-time trail comment that says
 * which was chosen and why. The comment is written once per card, stage and
 * recipe: a fallback that is re-decided on every reconcile must not re-announce
 * itself every minute.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { BB_NATIVE_CAPABILITIES } from "../lib/bb-workflow-capabilities.mjs";
import { applyRouteContext } from "../lib/recipe-width.mjs";
import { recipeById, type Recipe } from "../lib/recipe-catalog.mjs";
import { missingNativeCapabilities, resolveExecutionRoute } from "../lib/execution-route.mjs";
import { STAGE_BY_ID } from "../lib/workflow-vocabulary.mjs";
import { nativeWorkflowAvailable } from "./bb-workflow-bridge.js";
import { requiredCapabilities } from "./execution-native-catalog.js";
import type { CardRoute } from "./execution-native-types.js";
import type { WorkerCard } from "./workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export type RouteDeps = {
  db: Db;
  logComment: (cardId: string, targetId: string, body: string) => void;
};

export type SequentialRoute = {
  reason?: string;
  missingCapabilities?: string[];
  preserves?: string[];
  effectiveWidth?: number;
  humanBoundary?: string;
  requiredOutputs?: string[];
};

/** Runtime task context for the width overlay (knobs from state.md when known). */
export type RouteContext = {
  explorationCount?: number;
  appetite?: string;
  partitionSafe?: boolean;
  uiScopePresent?: boolean;
  humanBoundaryPolicy?: "native" | "sequential";
};

export function createNativeRouter(deps: RouteDeps) {
  return {
    resolveStageExecutionRoute: (
      card: WorkerCard,
      stageId: string,
      workspacePath: string,
      routeContext?: RouteContext,
    ) => resolveStageExecutionRoute(deps, card, stageId, workspacePath, routeContext),
    recordCoordinatorSequentialRoute: (
      cardId: string,
      stage: string,
      recipeId: string,
      route: SequentialRoute,
    ) => recordCoordinatorSequentialRoute(deps, cardId, stage, recipeId, route),
  };
}

export async function resolveStageExecutionRoute(
  deps: RouteDeps,
  card: WorkerCard,
  stageId: string,
  workspacePath: string,
  routeContext?: RouteContext,
): Promise<CardRoute | null> {
  const recipeId = STAGE_BY_ID[stageId]?.execution?.recipe;
  if (!recipeId) return null;
  const recipe = recipeById(recipeId);
  if (!recipe) return unknownRecipeRoute(recipeId);
  const stage = STAGE_BY_ID[stageId];
  const early = pureSequentialRoute(card, stage, recipeId, recipe);
  if (early) return early;
  return probeAndOverlay(card, recipeId, recipe, stage, workspacePath, routeContext);
}

function unknownRecipeRoute(recipeId: string): CardRoute {
  return {
    recipeId,
    recipe: null,
    route: {
      mode: "refused",
      code: "fallback-unknown",
      reason: `Unknown recipe ${recipeId}.`,
      redirect: "Fix the canonical recipe catalog.",
    },
  };
}

/**
 * Pure checks first: write policy, capabilities, and coordinator thread cost
 * nothing, while the availability probe costs two CLI round trips. A route
 * that is already decided must never pay for a probe.
 */
function pureSequentialRoute(
  card: WorkerCard,
  stage: (typeof STAGE_BY_ID)[string],
  recipeId: string,
  recipe: Recipe,
): CardRoute | null {
  const writePolicy = (recipe as { write_policy?: string }).write_policy
    ?? (stage as { execution?: { write_policy?: string } }).execution?.write_policy;
  if (writePolicy === "workspace" || recipeId === "scope-batch") {
    return {
      recipeId,
      recipe,
      route: {
        mode: "coordinator-sequential",
        reason: "workspace-writing execution uses the existing card coordinator sequentially",
        preserves: fallbackPreserves(recipe),
      },
    };
  }
  const required = requiredCapabilities(stage, recipe);
  const missing = missingNativeCapabilities(required, BB_NATIVE_CAPABILITIES);
  if (missing.length > 0) {
    return {
      recipeId,
      recipe,
      route: {
        mode: "coordinator-sequential",
        reason: "native capabilities are unavailable",
        missingCapabilities: missing,
        preserves: fallbackPreserves(recipe),
      },
    };
  }
  if (!card.worker_thread_id) {
    return {
      recipeId,
      recipe,
      route: {
        mode: "coordinator-sequential",
        reason: "native Workflows are unavailable",
        preserves: fallbackPreserves(recipe),
      },
    };
  }
  return null;
}

async function probeAndOverlay(
  card: WorkerCard,
  recipeId: string,
  recipe: Recipe,
  stage: (typeof STAGE_BY_ID)[string],
  workspacePath: string,
  routeContext?: RouteContext,
): Promise<CardRoute> {
  const nativeAvailable = await nativeWorkflowAvailable({
    projectId: card.project_id,
    threadId: card.worker_thread_id!,
    workspaceId: workspacePath,
  });
  const base = resolveExecutionRoute({
    recipe,
    requiredCapabilities: requiredCapabilities(stage, recipe),
    nativeCapabilities: BB_NATIVE_CAPABILITIES,
    nativeAvailable,
  });
  if (base.mode !== "native") return { recipeId, recipe, route: base };
  const overlaid = applyRouteContext(base, recipe, routeContext ?? {}, {
    humanBoundaryPolicy: routeContext?.humanBoundaryPolicy ?? "sequential",
  });
  return { recipeId, recipe, route: overlaid };
}

function fallbackPreserves(recipe: Recipe): string[] {
  const fallback = recipe.fallback as { preserves?: unknown } | undefined;
  const preserves = fallback?.preserves;
  return Array.isArray(preserves) ? preserves.filter((entry): entry is string => typeof entry === "string") : [];
}

export function recordCoordinatorSequentialRoute(
  deps: RouteDeps,
  cardId: string,
  stage: string,
  recipeId: string,
  route: SequentialRoute,
): void {
  const marker = `[stelow-execution-route:${cardId}:${stage}:${recipeId}]`;
  const exists = deps.db.prepare("SELECT 1 FROM comments WHERE card_id = ? AND body LIKE ? LIMIT 1")
    .get(cardId, `%${marker}%`);
  if (exists) return;
  deps.logComment(
    cardId,
    cardId,
    [
      `Coordinator-sequential execution selected for ${stage} (${recipeId}).`,
      `${routeExplanation(route)}`,
      marker,
    ].join(" "),
  );
}

function routeExplanation(route: SequentialRoute): string {
  const missing = route.missingCapabilities?.length
    ? ` Missing native capabilities: ${route.missingCapabilities.join(", ")}.`
    : "";
  const preserves = route.preserves?.length
    ? ` Preserved: ${route.preserves.join(", ")}.`
    : "";
  const width = typeof route.effectiveWidth === "number"
    ? ` Effective width: ${route.effectiveWidth}.`
    : "";
  const boundary = route.humanBoundary
    ? ` Human boundary: ${route.humanBoundary}.`
    : "";
  const outputs = route.requiredOutputs?.length
    ? ` Expected outputs: ${route.requiredOutputs.join(", ")}.`
    : "";
  return `${route.reason ?? "Native execution was not selected."}${missing}${preserves}${width}${boundary}${outputs}`;
}

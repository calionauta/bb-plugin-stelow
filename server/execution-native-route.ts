/**
 * The routing rule: whether a card's stage runs natively here, falls back to the
 * coordinator, or is refused outright — and the one-time trail comment that says
 * which was chosen and why. The comment is written once per card, stage and
 * recipe: a fallback that is re-decided on every reconcile must not re-announce
 * itself every minute.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { BB_NATIVE_CAPABILITIES } from "../lib/bb-workflow-capabilities.mjs";
import { recipeById } from "../lib/recipe-catalog.mjs";
import { resolveExecutionRoute } from "../lib/execution-route.mjs";
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
};

export function createNativeRouter(deps: RouteDeps) {
  return {
    resolveStageExecutionRoute: (
      card: WorkerCard,
      stageId: string,
      workspacePath: string,
    ) => resolveStageExecutionRoute(deps, card, stageId, workspacePath),
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
): Promise<CardRoute | null> {
  const recipeId = STAGE_BY_ID[stageId]?.execution?.recipe;
  if (!recipeId) return null;
  const recipe = recipeById(recipeId);
  if (!recipe) {
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
  const stage = STAGE_BY_ID[stageId];
  const nativeAvailable = await isNativeCandidate(
    card,
    recipeId,
    recipe.write_policy as string | undefined,
    workspacePath,
  );
  return {
    recipeId,
    recipe,
    route: resolveExecutionRoute({
      recipe,
      requiredCapabilities: requiredCapabilities(stage, recipe),
      nativeCapabilities: BB_NATIVE_CAPABILITIES,
      nativeAvailable,
    }),
  };
}

/**
 * Native execution needs a coordinator thread to own, a write policy that does
 * not touch the card's own files, and a host that reports the workflow bridge
 * available. Anything else is a question for the route, not for this check.
 */
async function isNativeCandidate(
  card: WorkerCard,
  recipeId: string,
  writePolicy: string | undefined,
  workspacePath: string,
): Promise<boolean> {
  if (writePolicy === "workspace" || recipeId === "scope-batch") return false;
  if (!card.worker_thread_id) return false;
  return nativeWorkflowAvailable({
    projectId: card.project_id,
    threadId: card.worker_thread_id,
    workspaceId: workspacePath,
  });
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
  return `${route.reason ?? "Native execution was not selected."}${missing}${preserves}`;
}

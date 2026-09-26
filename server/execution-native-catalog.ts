/**
 * The native catalog: the vocabulary every native rule speaks. Which stage owns
 * a recipe, which capabilities that stage needs, what the workflow's own
 * configuration says, and the one adapter through which a run is started,
 * watched, resumed, and cancelled. Rules import these rather than re-deriving
 * them, so "the current stage's recipe" means one thing in the whole layer.
 */
import type { ExecutionAdapter } from "../lib/execution-adapter.mjs";
import { type Recipe } from "../lib/recipe-catalog.mjs";
import { parseWorkflowConfig } from "../lib/workflow-config.mjs";
import { STAGE_BY_ID } from "../lib/workflow-vocabulary.mjs";
import { createBbWorkflowAdapter } from "./bb-workflow-adapter.js";
import {
  nativeWorkflowStatus,
  runNativeWorkflow,
  stopNativeWorkflow,
} from "./bb-workflow-bridge.js";
import type {
  NativeTransport,
  WorkflowContext,
  WorkflowStage,
} from "./execution-native-types.js";

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/**
 * What a run of this stage would need from the host, deduplicated: the stage's
 * own declaration, the recipe's, and every task's. A capability named twice is
 * still one capability to check and one to report.
 */
export function requiredCapabilities(stage: WorkflowStage, recipe: Recipe): string[] {
  return [...new Set([
    ...stringArray(stage.execution?.required_capabilities),
    ...stringArray(recipe.required_capabilities),
    ...(recipe.tasks ?? []).flatMap((task) => stringArray(task.requirements)),
  ])];
}

export function canonicalStage(
  stageId: string | undefined,
  recipeId: string,
): WorkflowStage | undefined {
  if (stageId) return STAGE_BY_ID[stageId];
  return Object.values(STAGE_BY_ID).find((entry) => entry.execution?.recipe === recipeId);
}

/** The workflow's own `state.md` configuration, plus the product type it names. */
export function workflowContext(content: string): WorkflowContext {
  const productType = content.match(/^\s*product_type:\s*(.+)$/m)?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, "") ?? null;
  return { ...parseWorkflowConfig(content), productType };
}

/**
 * The one adapter. Every transport call carries the same three ids, and the
 * run/resume pair differs only in where the arguments come from, so both are
 * built from one body rather than two that can drift.
 */
export function createAdapter(
  transport: NativeTransport,
  sourceText: string,
  argsText: string,
): ExecutionAdapter {
  let fallbackArgs: Record<string, unknown> = {};
  try {
    fallbackArgs = record(JSON.parse(argsText));
  } catch {
    fallbackArgs = {};
  }
  const workflowArgs = (values: Record<string, unknown>) => {
    const args = record(values.workflowArgs);
    return Object.keys(args).length > 0 ? args : fallbackArgs;
  };
  const adapter = createBbWorkflowAdapter({
    run: async ({ recipe: _recipe, context }) => {
      const values = record(context);
      const source = typeof values.workflowSource === "string" ? values.workflowSource : sourceText;
      return runNativeWorkflow({ ...transport, source, args: workflowArgs(values) });
    },
    status: async (handle) => nativeWorkflowStatus({
      ...transport,
      runId: String(record(handle).runId ?? ""),
    }),
    resume: async (handle, input) => runNativeWorkflow({
      ...transport,
      source: sourceText,
      args: workflowArgs(record(record(input).args)),
      resumeRunId: String(record(handle).runId ?? ""),
    }),
    cancel: async (handle) => {
      await stopNativeWorkflow({ ...transport, runId: String(record(handle).runId ?? "") });
      return { state: "cancelled" };
    },
    result: async (handle) => nativeWorkflowStatus({
      ...transport,
      runId: String(record(handle).runId ?? ""),
    }),
  });
  if (!adapter) throw new Error("BB Workflows adapter is unavailable.");
  return adapter;
}

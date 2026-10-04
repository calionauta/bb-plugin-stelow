/**
 * Sequential receipts: the coordinator fallback validates the same artifact
 * contract as a native run, without workflow threads, ledger rows, or status
 * polling. Pure and observability-only: it reports which required outputs
 * are present, never a run identity, resume handle, or cancel semantic.
 */
import { requiredOutputPaths, validateExecutionArtifacts } from "./execution-artifacts.mjs";
import { effectiveRecipeWidth, runnableRecipeTasks } from "./recipe-width.mjs";

export function sequentialTaskPlan(recipe, context = {}) {
  const { active, skipped } = runnableRecipeTasks(recipe, context);
  return {
    ordered: active.map((task) => ({ taskId: task.id, output: task.output ?? null })),
    skipped,
    width: effectiveRecipeWidth(recipe, context),
    requiredOutputs: requiredOutputPaths(recipe, context),
  };
}

export function collectSequentialReceipts({ recipe, contents, context = {} }) {
  const validation = validateExecutionArtifacts({ recipe, contents, context });
  const plan = sequentialTaskPlan(recipe, context);
  const byPath = new Map(plan.ordered.map((entry) => [entry.output, entry.taskId]));
  const receipts = validation.paths.map((path) => {
    const text = contents?.[path];
    return {
      taskId: byPath.get(path) ?? null,
      path,
      present: typeof text === "string" && text.trim().length > 0,
      skipped: false,
      reason: null,
    };
  });
  for (const taskId of plan.skipped) {
    receipts.push({ taskId, path: null, present: false, skipped: true, reason: "condition-false" });
  }
  return {
    ok: validation.ok,
    missing: validation.missing,
    malformed: validation.malformed,
    issues: validation.issues,
    width: plan.width,
    requiredOutputs: plan.requiredOutputs,
    receipts,
  };
}

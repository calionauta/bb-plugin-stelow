/**
 * Effective recipe width: how many tasks a recipe can actually run at once
 * under a given context. The route layer uses it to avoid paying the native
 * workflow cost for a run that would execute zero tasks (every task skipped)
 * or that needs a human boundary the host only emulates.
 *
 * Condition semantics mirror lib/execution-artifacts.mjs and the embedded
 * evaluator in server/bb-workflow-bridge.ts. `findings_exist` depends on
 * runtime outputs, so it fails open (active) at route time: the router must
 * never refuse work for outputs that do not exist yet.
 */

function fanoutSupported(context) {
  const raw = Number(context?.explorationCount ?? 3);
  if (Number.isInteger(raw)) return raw >= 2;
  return ["Core", "Complete"].includes(context?.appetite);
}

export function isRecipeTaskActive(task, context = {}) {
  const when = task?.when ?? "always";
  if (when === "always") return true;
  if (when === "appetite_supports_fanout" || when === "exploration_supports_fanout") {
    return fanoutSupported(context ?? {});
  }
  if (when === "partition_is_safe") return context?.partitionSafe === true;
  if (when === "ui_scope_present") return context?.uiScopePresent === true;
  if (when === "findings_exist") return true;
  return true;
}

export function activeRecipeTasks(recipe, context = {}) {
  return (recipe?.tasks ?? []).filter((task) => isRecipeTaskActive(task, context));
}

/**
 * Runnable tasks after the dependency-skipped cascade the rendered workflow
 * applies: a task whose condition is false is skipped, and any task that
 * depends on a skipped task is skipped too. Order follows the catalog array,
 * which lists producers before consumers.
 */
export function runnableRecipeTasks(recipe, context = {}) {
  const active = new Map();
  const skipped = new Set();
  for (const task of recipe?.tasks ?? []) {
    if (!isRecipeTaskActive(task, context)) {
      skipped.add(task.id);
      continue;
    }
    const deps = Array.isArray(task.depends_on) ? task.depends_on : [];
    if (deps.some((id) => skipped.has(id))) {
      skipped.add(task.id);
      continue;
    }
    active.set(task.id, task);
  }
  return { active: [...active.values()], skipped: [...skipped] };
}

function taskLevel(task, levels) {
  const deps = Array.isArray(task.depends_on) ? task.depends_on : [];
  if (deps.length === 0) return 0;
  return 1 + Math.max(...deps.map((id) => levels.get(id) ?? 0));
}

/** Max tasks runnable concurrently: the widest dependency level. */
export function effectiveRecipeWidth(recipe, context = {}) {
  const { active } = runnableRecipeTasks(recipe, context);
  if (active.length === 0) return 0;
  const levels = new Map();
  for (const task of active) levels.set(task.id, taskLevel(task, levels));
  const perLevel = new Map();
  for (const level of levels.values()) perLevel.set(level, (perLevel.get(level) ?? 0) + 1);
  return Math.max(...perLevel.values());
}

export function hasCoordinatorHumanBoundary(recipe, context = {}) {
  return runnableRecipeTasks(recipe, context).active
    .some((task) => task.human_boundary === "coordinator");
}

function preservesOf(recipe) {
  const preserves = recipe?.fallback?.preserves;
  return Array.isArray(preserves) ? preserves : [];
}

/**
 * Context overlay for a resolved route. Pure and narrow: it only ever moves
 * native to coordinator-sequential, never the reverse, and only for two
 * proven wastes — a run with zero runnable tasks, or a coordinator human
 * boundary when the caller opts into sequential human handling. Width 1
 * stays native here on purpose: flipping single-task recipes needs live
 * latency/success evidence first (see docs/native-workflows.md).
 */
export function applyRouteContext(baseRoute, recipe, context = {}, options = {}) {
  if (!baseRoute || baseRoute.mode !== "native") return baseRoute;
  const width = effectiveRecipeWidth(recipe, context);
  if (width === 0) {
    return {
      mode: "coordinator-sequential",
      reason: "no effective recipe task under the current context; a native run would skip everything",
      preserves: preservesOf(recipe),
      effectiveWidth: 0,
    };
  }
  if (options.humanBoundaryPolicy === "sequential" && hasCoordinatorHumanBoundary(recipe, context)) {
    return {
      mode: "coordinator-sequential",
      reason: "recipe waits on a coordinator human boundary; the live needs-input cycle is unproven natively",
      preserves: preservesOf(recipe),
      effectiveWidth: width,
      humanBoundary: "coordinator",
    };
  }
  return baseRoute;
}

/**
 * The recipe condition vocabulary, and the one evaluator that reads it.
 *
 * A recipe task says when it runs with a `when` value. That value is a
 * contract between two repositories: stelow writes the recipe, this host
 * decides what the word means. The word had three meanings here — three
 * implementations that had already drifted:
 *
 *   - `lib/recipe-width.mjs` answered "run it" for anything it did not
 *     recognize;
 *   - `lib/execution-artifacts.mjs` kept a second copy of the same rules,
 *     which disagreed about `appetite_supports_fanout`: one read the
 *     exploration count first, the other read the appetite only;
 *   - `server/bb-workflow-bridge.ts` carried a third copy inside the
 *     rendered script, and it THREW on an unknown condition while the other
 *     two ran the task.
 *
 * So a typo in a recipe was either a task that silently ran or a run that
 * crashed at render time, decided by which host function happened to ask.
 * Two live recipes (`always`, `ui_scope_present`) hid it: the divergence
 * needed a condition nobody uses.
 *
 * The vocabulary is declared upstream. `recipes.schema.json` in the stelow
 * repo names every `when` value a task may carry, and it is synced here as
 * `data/stelow-recipes.schema.json`; this module reads that declaration
 * instead of keeping its own list. A condition upstream adds is a condition
 * this host has not implemented yet, and `tests/recipe-condition-vocabulary.test.mjs`
 * fails until it does.
 */
import schema from "../data/stelow-recipes.schema.json" with { type: "json" };

/**
 * Every `when` value a recipe task may carry, as upstream declares it.
 *
 * Empty means the synced schema does not declare a vocabulary — the host is
 * pinned to a stelow older than the declaration, and there is nothing to
 * check against.
 */
export const RECIPE_CONDITIONS = schema?.$defs?.condition?.enum ?? [];

/**
 * Whether a recipe task runs under a context.
 *
 * Self-contained ON PURPOSE. The native renderer embeds this function's
 * SOURCE into the script it hands the host, because a rendered script must
 * stand alone (plugin-bundled paths are not origin-workspace paths). The
 * embedded copy is therefore this function rather than a transcription of it,
 * which is what makes "one implementation" true instead of aspirational.
 *
 * `findings_exist` depends on runtime outputs. At route time those outputs
 * do not exist yet, and the router must never refuse work for results that
 * have not been written — so it fails open there, and evaluates for real
 * once the outputs are there. An unknown condition is refused outright: a
 * word nobody implements is a typo, and a typo must not read as "run it".
 */
export function recipeConditionHolds(task, context = {}, outputs = {}) {
  const when = task?.when ?? "always";
  if (when === "always") return true;
  if (when === "appetite_supports_fanout" || when === "exploration_supports_fanout") {
    const count = Number(context?.explorationCount ?? 3);
    if (Number.isInteger(count)) return count >= 2;
    return ["Core", "Complete"].includes(context?.appetite);
  }
  if (when === "partition_is_safe") return context?.partitionSafe === true;
  if (when === "ui_scope_present") return context?.uiScopePresent === true;
  if (when === "findings_exist") {
    const values = Object.values(outputs ?? {});
    if (values.length === 0) return true;
    return values.some((value) => Array.isArray(value?.findings) && value.findings.length > 0);
  }
  throw new Error(`Unknown recipe condition: ${when}`);
}

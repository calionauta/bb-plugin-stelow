import catalog from "../data/stelow-recipe-catalog.json" with { type: "json" };

const recipes = new Map((catalog.recipes ?? []).map((recipe) => [recipe.id, Object.freeze(recipe)]));

export function recipeById(id) {
  return recipes.get(id) ?? null;
}

export function recipeIds() {
  return [...recipes.keys()];
}

/**
 * The files a recipe's tasks will write, as paths relative to the run's
 * artifact root, in task order.
 *
 * The recipe catalog has always declared these (`tasks[].output`) and until now
 * nothing read them. They are what a worker actually needs: the host knows
 * exactly which files a run will produce, and the worker was previously left to
 * rediscover the run directory and its layout with `find`, `ls` and `grep` — 247
 * of 3348 commands across the live worker threads reference a run dir or an
 * `exec_` id.
 *
 * Returns [] for an unknown recipe rather than null: an empty list is a truthful
 * "this recipe declares no outputs", and a caller rendering paths should not
 * have to branch on absence to print nothing.
 */
export function recipeOutputs(id) {
  const recipe = recipes.get(id);
  if (!recipe) return [];
  return (recipe.tasks ?? [])
    .map((task) => task.output)
    .filter((output) => typeof output === "string" && output.length > 0);
}

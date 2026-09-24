import catalog from "../data/stelow-recipe-catalog.json" with { type: "json" };

const recipes = new Map((catalog.recipes ?? []).map((recipe) => [recipe.id, Object.freeze(recipe)]));

export function recipeById(id) {
  return recipes.get(id) ?? null;
}

export function recipeIds() {
  return [...recipes.keys()];
}

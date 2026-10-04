export interface RecipeWidthTask {
  id?: unknown;
  when?: unknown;
  depends_on?: unknown;
  human_boundary?: unknown;
}
export interface RecipeWidthRecipe {
  tasks?: readonly RecipeWidthTask[];
  fallback?: { preserves?: readonly string[] } | null;
}
export function isRecipeTaskActive(task: RecipeWidthTask, context?: Record<string, unknown>): boolean;
export function activeRecipeTasks(recipe: RecipeWidthRecipe, context?: Record<string, unknown>): RecipeWidthTask[];
export function runnableRecipeTasks(
  recipe: RecipeWidthRecipe,
  context?: Record<string, unknown>,
): { active: RecipeWidthTask[]; skipped: string[] };
export function effectiveRecipeWidth(recipe: RecipeWidthRecipe, context?: Record<string, unknown>): number;
export function hasCoordinatorHumanBoundary(
  recipe: RecipeWidthRecipe,
  context?: Record<string, unknown>,
): boolean;
export function applyRouteContext<TRoute extends { mode?: string }>(
  baseRoute: TRoute,
  recipe: RecipeWidthRecipe,
  context?: Record<string, unknown>,
  options?: { humanBoundaryPolicy?: string },
): TRoute;

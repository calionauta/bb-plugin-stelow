export declare const RECIPE_CONDITIONS: string[];
export declare function recipeConditionHolds(
  task: { when?: string } | null | undefined,
  context?: Record<string, unknown>,
  outputs?: Record<string, unknown>,
): boolean;

export interface RecipeTask { id: string; skill?: string; output?: string; depends_on?: string[]; output_schema_contract?: Record<string, unknown>; when?: string; requirements?: string[]; failure_policy?: string; human_boundary?: string; }
export interface Recipe { id: string; tasks?: RecipeTask[]; required_capabilities?: string[]; [key: string]: unknown; }
export function recipeById(id: string): Recipe | null;
export function recipeIds(): string[];

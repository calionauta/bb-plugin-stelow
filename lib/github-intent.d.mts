/**
 * Shared GitHub issue → Stelow intent heuristic (single source for manual
 * import and automation rules).
 */
export type GithubIntent = "new-product" | "feature" | "bugfix" | "refactor" | "investigate" | "unknown";
export declare function githubIntentFor(issue: { labels?: unknown; title?: unknown }): GithubIntent;
export declare function normalizeGithubLabels(value: unknown): string[];
export declare function normalizeGithubAuthors(value: unknown): string[];
export declare function applyRulePrompt(prompt: string, template: unknown): string;
export declare function findRelatedIssues(issue: { repo?: unknown; number?: unknown; title?: unknown }, items: unknown, limit?: number): string[];

export declare function sortedUnion(lists: unknown): string[];
export declare function filterImportCandidates<T>(candidates: unknown, filters?: { assignee?: string; project?: string }): Array<T>;
export declare function preselectFreshIssues(issues: unknown): Record<string, boolean>;

/**
 * Matcher for GitHub-label automation rules: exact labels (AND), owning
 * project, never twice (fired + seen keys, shared imported keys).
 * One decision core serves the scheduler and the dry-run preview.
 */
export declare function ruleSourceKey(repo: unknown, number: unknown): string;
export declare function decideAutomationIssue(
  issue: unknown,
  options: {
    watched: string[];
    trustedAuthors?: string[];
    projectId?: unknown;
    projectForRepo?: Map<string, string | null> | Record<string, string | null> | null | undefined;
    fired?: Set<string>;
    imported?: Set<string>;
  },
): { ok: boolean; key: string | null; reason?: string; owner?: string | null };
export declare function matchAutomationIssues(
  issues: unknown,
  options: {
    label?: unknown;
    labels?: unknown;
    trustedAuthors?: unknown;
    projectId?: unknown;
    projectForRepo?: Map<string, string | null> | Record<string, string | null> | null | undefined;
    firedKeys?: Iterable<string> | null | undefined;
    seenKeys?: Iterable<string> | null | undefined;
    importedKeys?: Iterable<string> | null | undefined;
  },
): Array<{ repo: string; number: number; key: string }>;
export declare function previewAutomationMatches(
  issues: unknown,
  options: {
    label?: unknown;
    labels?: unknown;
    trustedAuthors?: unknown;
    projectId?: unknown;
    projectForRepo?: Map<string, string | null> | Record<string, string | null> | null | undefined;
    firedKeys?: Iterable<string> | null | undefined;
    seenKeys?: Iterable<string> | null | undefined;
    importedKeys?: Iterable<string> | null | undefined;
  },
): {
  matches: Array<{ repo: string; number: number; key: string }>;
  skipped: Array<{ repo: string; number: number; key: string; reason: string; owner: string | null }>;
};

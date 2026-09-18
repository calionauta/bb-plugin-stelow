/**
 * Matcher for GitHub-label automation rules: exact label, owning project,
 * never twice. New state-machine-adjacent logic belongs here with a node
 * test (inbox-events / ask-cancel precedent) — never inline-only in
 * server.ts handlers.
 */
export declare function ruleSourceKey(repo: unknown, number: unknown): string;
export declare function matchAutomationIssues(
  issues: unknown,
  options: {
    label?: unknown;
    projectId?: unknown;
    projectForRepo?: Map<string, string | null> | Record<string, string | null> | null | undefined;
    firedKeys?: Iterable<string> | null | undefined;
  },
): Array<{ repo: string; number: number; key: string }>;

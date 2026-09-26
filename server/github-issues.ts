/**
 * GitHub issues, decoupled from the main plugin server.
 *
 * Everything about bringing GitHub issues into Stelow — manual import,
 * automation rules, dry-run preview, run history, completion write-back —
 * lives behind one seam: createGithubAutomation(ctx). Core migrations call
 * runGithubMigrations; the runtime registers handlers and schedules work.
 *
 * This file is the seam only. Each job owns a slice:
 *   github-migrations         tables, columns, the one label backfill
 *   github-client             the typed `github` plugin RPC bridge
 *   github-issue-flow         candidate listing, imports, issue creation
 *   github-automation-rules   the rule row shape, priming, the scheduler tick
 *   github-rule-rpcs          the five watcher-rule RPCs
 *   github-comments           the read-only issue-comment mirror and posting
 *   github-completion         the completion write-back
 *   github-rpc-contract       the wire shapes
 *
 * Kill switch: STELOW_GITHUB_ISSUES=0 disables the scheduler and every
 * RPC (each refusal names the variable). No migration, no UI change.
 */

import { runAutomationRules } from "./github-automation-rules.js";
import { createWarnOnce, type GithubAutomationDeps } from "./github-automation-context.js";
import { createGithubClient } from "./github-client.js";
import { githubCommentHandlers, refreshLinkedDiscussions } from "./github-comments.js";
import { githubCompletionHandlers } from "./github-completion.js";
import { createCardFromGithub, githubIssueFlowHandlers, type CreateCardArgs } from "./github-issue-flow.js";
import { githubRuleHandlers } from "./github-rule-rpcs.js";

export { githubIssuesEnabled } from "./github-automation-context.js";
export type { GithubAutomationDeps, GithubCard } from "./github-automation-context.js";

/** The assembled issue automation: its scheduler, its RPCs, and its status. */
export type GithubAutomation = ReturnType<typeof createGithubAutomation>;

export function createGithubAutomation(ctx: GithubAutomationDeps) {
  const client = createGithubClient(ctx.bb);
  const warnOnce = createWarnOnce();
  // The one shared issue -> card path, injected so the watcher tick and the
  // manual import cannot drift into two different claim protocols.
  const createCard = (args: CreateCardArgs): Promise<{ cardId: string | null; skipped: string | null }> =>
    createCardFromGithub(ctx, client, args);

  const handlers = {
    ...githubRuleHandlers(ctx, client),
    ...githubIssueFlowHandlers(ctx, client),
    ...githubCompletionHandlers(ctx, client),
    ...githubCommentHandlers(ctx, client),
  };

  return {
    runAutomationRules: () => runAutomationRules(ctx, client, warnOnce, createCard),
    refreshLinkedDiscussions: () => refreshLinkedDiscussions(ctx, client, warnOnce),
    handlers,
    githubStatus: client.statusResolved,
  };
}

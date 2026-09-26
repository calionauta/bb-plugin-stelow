/**
 * Completion write-back: post a factual English summary of a finished card
 * back to the GitHub issue it was imported from.
 *
 * Never automatic — Done in Stelow is not merged/deployed, so an auto-close
 * would lie. Uses the github plugin's own RPCs (same auth it syncs with),
 * never shells out. Every failure path returns a reason the human can act
 * on, and the marker check makes a retry safe: a second attempt adopts the
 * existing comment instead of double-posting.
 */
import { carriesMarker, markerFor } from "../lib/github-writeback.mjs";
import { requireGithubIssuesEnabled, type GithubAutomationDeps, type GithubCard } from "./github-automation-context.js";
import type { GithubClient } from "./github-client.js";

type Scope = { name: string; status: string; tasks: Array<{ status: string }> };

const isDone = (status: string): boolean => status === "done" || status === "completed";

function scopeLine(scope: Scope, label: (status: string) => string): string {
  const done = scope.tasks.filter((task) => isDone(task.status)).length;
  const counts = scope.tasks.length > 0 ? `, ${done}/${scope.tasks.length} tasks` : "";
  return `- ${scope.name} (${label(scope.status)}${counts})`;
}

/** The comment body. A factual record, ending in the idempotency marker. */
export function completionBody(
  card: GithubCard,
  scopes: Scope[],
  statusLabel: (status: string) => string,
): string {
  const doneScopes = scopes.filter((scope) => isDone(scope.status)).length;
  const tasksTotal = scopes.reduce((total, scope) => total + scope.tasks.length, 0);
  const tasksDone = scopes.reduce((total, scope) => total + scope.tasks.filter((task) => isDone(task.status)).length, 0);
  const headline = scopes.length > 0
    ? `Scopes: ${doneScopes}/${scopes.length} done; tasks: ${tasksDone}/${tasksTotal} done.`
    : `No scopes tracked.`;
  return [
    `Stelow completed "${card.display_name ?? card.name}" (intent: ${card.intent}, final stage: ${card.stage}).`,
    ``,
    headline,
    ...scopes.map((scope) => scopeLine(scope, statusLabel)),
    ``,
    `Prompt: ${card.prompt.length > 500 ? `${card.prompt.slice(0, 500)}…` : card.prompt}`,
    markerFor(card.id),
  ].join("\n");
}

async function postGithubCompletion(ctx: GithubAutomationDeps, client: GithubClient, { cardId, closeIssue }: { cardId: string; closeIssue: boolean }) {
  const { db, bb } = ctx;
  const now = () => ctx.now();
  requireGithubIssuesEnabled();
  const card = ctx.cards.get(cardId);
  if (!card) return { ok: false, issueUrl: null, error: "Card not found." };
  const link = db.prepare("SELECT repo, number FROM github_imports WHERE card_id = ?").get(cardId) as { repo: string; number: number } | undefined;
  if (!link) return { ok: false, issueUrl: null, error: "This card was not imported from a GitHub issue." };
  if (ctx.cards.normalizeStatus(card.status) !== "completed") return { ok: false, issueUrl: null, error: "Only completed cards can report back to GitHub." };
  const workspace = await ctx.cards.workspace(card).catch(() => null);
  const scopes = ctx.cards.scopes(card, workspace?.path ?? null);
  const body = completionBody(card, scopes, ctx.cards.statusLabel);
  const issueUrl = `https://github.com/${link.repo}/issues/${link.number}`;
  // Idempotency first: a previous attempt may have posted before recording.
  // If the marker is already there, adopt it — retrying never double-posts.
  const marker = markerFor(cardId);
  const before = await client.getIssue({ repo: link.repo, number: link.number }).catch(() => null);
  if (before && carriesMarker(before.issue.comments, marker)) {
    db.prepare("UPDATE github_imports SET commented_at = ? WHERE card_id = ?").run(now(), cardId);
    return { ok: true, issueUrl, error: null };
  }
  try {
    await client.commentIssue({ repo: link.repo, number: link.number, body });
  } catch (error) {
    return { ok: false, issueUrl: null, error: error instanceof Error ? error.message : "Could not comment on the GitHub issue." };
  }
  const after = await client.getIssue({ repo: link.repo, number: link.number }).catch(() => null);
  if (!after || !carriesMarker(after.issue.comments, marker)) {
    return { ok: false, issueUrl, error: "Comment sent but not found back on the issue — check it on GitHub before retrying (retrying never double-posts)." };
  }
  // Record before the optional close: a close failure must never invite a
  // retry that posts the comment twice.
  db.prepare("UPDATE github_imports SET commented_at = ? WHERE card_id = ?").run(now(), cardId);
  if (closeIssue) {
    try {
      await client.setIssueState({ repo: link.repo, number: link.number, state: "closed" });
    } catch {
      return { ok: false, issueUrl, error: "Comment posted, but the automatic close failed — close the issue manually on GitHub." };
    }
  }
  bb.realtime.publish("card-state", { cardId });
  return { ok: true, issueUrl, error: null };
}

export function githubCompletionHandlers(ctx: GithubAutomationDeps, client: GithubClient) {
  return {
    postGithubCompletion: (input: { cardId: string; closeIssue: boolean }) => postGithubCompletion(ctx, client, input),
  };
}

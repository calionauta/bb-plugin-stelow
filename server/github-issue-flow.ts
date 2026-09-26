/**
 * Issue listing and creation: what the picker shows, what an import makes,
 * and the shared GitHub-issue -> card path both the manual import and the
 * watcher rules go through.
 *
 * The path is claim-first (lib/github-claims.mjs, tested): concurrent flows
 * cannot both pass the dedupe check — the loser sees already-imported or
 * in-flight instead of orphaning a second card.
 */
import { execFile } from "node:child_process";
import { buildCreateIssueArgs, issueBodyForCard, issueKey, parseCreateIssueResponse, resolveGhPath, resolveTargetRepo } from "../lib/github-issue-create.mjs";
import { acquireGithubImportClaim, completeGithubImport, releaseGithubClaim } from "../lib/github-claims.mjs";
import { applyRulePrompt, findRelatedIssues, githubIntentFor, normalizeGithubLabels } from "../lib/github-intent.mjs";
import { sortedUnion } from "../lib/github-lists.mjs";
import { decideAutomationSpawn, describeParkedReason } from "../lib/github-automation-gate.mjs";
import {
  effectiveGithubSpawnEnvKind,
  requireGithubIssuesEnabled,
  resolveWorktreePreset,
  type GithubAutomationDeps,
  type GithubDb,
} from "./github-automation-context.js";
import type { GithubClient, GithubIssueComment, GithubIssueItem } from "./github-client.js";
import { githubUnavailableStatus } from "./github-status.js";

export interface GithubIssueRef {
  repo: string;
  number: number;
  title: string;
  author: string;
  body: string;
  url: string;
  labels: string[];
  comments?: GithubIssueComment[];
}

type ImportIssueInput = {
  projectId?: string | null;
  repo: string;
  number: number;
  labels?: string[];
  label?: string;
  start: boolean;
  isolated?: boolean;
};

const defensiveLinkQuery = "UPDATE github_imports SET card_id = ?, label = ?, imported_at = ?,"
  + " claimed_by = NULL WHERE issue_key = ?";
const insertLinkQuery = "INSERT OR IGNORE INTO github_imports"
  + " (issue_key, repo, number, label, card_id, imported_at) VALUES (?,?,?,?,?,?)";

export interface CreateCardArgs {
  projectId: string;
  repo: string;
  number: number;
  triggerLabels: string[];
  start: boolean;
  presetId?: string | null;
  rulePrompt?: string | null;
}

// gh subprocess runner (taskboard precedent: same auth, no second token).
// Stderr carries the refusal; an empty stderr falls back to the exit error.
function execGh(path: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(path, args, { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr ?? "").trim() || error.message));
      else resolve(stdout);
    });
  });
}

// A curated issue reference for the card prompt, so the worker reads the
// issue without re-fetching GitHub. Body + comments give the triage context.
export function githubIssuePrompt(issue: GithubIssueRef, comments: GithubIssueComment[] = []): string {
  const lines = [
    `GitHub issue ${issue.repo}#${issue.number}: ${issue.title}`,
    `Author: ${issue.author}`,
    `Labels: ${issue.labels.join(", ") || "none"}`,
    `URL: ${issue.url}`,
    "",
    issue.body.trim() ? `Description:\n${issue.body.trim()}` : "(no description)",
  ];
  if (comments.length > 0) {
    lines.push("", "Comments:");
    for (const comment of comments) lines.push(`- ${comment.author}: ${comment.body.trim()}`);
  }
  return lines.join("\n");
}

const strList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);

function toCandidateIssue(
  db: GithubDb,
  cards: GithubAutomationDeps["cards"],
  issue: GithubIssueItem,
  repoToProject: Map<string, string | null>,
  items: GithubIssueItem[],
) {
  const key = `${issue.repo}#${issue.number}`;
  const link = db.prepare("SELECT card_id, commented_at FROM github_imports WHERE issue_key = ?").get(key) as
    { card_id: string | null; commented_at: number | null } | undefined;
  const card = link?.card_id ? (cards.get(link.card_id) ?? null) : null;
  // A link without a live card (deleted card, released crash) reads as
  // not-imported so the issue can come back.
  return {
    repo: issue.repo,
    number: issue.number,
    title: issue.title,
    labels: issue.labels,
    author: issue.author,
    assignees: strList(issue.assignees),
    url: issue.url,
    body: issue.body,
    updatedAt: issue.updatedAt,
    projectId: repoToProject.get(issue.repo) ?? null,
    alreadyImported: card !== null,
    cardId: card?.id ?? null,
    cardName: card ? (card.display_name ?? card.name) : null,
    cardStatus: card ? cards.normalizeStatus(card.status) : null,
    postedAt: link?.commented_at ?? null,
    related: findRelatedIssues(issue, items),
  };
}

/** Shared GitHub issue -> card path (manual import + automation rules). */
export async function createCardFromGithub(
  ctx: GithubAutomationDeps,
  client: GithubClient,
  { projectId, repo, number, triggerLabels, start, presetId, rulePrompt }: CreateCardArgs,
): Promise<{ cardId: string | null; skipped: string | null }> {
  const { db, bb } = ctx;
  const key = `${repo}#${number}`;
  const fast = db.prepare("SELECT card_id FROM github_imports WHERE issue_key = ?").get(key) as { card_id: string | null } | undefined;
  if (fast?.card_id && ctx.cards.get(fast.card_id)) return { cardId: fast.card_id, skipped: "already-imported" };
  const token = ctx.randomId("claim");
  const claim = acquireGithubImportClaim(db, { key, repo, number, label: triggerLabels[0] ?? "", token, now: ctx.now() });
  if (!claim.owned) {
    if (claim.cardId && ctx.cards.get(claim.cardId)) return { cardId: claim.cardId, skipped: "already-imported" };
    return { cardId: null, skipped: "in-flight" };
  }
  try {
    const { issue } = await client.getIssue({ repo, number }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "GitHub plugin unavailable";
      throw new Error(`GitHub import unavailable: ${message}`);
    });
    const prompt = applyRulePrompt(githubIssuePrompt(issue, issue.comments), rulePrompt);
    const intent = githubIntentFor({ labels: issue.labels, title: issue.title });
    const card = await ctx.cards.create({
      projectId,
      prompt,
      attachments: [],
      intent,
      appetite: "Lean",
      reviewMode: "Auto",
      presetId: presetId ?? null,
      start,
    });
    if (!completeGithubImport(db, { key, token, cardId: card.cardId, label: triggerLabels[0] ?? "", now: ctx.now() })) {
      // Defensive convergence only (unreachable while the claim holds):
      // link OUR card without the token guard so any retry finds a live
      // card and converges to already-imported instead of orphaning a
      // second one. Overwriting a rival link is impossible here — a rival
      // could only complete with its own token, which the claim excludes.
      db.prepare(defensiveLinkQuery).run(card.cardId, triggerLabels[0] ?? "", ctx.now(), key);
      bb.log.warn(`github import ${key} completed without its claim; linked defensively`);
    }
    await client.setLabels({ repo, number, labels: issue.labels.filter((item) => !triggerLabels.includes(item)) }).catch(() => {});
    return { cardId: card.cardId, skipped: null };
  } finally {
    releaseGithubClaim(db, { key, token });
  }
}

async function listGithubCandidates(ctx: GithubAutomationDeps, client: GithubClient, { labels, label }: { labels?: string[]; label?: string }) {
  requireGithubIssuesEnabled();
  const watched = normalizeGithubLabels(labels ?? label);
  if (watched.length === 0) throw new Error("Pick at least one label.");
  // Safely reject when the github plugin is not available so the UI can
  // show a real reason instead of an empty list. The wrapper's rejection
  // message carries the pluginId/method for the user.
  const items = await client.listItems({ kind: "issue", state: "open" }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "GitHub plugin unavailable";
    throw new Error(`GitHub import unavailable: ${message}`);
  });
  // Resolve each issue to the bb project that owns its repo (GitHub plugin
  // maps repo -> projectId from git remotes), so the UI needs no project
  // picker. Unmapped repos fall back to the caller's active project.
  const status = await client.statusResolved().catch(() => ({ repos: [] as Array<{ repo: string; projectId: string | null }> }));
  const repoToProject = new Map(status.repos.map((entry) => [entry.repo, entry.projectId]));
  const pickerLists = await client.pickers(status.repos.map((entry) => entry.repo));
  const allLabels = sortedUnion([pickerLists.labels, items.items.flatMap((item) => strList(item.labels))]);
  const allAssignees = sortedUnion([pickerLists.assignees, items.items.flatMap((item) => strList(item.assignees))]);
  const issues = items.items
    .filter((item) => watched.every((entry) => item.labels.includes(entry)))
    .sort((a, b) => Number(b.number) - Number(a.number));
  return { allLabels, allAssignees, issues: issues.map((issue) => toCandidateIssue(ctx.db, ctx.cards, issue, repoToProject, items.items)) };
}

async function importGithubIssue(ctx: GithubAutomationDeps, client: GithubClient, input: ImportIssueInput) {
  const { projectId, repo, number, labels, label, start, isolated } = input;
  const { bb } = ctx;
  requireGithubIssuesEnabled();
  const triggerLabels = normalizeGithubLabels(labels ?? label);
  // Isolated start reuses the automation isolation gate (same rule,
  // same redirect): a worktree preset must effectively win, or the
  // import refuses instead of silently landing in the checkout.
  let presetId: string | null = null;
  if (isolated) {
    const gate = decideAutomationSpawn({ startImmediate: true, effectiveEnvKind: effectiveGithubSpawnEnvKind(ctx) });
    if (!gate.start) {
      const reason = describeParkedReason(gate.parkedReason);
      throw new Error(`Isolated start refused: ${reason}. Create a New-worktree preset in Agent Presets,`
        + " or uncheck Isolated worktree to import into the project checkout instead.");
    }
    presetId = resolveWorktreePreset(ctx);
  }
  // Resolve the owning project from the repo (fall back to the caller's
  // active project) when the caller didn't pass one explicitly.
  let resolvedProjectId = projectId;
  if (!resolvedProjectId) {
    const status = await client.statusResolved().catch(() => ({ repos: [] as Array<{ repo: string; projectId: string | null }> }));
    resolvedProjectId = status.repos.find((entry) => entry.repo === repo)?.projectId ?? null;
  }
  if (!resolvedProjectId) throw new Error(`Cannot determine the bb project for repo ${repo}; open it as a project in bb first.`);
  const created = await createCardFromGithub(ctx, client, { projectId: resolvedProjectId, repo, number, triggerLabels, start, presetId });
  // An isolated request that parks must survive until the later Start:
  // pin the worktree preset as this card's override now, or the choice
  // evaporates and the worker lands in the checkout it was meant to avoid.
  if (created.cardId && presetId && !start) {
    const pinned = ctx.presets.pinCardPreset(created.cardId, presetId);
    if (!pinned) throw new Error("Isolated start refused: the worktree preset no longer exists. Choose a New-worktree preset and try again.");
  }
  if (created.cardId) bb.realtime.publish("card-state", { cardId: created.cardId });
  return { ok: true, cardId: created.cardId, skipped: created.skipped, error: null };
}

async function createLinkedGithubIssue(ctx: GithubAutomationDeps, client: GithubClient, { cardId, repo }: { cardId: string; repo?: string | null }) {
  const { db } = ctx;
  requireGithubIssuesEnabled();
  const card = db.prepare("SELECT id, display_name, name, prompt, project_id, status FROM cards WHERE id = ?").get(cardId) as
    { id: string; display_name: string | null; name: string; prompt: string; project_id: string; status: string } | undefined;
  if (!card) return { ok: false, url: null, number: null, error: "Card not found." };
  if (ctx.cards.normalizeStatus(card.status) === "archived") return { ok: false, url: null, number: null, error: "This card is archived." };
  // Idempotent: a linked card returns its link instead of creating twice.
  const existing = db.prepare("SELECT repo, number FROM github_imports WHERE card_id = ?").get(cardId) as { repo: string; number: number } | undefined;
  if (existing) return { ok: true, url: `https://github.com/${existing.repo}/issues/${existing.number}`, number: existing.number, error: null };
  const status = await client.statusResolved().catch(() => githubUnavailableStatus());
  if (!status.ghOk) return { ok: false, url: null, number: null, error: "GitHub is not connected — set up GitHub auth first." };
  const reposForProject: Array<{ repo: string; projectId: string | null }> = status.ghOk ? status.repos : [];
  const mapped = reposForProject.filter((entry) => entry.projectId === card.project_id).map((entry) => entry.repo);
  const resolved = resolveTargetRepo({ mapped, requested: repo ?? null });
  if (!resolved.ok || !resolved.repo) return { ok: false, url: null, number: null, error: resolved.error };
  const title = (card.display_name ?? card.name ?? "").trim() || `Card ${card.id}`;
  let ghPath: string;
  try {
    ghPath = await resolveGhPath(async (candidate) => {
      await execGh(candidate, ["--version"]);
      return true;
    });
  } catch {
    return { ok: false, url: null, number: null, error: "GitHub CLI (gh) is not available on the host." };
  }
  let raw: string;
  try {
    raw = await execGh(ghPath, buildCreateIssueArgs({ repo: resolved.repo, title, body: issueBodyForCard({ prompt: card.prompt, cardId }) }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return { ok: false, url: null, number: null, error: message ? `GitHub refused the issue: ${message}` : "GitHub refused the issue." };
  }
  let parsed: { number: number; url: string };
  try {
    parsed = parseCreateIssueResponse(raw);
  } catch (error) {
    return {
      ok: false,
      url: null,
      number: null,
      error: error instanceof Error ? error.message : "GitHub may have created the issue but the response was unreadable.",
    };
  }
  db.prepare(insertLinkQuery)
    .run(issueKey(resolved.repo, parsed.number), resolved.repo, parsed.number, "", cardId, ctx.now());
  return { ok: true, url: parsed.url, number: parsed.number, error: null };
}

export function githubIssueFlowHandlers(ctx: GithubAutomationDeps, client: GithubClient) {
  return {
    listGithubCandidates: (input: { labels?: string[]; label?: string }) => listGithubCandidates(ctx, client, input),
    importGithubIssue: (input: ImportIssueInput) => importGithubIssue(ctx, client, input),
    createLinkedGithubIssue: (input: { cardId: string; repo?: string | null }) => createLinkedGithubIssue(ctx, client, input),
  };
}

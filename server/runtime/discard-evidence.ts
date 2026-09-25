import { existsSync, lstatSync } from "node:fs";
import { join as nodeJoin } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { DiscardEvidence } from "../../lib/discard-policy.mjs";
import type { WorkerCard } from "../workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type Workspace = { path: string; hostId: string | null };
type GitResult = { ok: boolean; stdout: string };
type GitSummary = {
  branch: string | null;
  upstream: GitResult;
  status: GitResult;
  unpushed: GitResult;
  stash: GitResult;
};
type DiscardEvidenceDeps = {
  db: Db;
  cardWorkspace: (card: WorkerCard) => Promise<Workspace | null>;
  runGitIn: (cwd: string, args: string[]) => Promise<GitResult>;
};

export function createDiscardEvidence(deps: DiscardEvidenceDeps) {
  return (card: WorkerCard): Promise<DiscardEvidence> => discardEvidence(deps, card);
}

async function discardEvidence(
  deps: DiscardEvidenceDeps,
  card: WorkerCard,
): Promise<DiscardEvidence> {
  const blank = blankEvidence(card);
  if (card.workspace_kind === "exploratory") {
    return exploratoryEvidence(deps, card, blank);
  }
  const workspace = await deps.cardWorkspace(card);
  const checkout = workspace?.path ?? null;
  if (!checkout) return blank;
  const top = await deps.runGitIn(checkout, ["rev-parse", "--show-toplevel"]);
  if (!top.ok || !top.stdout.trim()) return { ...blank, checkoutPath: checkout };
  return projectEvidence(deps, card, blank, top.stdout.trim());
}

function blankEvidence(card: WorkerCard): DiscardEvidence {
  return {
    status: card.status,
    workspaceKind: card.workspace_kind,
    checkoutPath: null,
    dirExists: false,
    isGit: false,
    branch: null,
    hasUpstream: false,
    upstreamRef: null,
    changed: [],
    untracked: [],
    unpushedCommits: 0,
    stashCount: 0,
    resetTarget: null,
    linkedWorktree: false,
    sharedWith: 0,
  };
}

function exploratoryEvidence(
  deps: DiscardEvidenceDeps,
  card: WorkerCard,
  blank: DiscardEvidence,
): DiscardEvidence {
  const path = card.workspace_path;
  if (!path) return blank;
  const sql = "SELECT COUNT(*) AS n FROM cards WHERE id != ? AND status != 'archived' "
    + "AND workspace_kind = 'exploratory' AND workspace_path = ?";
  return {
    ...blank,
    checkoutPath: path,
    dirExists: pathExists(path),
    sharedWith: sharedCount(deps, sql, card.id, path),
  };
}

async function projectEvidence(
  deps: DiscardEvidenceDeps,
  card: WorkerCard,
  blank: DiscardEvidence,
  gitRoot: string,
): Promise<DiscardEvidence> {
  const summary = await gitSummary(deps, gitRoot);
  const { changed, untracked } = parseStatus(summary.status);
  const safeResetTarget = await resetTarget(deps, card, gitRoot);
  const sharedSql = "SELECT COUNT(*) AS n FROM cards WHERE id != ? AND status != 'archived' "
    + "AND project_id = ?";
  return {
    ...blank,
    checkoutPath: gitRoot,
    isGit: true,
    branch: summary.branch,
    hasUpstream: summary.upstream.ok && Boolean(summary.upstream.stdout.trim()),
    upstreamRef: successfulText(summary.upstream),
    changed,
    untracked,
    unpushedCommits: countResult(summary.unpushed),
    stashCount: summary.stash.ok ? summary.stash.stdout.split("\n").filter(Boolean).length : 0,
    resetTarget: safeResetTarget,
    linkedWorktree: isLinkedWorktree(gitRoot),
    sharedWith: sharedCount(deps, sharedSql, card.id, card.project_id),
  };
}

async function gitSummary(
  deps: DiscardEvidenceDeps,
  gitRoot: string,
): Promise<GitSummary> {
  const [branch, upstream, status, unpushed, stash] = await Promise.all([
    deps.runGitIn(gitRoot, ["branch", "--show-current"]),
    deps.runGitIn(gitRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]),
    deps.runGitIn(gitRoot, ["status", "--porcelain=v1", "--untracked-files=all"]),
    deps.runGitIn(gitRoot, ["rev-list", "--count", "HEAD", "--not", "--remotes"]),
    deps.runGitIn(gitRoot, ["stash", "list", "--format=%gd"]),
  ]);
  return {
    branch: branch.ok ? branch.stdout.trim() || null : null,
    upstream,
    status,
    unpushed,
    stash,
  };
}

function parseStatus(result: GitResult): { changed: string[]; untracked: string[] } {
  const changed: string[] = [];
  const untracked: string[] = [];
  if (!result.ok) return { changed, untracked };
  for (const line of result.stdout.split("\n")) {
    if (!line) continue;
    if (line.startsWith("??")) untracked.push(line.slice(3));
    else changed.push(line.slice(3));
  }
  return { changed, untracked };
}

async function resetTarget(
  deps: DiscardEvidenceDeps,
  card: WorkerCard,
  gitRoot: string,
): Promise<string | null> {
  try {
    const since = Math.floor(card.created_at / 1000);
    const first = await deps.runGitIn(gitRoot, [
      "log",
      "--format=%H",
      "--reverse",
      `--since=${since}`,
      "HEAD",
      "--",
    ]);
    const firstSha = first.ok
      ? first.stdout.split("\n").map((entry) => entry.trim()).filter(Boolean)[0] ?? null
      : null;
    const revision = firstSha ? `${firstSha}^` : "HEAD";
    const result = await deps.runGitIn(gitRoot, ["rev-parse", revision]);
    return successfulText(result);
  } catch {
    return null;
  }
}

function sharedCount(
  deps: DiscardEvidenceDeps,
  sql: string,
  cardId: string,
  scope: string,
): number {
  try {
    return (deps.db.prepare(sql).get(cardId, scope) as { n: number } | undefined)?.n ?? 0;
  } catch {
    return 0;
  }
}

function pathExists(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

function isLinkedWorktree(gitRoot: string): boolean {
  try {
    return lstatSync(nodeJoin(gitRoot, ".git")).isFile();
  } catch {
    return false;
  }
}

function successfulText(result: GitResult): string | null {
  return result.ok && result.stdout.trim() ? result.stdout.trim() : null;
}

function countResult(result: GitResult): number {
  return result.ok ? Number.parseInt(result.stdout.trim(), 10) || 0 : 0;
}

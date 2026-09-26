/**
 * The linked-issue discussion: a read-only mirror of the GitHub issue's
 * comments, plus the human-gated post that writes back.
 *
 * Mirrored rows are a separate stream from the card conversation by design —
 * external text is context, never instructions. Identity is the content
 * fingerprint (lib/github-issue-comments.mjs), so re-fetches converge.
 */
import { toMirrorRows } from "../lib/github-issue-comments.mjs";
import { validatePostBody } from "../lib/github-issue-create.mjs";
import { githubIssuesEnabled, requireGithubIssuesEnabled, type GithubAutomationDeps, type GithubDb } from "./github-automation-context.js";
import type { GithubClient } from "./github-client.js";
import { githubUnavailableStatus } from "./github-status.js";

interface GithubLink {
  repo: string;
  number: number;
}

type WarnOnce = (key: string) => boolean;

const insertMirrorQuery = "INSERT OR IGNORE INTO github_issue_comments"
  + " (id, card_id, author, body, created_at, fetched_at) VALUES (?,?,?,?,?,?)";
// The mirror poller never re-reads a terminal card: its snapshot is history.
const mirroredLinksQuery = `SELECT gi.repo AS repo, gi.number AS number, gi.card_id AS cardId
  FROM github_imports gi JOIN cards c ON c.id = gi.card_id
  WHERE gi.card_id IS NOT NULL AND c.status NOT IN ('completed','archived')`;

/** Insert the fetched comments; returns how many rows were new. */
function insertMirrorRows(db: GithubDb, cardId: string, comments: Array<{ author: string; body: string; createdAt: string }>, fetchedAt: number): number {
  const insert = db.prepare(insertMirrorQuery);
  let inserted = 0;
  for (const row of toMirrorRows(cardId, comments, fetchedAt)) {
    inserted += insert.run(row.id, row.card_id, row.author, row.body, row.created_at, row.fetched_at).changes;
  }
  return inserted;
}

function linkFor(db: GithubDb, cardId: string): GithubLink | undefined {
  return db.prepare("SELECT repo, number FROM github_imports WHERE card_id = ?").get(cardId) as GithubLink | undefined;
}

/** The card's normalized status, or null when the card row is gone. */
function statusOf(ctx: GithubAutomationDeps, cardId: string): string | null {
  const card = ctx.db.prepare("SELECT status FROM cards WHERE id = ?").get(cardId) as { status: string } | undefined;
  return card ? ctx.cards.normalizeStatus(card.status) : null;
}

/** Refresh the mirror from the remote and publish only when it grew. */
async function refreshMirror(ctx: GithubAutomationDeps, client: GithubClient, cardId: string, link: GithubLink): Promise<void> {
  const issue = await client.getIssue({ repo: link.repo, number: link.number });
  if (insertMirrorRows(ctx.db, cardId, issue.issue.comments, ctx.now()) > 0) {
    ctx.bb.realtime.publish("github-discussion", { cardId });
  }
}

function readStored(ctx: GithubAutomationDeps, cardId: string, link: GithubLink) {
  const rows = ctx.db.prepare("SELECT author, body, created_at, fetched_at FROM github_issue_comments WHERE card_id = ? ORDER BY created_at ASC").all(cardId) as
    Array<{ author: string; body: string; created_at: number; fetched_at: number }>;
  return {
    linked: true, repo: link.repo, number: link.number, url: `https://github.com/${link.repo}/issues/${link.number}`,
    canCreate: false, repos: [] as string[],
    comments: rows.map((row) => ({ author: row.author, body: row.body, createdAt: row.created_at })),
    updatedAt: rows.length > 0 ? Math.max(...rows.map((row) => row.fetched_at)) : null,
  };
}

async function getLinkedDiscussion(ctx: GithubAutomationDeps, client: GithubClient, { cardId }: { cardId: string }) {
  requireGithubIssuesEnabled();
  // Eligibility for the create CTA doubles as the unlinked shape: any
  // non-archived card on a mapped project can link, on any track.
  const link = linkFor(ctx.db, cardId);
  if (!link) {
    const card = ctx.db.prepare("SELECT project_id, status FROM cards WHERE id = ?").get(cardId) as { project_id: string; status: string } | undefined;
    if (!card || ctx.cards.normalizeStatus(card.status) === "archived") {
      return { linked: false, repo: null, number: null, url: null, comments: [], updatedAt: null, canCreate: false, repos: [] as string[] };
    }
    const status = await client.statusResolved().catch(() => githubUnavailableStatus());
    const tracked: Array<{ repo: string; projectId: string | null }> = status.ghOk ? status.repos : [];
    const repos = tracked.filter((entry) => entry.projectId === card.project_id).map((entry) => entry.repo);
    return { linked: false, repo: null, number: null, url: null, comments: [], updatedAt: null, canCreate: repos.length > 0, repos };
  }
  // Terminal cards serve the frozen snapshot: their record is history.
  if (!["completed", "archived"].includes(statusOf(ctx, cardId) ?? "")) {
    try {
      await refreshMirror(ctx, client, cardId, link);
    } catch (error) {
      ctx.bb.log.warn(`linked discussion refresh failed for ${cardId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return readStored(ctx, cardId, link);
}

// Human-gated write-back (the composer confirms destination and text):
// workers never reach this through UI, and the server enforces the
// payload anyway — trust the gesture, verify the payload.
async function postIssueComment(ctx: GithubAutomationDeps, client: GithubClient, { cardId, body }: { cardId: string; body: string }) {
  requireGithubIssuesEnabled();
  const checked = validatePostBody(body);
  if (!checked.ok) return { ok: false, error: checked.error };
  const link = linkFor(ctx.db, cardId);
  if (!link) return { ok: false, error: "This card has no linked GitHub issue." };
  if (statusOf(ctx, cardId) === "archived") return { ok: false, error: "This card is archived." };
  try {
    await client.commentIssue({ repo: link.repo, number: link.number, body: checked.text });
  } catch (error) {
    return { ok: false, error: error instanceof Error && error.message ? `GitHub refused the comment: ${error.message}` : "GitHub refused the comment." };
  }
  // Best-effort mirror refresh so the post reads back instantly; the
  // next fetch converges regardless.
  try {
    await refreshMirror(ctx, client, cardId, link);
  } catch { /* the post succeeded; the next fetch converges */ }
  return { ok: true, error: null };
}

// Poll vehicle for the discussion mirror (own 5-minute schedule in
// server.ts): linked, non-terminal cards only. Terminal cards keep their
// frozen snapshot; viewing any card refreshes on open regardless.
export async function refreshLinkedDiscussions(ctx: GithubAutomationDeps, client: GithubClient, warnOnce: WarnOnce): Promise<void> {
  if (!githubIssuesEnabled()) return;
  const links = ctx.db.prepare(mirroredLinksQuery).all() as Array<{ repo: string; number: number; cardId: string }>;
  for (const link of links) {
    try {
      await refreshMirror(ctx, client, link.cardId, { repo: link.repo, number: link.number });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (warnOnce(`mirror:${link.repo}#${link.number}:${message}`)) {
        ctx.bb.log.warn(`linked discussion mirror skipped ${link.repo}#${link.number}: ${message}`);
      }
    }
  }
}

export function githubCommentHandlers(ctx: GithubAutomationDeps, client: GithubClient) {
  return {
    getLinkedDiscussion: (input: { cardId: string }) => getLinkedDiscussion(ctx, client, input),
    postIssueComment: (input: { cardId: string; body: string }) => postIssueComment(ctx, client, input),
  };
}

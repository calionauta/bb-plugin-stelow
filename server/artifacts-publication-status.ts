import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  canCommitPublication,
  canMarkPullRequestDraft,
  canMarkPullRequestReady,
  canMergePullRequest,
  canSquashMerge,
  publicationBlocker,
} from "../lib/vcs-publication.mjs";
import type { ArtifactsPublicationDeps, PublicationCard, PublicationSnapshot } from "./artifacts-publication.js";

type EnvironmentStatus = Awaited<
  ReturnType<BbPluginApi["sdk"]["environments"]["status"]>
>;
type PullRequestStatus = Awaited<
  ReturnType<BbPluginApi["sdk"]["environments"]["pullRequest"]>
>;
type PublicationAction =
  | "commit"
  | "squash_merge"
  | "push_terminal"
  | "pull_request_ready"
  | "pull_request_draft"
  | "pull_request_merge";
type PreparedEnvironment =
  | { card: PublicationCard; environmentId: string; snapshot: PublicationSnapshot }
  | { error: string };

export function unavailablePublication(
  message: string,
  events: PublicationSnapshot["events"] = [],
): PublicationSnapshot {
  const blocked = { available: false, reason: message };
  return {
    available: false,
    message,
    source: null,
    environmentId: null,
    isWorktree: false,
    branch: null,
    workingTree: null,
    mergeBase: null,
    pullRequest: null,
    pullRequestMessage: null,
    capabilities: {
      commit: blocked,
      squashMerge: blocked,
      markReady: blocked,
      markDraft: blocked,
      mergePullRequest: blocked,
    },
    events,
  };
}

export function publicationEvents(
  deps: ArtifactsPublicationDeps,
  cardId: string,
): PublicationSnapshot["events"] {
  const rows = deps.db.prepare(`
    SELECT id, action, message, commit_sha, pull_request_url, created_at
    FROM publication_events WHERE card_id = ? ORDER BY created_at DESC LIMIT 12
  `).all(cardId) as Array<{
    id: string;
    action: string;
    message: string;
    commit_sha: string | null;
    pull_request_url: string | null;
    created_at: number;
  }>;
  return rows.map((event) => ({
    id: event.id,
    action: event.action,
    message: event.message,
    commitSha: event.commit_sha,
    pullRequestUrl: event.pull_request_url,
    createdAt: event.created_at,
  }));
}

export function recordPublication(
  deps: ArtifactsPublicationDeps,
  cardId: string,
  action: PublicationAction,
  message: string,
  commitSha: string | null = null,
  pullRequestUrl: string | null = null,
): void {
  deps.db.prepare(`
    INSERT INTO publication_events
      (id, card_id, action, message, commit_sha, pull_request_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    deps.randomId("pub"),
    cardId,
    action,
    message,
    commitSha,
    pullRequestUrl,
    deps.now(),
  );
}

async function availableSnapshot(
  deps: ArtifactsPublicationDeps,
  card: PublicationCard,
  events: PublicationSnapshot["events"],
): Promise<PublicationSnapshot> {
  if (deps.normalizeStatus(card.status) !== "completed") {
    return unavailablePublication("Only completed cards can publish changes.", events);
  }
  const checkout = await deps.cards.checkout(card).catch(() => null);
  if (!checkout?.environmentId || !checkout.environment) {
    return unavailablePublication(
      "Publishing is available only while this card has a live BB workspace environment.",
      events,
    );
  }
  const [status, pullRequest] = await Promise.all([
    deps.bb.sdk.environments.status({ environmentId: checkout.environmentId }).catch(() => null),
    deps.bb.sdk.environments.pullRequest({ environmentId: checkout.environmentId })
      .catch(() => ({ outcome: "unavailable" as const, message: "BB could not read pull-request status." })),
  ]);
  if (!status || status.outcome !== "available") {
    const message = status?.outcome === "not_applicable"
      ? status.message
      : status?.failure?.message ?? "BB could not inspect this workspace.";
    return unavailablePublication(message, events);
  }
  return projectSnapshot(
    checkout.source,
    checkout.environmentId,
    Boolean(checkout.environment.isWorktree),
    status,
    pullRequest,
    events,
  );
}

function projectSnapshot(
  source: string,
  environmentId: string,
  isWorktree: boolean,
  status: Extract<EnvironmentStatus, { outcome: "available" }>,
  pullRequest: PullRequestStatus,
  events: PublicationSnapshot["events"],
): PublicationSnapshot {
  const blocker = publicationBlocker(status);
  const capability = ({ ok, reason }: { ok: boolean; reason: string | null }) => ({ available: ok, reason });
  const pr = pullRequest.outcome === "available" && "pullRequest" in pullRequest
    ? pullRequest.pullRequest
    : null;
  const checkout = status.workspace.checkout;
  return {
    available: blocker === null,
    message: blocker,
    source,
    environmentId,
    isWorktree,
    branch: {
      current: status.workspace.branch.currentBranch,
      default: status.workspace.branch.defaultBranch,
      headSha: checkout.kind === "branch" || checkout.kind === "detached" ? checkout.headSha : null,
    },
    workingTree: {
      state: status.workspace.workingTree.state,
      hasUncommittedChanges: status.workspace.workingTree.hasUncommittedChanges,
      files: status.workspace.workingTree.files.length,
    },
    mergeBase: status.workspace.mergeBase ? {
      branch: status.workspace.mergeBase.mergeBaseBranch,
      ahead: status.workspace.mergeBase.aheadCount,
      behind: status.workspace.mergeBase.behindCount,
      hasCommittedUnmergedChanges: status.workspace.mergeBase.hasCommittedUnmergedChanges,
    } : null,
    pullRequest: pr ? {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      state: pr.state,
      attention: pr.attention,
      review: pr.review.state,
      checks: pr.checks.state,
      mergeability: pr.mergeability.state,
    } : null,
    pullRequestMessage: pullRequest.outcome === "unavailable" && "message" in pullRequest
      ? pullRequest.message
      : null,
    capabilities: {
      commit: capability(canCommitPublication(status)),
      squashMerge: capability(canSquashMerge(status)),
      markReady: capability(canMarkPullRequestReady(status, pullRequest)),
      markDraft: capability(canMarkPullRequestDraft(status, pullRequest)),
      mergePullRequest: capability(canMergePullRequest(status, pullRequest)),
    },
    events,
  };
}

export async function publicationSnapshot(
  deps: ArtifactsPublicationDeps,
  card: PublicationCard,
): Promise<PublicationSnapshot> {
  return availableSnapshot(deps, card, publicationEvents(deps, card.id));
}

export async function preparedEnvironment(
  deps: ArtifactsPublicationDeps,
  cardId: string,
): Promise<PreparedEnvironment> {
  const card = deps.cards.get(cardId);
  if (!card) return { error: deps.cardNotFound };
  const snapshot = await publicationSnapshot(deps, card);
  if (!snapshot.environmentId) return { error: snapshot.message ?? "Publishing is unavailable." };
  return { card, environmentId: snapshot.environmentId, snapshot };
}

// Policy only: BB owns Git/forge execution. Keeping these decisions pure makes
// the panel and the server agree about what is safe to offer.

export function publicationBlocker(status) {
  if (!status || status.outcome !== "available") {
    return status?.outcome === "not_applicable"
      ? "This workspace is not a Git repository."
      : status?.failure?.message ?? "This workspace is unavailable on its host.";
  }
  const { checkout, branch } = status.workspace;
  if (checkout.kind !== "branch" || !checkout.branchName) return "Publishing requires a checked-out branch.";
  if (checkout.branchName === branch.defaultBranch) return `Publishing from ${branch.defaultBranch} is blocked. Use a feature branch or a managed worktree.`;
  return null;
}

export function canCommitPublication(status) {
  const blocker = publicationBlocker(status);
  if (blocker) return { ok: false, reason: blocker };
  return status.workspace.workingTree.hasUncommittedChanges
    ? { ok: true, reason: null }
    : { ok: false, reason: "The working tree is clean — there is nothing to commit." };
}

export function canSquashMerge(status) {
  const blocker = publicationBlocker(status);
  if (blocker) return { ok: false, reason: blocker };
  const base = status.workspace.mergeBase;
  if (!base?.hasCommittedUnmergedChanges) return { ok: false, reason: "There are no committed branch changes to squash into the base branch." };
  if (status.workspace.workingTree.hasUncommittedChanges) return { ok: false, reason: "Commit or discard working-tree changes before a local squash merge." };
  return { ok: true, reason: null };
}

function pullRequestBlocker(status, pullRequest) {
  const blocker = publicationBlocker(status);
  if (blocker) return blocker;
  if (!pullRequest || pullRequest.outcome !== "available") {
    return pullRequest?.outcome === "absent" ? "There is no pull request for this branch." : pullRequest?.message ?? "Pull-request status is unavailable.";
  }
  return null;
}

export function canMarkPullRequestReady(status, pullRequest) {
  const blocker = pullRequestBlocker(status, pullRequest);
  if (blocker) return { ok: false, reason: blocker };
  const pr = pullRequest.pullRequest;
  if (pr.state === "draft") return { ok: true, reason: null };
  if (pr.state === "open") return { ok: false, reason: "This pull request is already ready for review." };
  return { ok: false, reason: `This pull request is ${pr.state}.` };
}

export function canMarkPullRequestDraft(status, pullRequest) {
  const blocker = pullRequestBlocker(status, pullRequest);
  if (blocker) return { ok: false, reason: blocker };
  const pr = pullRequest.pullRequest;
  if (pr.state === "open") return { ok: true, reason: null };
  if (pr.state === "draft") return { ok: false, reason: "This pull request is already a draft." };
  return { ok: false, reason: `This pull request is ${pr.state}.` };
}

export function canMergePullRequest(status, pullRequest) {
  const blocker = pullRequestBlocker(status, pullRequest);
  if (blocker) return { ok: false, reason: blocker };
  const pr = pullRequest.pullRequest;
  if (pr.state !== "open") return { ok: false, reason: `This pull request is ${pr.state}.` };
  if (pr.review.state !== "approved") return { ok: false, reason: "An approving review is still required." };
  if (pr.checks.state !== "passing") return { ok: false, reason: "Required checks are not passing." };
  if (pr.mergeability.state !== "mergeable") return { ok: false, reason: "GitHub has not confirmed that this pull request is mergeable." };
  return { ok: true, reason: null };
}

export function publicationSource(environment) {
  if (!environment) return "Project source";
  if (environment.isWorktree || environment.workspaceProvisionType === "managed-worktree") {
    return environment.branchName ? `Worker worktree · ${environment.branchName}` : "Worker worktree";
  }
  return "Worker checkout";
}

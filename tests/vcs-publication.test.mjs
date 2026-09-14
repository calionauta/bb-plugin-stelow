import assert from "node:assert/strict";
import { canCommitPublication, canMarkPullRequestDraft, canMarkPullRequestReady, canMergePullRequest, canSquashMerge, isDefaultBranchCheckout, publicationBlocker } from "../lib/vcs-publication.mjs";

const available = (overrides = {}) => ({
  outcome: "available",
  workspace: {
    branch: { currentBranch: "feature/card", defaultBranch: "main" },
    checkout: { kind: "branch", branchName: "feature/card", headSha: "abc" },
    workingTree: { hasUncommittedChanges: true },
    mergeBase: { hasCommittedUnmergedChanges: true },
    ...overrides,
  },
});

assert.equal(publicationBlocker(available()), null);
assert.deepEqual(canCommitPublication(available()), { ok: true, reason: null });
const defaultBranch = available({ branch: { currentBranch: "main", defaultBranch: "main" }, checkout: { kind: "branch", branchName: "main" } });
assert.equal(publicationBlocker(defaultBranch), null, "a BB-selected default checkout is publishable after explicit confirmation");
assert.equal(isDefaultBranchCheckout(defaultBranch), true);
assert.deepEqual(canCommitPublication(defaultBranch), { ok: true, reason: null });
assert.deepEqual(canSquashMerge(defaultBranch), { ok: false, reason: "This checkout is already on the default branch. Save its local commit instead." });
assert.match(publicationBlocker(available({ checkout: { kind: "detached" } })), /checked-out branch/);
assert.deepEqual(canCommitPublication(available({ workingTree: { hasUncommittedChanges: false } })), { ok: false, reason: "The working tree is clean — there is nothing to commit." });
assert.deepEqual(canSquashMerge(available({ workingTree: { hasUncommittedChanges: false } })), { ok: true, reason: null });
assert.deepEqual(canSquashMerge(available({ workingTree: { hasUncommittedChanges: true } })), { ok: false, reason: "Commit or discard working-tree changes before a local squash merge." });

const readyPr = { outcome: "available", pullRequest: { state: "open", review: { state: "approved" }, checks: { state: "passing" }, mergeability: { state: "mergeable" } } };
assert.deepEqual(canMarkPullRequestReady(available(), { ...readyPr, pullRequest: { ...readyPr.pullRequest, state: "draft" } }), { ok: true, reason: null });
assert.match(canMarkPullRequestReady(available(), readyPr).reason, /already ready/);
assert.deepEqual(canMarkPullRequestDraft(available(), readyPr), { ok: true, reason: null });
assert.match(canMarkPullRequestDraft(available(), { ...readyPr, pullRequest: { ...readyPr.pullRequest, state: "draft" } }).reason, /already a draft/);
assert.deepEqual(canMergePullRequest(available(), readyPr), { ok: true, reason: null });
assert.match(canMergePullRequest(available(), { ...readyPr, pullRequest: { ...readyPr.pullRequest, checks: { state: "pending" } } }).reason, /not passing/);
assert.match(canMergePullRequest(available(), { outcome: "absent" }).reason, /no pull request/);
assert.match(canMarkPullRequestDraft(defaultBranch, readyPr).reason, /feature branch/);

console.log("vcs publication policy ok");

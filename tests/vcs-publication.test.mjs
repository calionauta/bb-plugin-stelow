import assert from "node:assert/strict";
import { canCommitPublication, canMergePullRequest, canSquashMerge, publicationBlocker } from "../lib/vcs-publication.mjs";

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
assert.match(publicationBlocker(available({ branch: { currentBranch: "main", defaultBranch: "main" }, checkout: { kind: "branch", branchName: "main" } })), /blocked/);
assert.match(publicationBlocker(available({ checkout: { kind: "detached" } })), /checked-out branch/);
assert.deepEqual(canCommitPublication(available({ workingTree: { hasUncommittedChanges: false } })), { ok: false, reason: "The working tree is clean — there is nothing to commit." });
assert.deepEqual(canSquashMerge(available({ workingTree: { hasUncommittedChanges: false } })), { ok: true, reason: null });
assert.deepEqual(canSquashMerge(available({ workingTree: { hasUncommittedChanges: true } })), { ok: false, reason: "Commit or discard working-tree changes before a local squash merge." });

const readyPr = { outcome: "available", pullRequest: { state: "open", review: { state: "approved" }, checks: { state: "passing" }, mergeability: { state: "mergeable" } } };
assert.deepEqual(canMergePullRequest(readyPr), { ok: true, reason: null });
assert.match(canMergePullRequest({ ...readyPr, pullRequest: { ...readyPr.pullRequest, checks: { state: "pending" } } }).reason, /not passing/);
assert.match(canMergePullRequest({ outcome: "absent" }).reason, /no pull request/);

console.log("vcs publication policy ok");

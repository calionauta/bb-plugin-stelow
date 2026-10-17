import assert from "node:assert/strict";
import {
  canCommitPublication,
  canMarkPullRequestDraft,
  canMarkPullRequestReady,
  canMergePullRequest,
  canSquashMerge,
  publicationBlocker,
} from "../lib/vcs-publication.mjs";
import {
  commitFileState,
  formatAffectedTests,
  formatChangedSymbols,
  formatEntitySummary,
  formatQualityGate,
  formatTestGate,
  shouldShowBuildDiff,
} from "../lib/build-diff-presentation.mjs";

// Publication wiring: BB owns writes, Done stays separate, actions are
// explicit and auditable. Behavioral coverage goes through the lib policies
// the handlers delegate to.

function availableStatus(overrides = {}) {
  return {
    outcome: "available",
    workspace: {
      checkout: { kind: "branch", branchName: "feature/x" },
      branch: { defaultBranch: "main" },
      mergeBase: { hasCommittedUnmergedChanges: true },
      workingTree: { hasUncommittedChanges: true },
    },
    ...overrides,
  };
}

function prAvailable(state, overrides = {}) {
  return { outcome: "available", pullRequest: { state }, ...overrides };
}

// Preflight: every mutating action runs a fresh preflight first — a blocked
// workspace refuses with the reason named instead of failing mid-write.
assert.equal(publicationBlocker(availableStatus()), null, "a branched checkout with changes has no blocker");
assert.match(
  publicationBlocker({ outcome: "not_applicable" }),
  /not a Git repository/,
  "non-repositories refuse with the reason named",
);
assert.match(
  publicationBlocker(availableStatus({
    workspace: {
      checkout: { kind: "detached" },
      branch: { defaultBranch: "main" },
      mergeBase: {},
      workingTree: { hasUncommittedChanges: true },
    },
  })),
  /checked-out branch/,
  "detached checkouts refuse",
);

// Commit and squash share the workspace safety policy: dirty trees commit,
// clean trees refuse, squash needs committed branch changes on a feature branch.
assert.equal(canCommitPublication(availableStatus()).ok, true, "dirty trees commit");
assert.equal(
  canCommitPublication(availableStatus({
    workspace: {
      checkout: { kind: "branch", branchName: "feature/x" },
      branch: { defaultBranch: "main" },
      mergeBase: { hasCommittedUnmergedChanges: true },
      workingTree: { hasUncommittedChanges: false },
    },
  })).ok,
  false,
  "clean trees refuse with nothing-to-commit",
);
assert.equal(
  canSquashMerge(availableStatus({
    workspace: {
      checkout: { kind: "branch", branchName: "feature/x" },
      branch: { defaultBranch: "main" },
      mergeBase: { hasCommittedUnmergedChanges: true },
      workingTree: { hasUncommittedChanges: false },
    },
  })).ok,
  true,
  "a clean feature branch with unmerged commits squash-merges",
);

// PR transitions resolve to one contextual action from PR state: ready
// moves drafts to open, draft moves open back, merge stays explicit.
const ready = canMarkPullRequestReady(availableStatus(), prAvailable("draft"));
assert.equal(ready.ok, true, "drafts transition to ready");
assert.equal(canMarkPullRequestReady(availableStatus(), prAvailable("open")).ok, false, "open PRs refuse a redundant ready");
const draft = canMarkPullRequestDraft(availableStatus(), prAvailable("open"));
assert.equal(draft.ok, true, "open PRs transition back to draft");
assert.equal(canMarkPullRequestDraft(availableStatus(), prAvailable("draft")).ok, false, "drafts refuse a redundant draft");
assert.equal(
  canMergePullRequest(availableStatus(), prAvailable("open", {
    pullRequest: {
      state: "open",
      review: { state: "approved" },
      checks: { state: "passing" },
      mergeability: { state: "mergeable" },
    },
  })).ok,
  true,
  "mergeable PRs merge",
);

// Diff feature: working-tree review renders the entity summary, caller
// impact, and test obligations returned by presentation logic.
assert.equal(formatEntitySummary(null), null, "empty summaries render nothing");
assert.ok(
  (formatEntitySummary({ total: 2, added: 1, modified: 1, deleted: 0, renamed: 0, moved: 0 }) ?? "").includes("added"),
  "entity summaries name what changed",
);
assert.ok(
  (formatChangedSymbols([{ symbol: "f()", callers: 2, testCallers: 1 }]) ?? "").includes("f()"),
  "changed-symbol caller impact renders",
);
assert.ok(
  (formatAffectedTests([{ name: "renders", file: "tests/a.test.mjs" }]) ?? "").includes("tests/a.test.mjs"),
  "affected tests render the files to run first",
);
assert.ok(
  (formatTestGate({ obligations: true, testsToRun: ["tests/a.test.mjs"], untested: 0 }) ?? "").includes("tests/a.test.mjs"),
  "pending test obligations render instead of vanishing",
);
assert.ok(
  (formatQualityGate({ blocked: false }) ?? "").includes("no new regressions"),
  "the quality gate verdict renders",
);
assert.equal(commitFileState({ binary: true }), " · binary", "binaries label without a patch");
assert.equal(commitFileState({ patch: null, loadMode: "too_large" }), " · too large", "oversized files name their limit");
assert.equal(commitFileState({ patch: "diff" }), "", "patched files carry no suffix");

// Visibility: the Diff feature stays lazy and stage-aware — Done cards
// anchor dirt to their verified HEAD through the same rule the panel reads.
assert.equal(shouldShowBuildDiff({ status: "in-progress", stage: "diff-gate" }), true, "diff-gate shows the diff");
assert.equal(shouldShowBuildDiff({ status: "in-progress", stage: "plan" }), false, "plan hides the diff");
assert.equal(
  shouldShowBuildDiff({ status: "completed", stage: "done", publicationDirty: true }),
  true,
  "dirty Done cards surface their dirt",
);

console.log("publication wiring test ok: BB owns writes, Done stays separate, actions are explicit and auditable");

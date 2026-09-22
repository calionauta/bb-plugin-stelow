import assert from "node:assert/strict";
import { SHARED_BRANCH_PATTERN, discardConfirm, discardEligibility, discardTrail, previewFileSample, cleanupEligibility, cleanupConfirm, cleanupTrail } from "../lib/discard-policy.mjs";

const base = {
  status: "in-progress",
  workspaceKind: "project",
  checkoutPath: "/repo",
  dirExists: true,
  isGit: true,
  branch: "bb/card-x",
  hasUpstream: false,
  upstreamRef: null,
  changed: ["a.ts"],
  untracked: ["b.ts"],
  unpushedCommits: 2,
  resetTarget: "abc123def456789",
  linkedWorktree: false,
  sharedWith: 0,
};

// Happy paths, one per action.
assert.deepEqual(
  discardEligibility(base).action,
  "branch-reset",
  "unpushed feature branch resets",
);
assert.equal(
  discardEligibility({ ...base, linkedWorktree: true }).action,
  "worktree-drop",
  "linked worktree drops whole",
);
assert.equal(
  discardEligibility({ status: "archived", workspaceKind: "exploratory", checkoutPath: "/tmp/x", dirExists: true }).action,
  "dir-delete",
  "archived leftovers still clean",
);

// Refusals name the exit.
assert.match(discardEligibility({ ...base, status: "completed" }).reason ?? "", /history/, "completed work refuses");
assert.match(discardEligibility({ ...base, status: "blocked" }).reason ?? "", /history/, "blocked work refuses");
assert.match(discardEligibility({ ...base, checkoutPath: null }).reason ?? "", /no workspace checkout/, "missing checkout refuses");
assert.match(discardEligibility({ ...base, workspaceKind: "exploratory", dirExists: false }).reason ?? "", /already gone/, "missing dir refuses");
assert.match(discardEligibility({ ...base, isGit: false }).reason ?? "", /not a git repository/, "non-git refuses");
assert.match(discardEligibility({ ...base, branch: null }).reason ?? "", /detached HEAD/, "detached HEAD refuses");
for (const shared of ["main", "master", "develop", "staging", "production", "release/v1"]) {
  assert.ok(SHARED_BRANCH_PATTERN.test(shared), `${shared} counts as shared`);
  assert.match(discardEligibility({ ...base, branch: shared }).reason ?? "", /shared line/, `${shared} refuses`);
}
assert.ok(!SHARED_BRANCH_PATTERN.test("bb/card-x"), "card branches pass the name guard");
assert.match(
  discardEligibility({ ...base, hasUpstream: true, upstreamRef: "origin/bb/card-x" }).reason ?? "",
  /pushed history.*origin\/bb\/card-x/,
  "pushed branch refuses with the remote named",
);
assert.match(
  discardEligibility({ ...base, changed: [], untracked: [], unpushedCommits: 0 }).reason ?? "",
  /clean/,
  "clean checkout refuses",
);
assert.match(
  discardEligibility({ ...base, changed: [], untracked: [], unpushedCommits: 0, linkedWorktree: true }).reason ?? "",
  /clean/,
  "clean worktree refuses before dropping",
);
assert.match(discardEligibility({ ...base, resetTarget: null }).reason ?? "", /safe reset point/, "unknown reset target refuses");

// Confirm copy states the blast radius per action.
const reset = discardConfirm(base, "branch-reset");
assert.equal(reset.title, "Discard unpushed work on bb/card-x?", "reset title names the branch");
assert.match(reset.body, /stops the worker/, "reset body names the stop");
assert.match(reset.body, /abc123def456/, "reset body names the target");
assert.match(reset.body, /archives the card/, "reset body names the archive");
assert.match(reset.body, /cannot be undone/, "reset body states irreversibility");
const shared = discardConfirm({ ...base, sharedWith: 2 }, "branch-reset");
assert.match(shared.body, /2 other live cards work in this project/, "shared project warns");
const sharedFolder = discardConfirm({ ...base, workspaceKind: "exploratory", checkoutPath: "/tmp/x", sharedWith: 1 }, "dir-delete");
assert.match(sharedFolder.body, /1 other live card shares this folder/, "shared folder warns exactly");
const dropped = discardConfirm({ ...base, linkedWorktree: true }, "worktree-drop");
assert.match(dropped.title, /Discard the bb\/card-x worktree/, "drop title names the worktree");
assert.match(dropped.body, /main checkout is untouched/, "drop body names what survives");
const removed = discardConfirm({ ...base, workspaceKind: "exploratory", checkoutPath: "/tmp/x" }, "dir-delete");
assert.match(removed.body, /deletes \/tmp\/x/, "dir delete names the path");

// File sample caps the list; the trail records the outcome.
assert.equal(previewFileSample(["a"], ["b"]), "a, b", "short lists print whole");
assert.equal(previewFileSample(["a"], ["b"], 1), "a and 1 more", "cap is honored");
assert.equal(
  previewFileSample(Array.from({ length: 10 }, (_, i) => `f${i}.ts`), []),
  "f0.ts, f1.ts, f2.ts, f3.ts, f4.ts, f5.ts, f6.ts, f7.ts and 2 more",
  "long lists cap at eight",
);
assert.match(discardTrail("branch-reset", base), /Reset bb\/card-x to abc123def456/, "trail records the reset");
assert.match(discardTrail("branch-reset", base), /\[a\.ts, b\.ts\]/, "trail carries the file list");
assert.match(discardTrail("worktree-drop", base), /Discarded the bb\/card-x worktree/, "trail records the drop");
const stashed = discardConfirm({ ...base, stashCount: 2 }, "branch-reset");
assert.match(stashed.body, /2 stash entries are left untouched/, "stashes are named, never dropped");

// Post-merge cleanup: same evidence, no archive. Completed cards are
// welcome (that's the point); shared branches, missing checkouts, and
// shared rooms refuse with the reason.
assert.deepEqual(cleanupEligibility({ ...base, status: "completed", linkedWorktree: true }).eligible, true, "completed cards clean up");
assert.match(cleanupEligibility({ checkoutPath: null }).reason ?? "", /no workspace checkout/, "missing checkouts refuse");
assert.match(cleanupEligibility({ ...base, workspaceKind: "exploratory" }).reason ?? "", /workspace recovery/, "exploratory stays out");
assert.match(cleanupEligibility({ ...base, branch: "main" }).reason ?? "", /no worktree to remove/, "shared branches refuse");
assert.match(cleanupEligibility({ ...base, linkedWorktree: false }).reason ?? "", /No linked worktree/, "non-worktrees refuse");
assert.match(cleanupEligibility({ ...base, linkedWorktree: true, sharedWith: 2 }).reason ?? "", /2 other live cards/, "shared rooms refuse");
assert.deepEqual(cleanupEligibility(null).eligible, false, "junk refuses");
const copy = cleanupConfirm({ ...base, unpushedCommits: 1, changed: ["a.ts"], untracked: [] });
assert.match(copy.title, /Remove the bb\/card-x worktree\?/, "confirm names the worktree");
assert.match(copy.body, /separate copy/, "benefit first");
assert.match(copy.body, /1 unpushed commit and 1 changed file/, "blast radius second");
assert.match(copy.body, /merged or pushed first/, "unpushed work warns explicitly");
assert.doesNotMatch(copy.body, /archives the card/, "no archive language leaks in");
assert.match(cleanupTrail(base), /Removed the bb\/card-x worktree.*Card kept as record/, "trail keeps the card");

console.log("discard policy test ok: eligibility matrix, per-action confirm copy, trail");

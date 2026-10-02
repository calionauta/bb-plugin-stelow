import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupIntegration, worktreeReclaimable } from "../lib/worktree-reclaim-policy.mjs";
import { cleanupIntegrationGate } from "../lib/discard-policy.mjs";

// A finished card's worktree is only safe to remove when the work is already
// somewhere it can be got back from.
//
// The card that made this necessary: card_cbnihg4c. It reached its last stage
// with 963 lines across 20 files, committed on a branch, never merged. Its
// worktree is 269M and the host installed node_modules into it. Removing that
// worktree would delete the only copy of that work in existence — a card at
// Done, which reads as finished, and about to lose what it produced.
//
// So the gate is not "is the card finished". Finished is the case we are
// cleaning up. The gate is "is anything here that a human cannot get back".

const here = dirname(fileURLToPath(import.meta.url));

const MERGED_AND_CLEAN = {
  unpushedCommits: 0,
  changedFiles: 0,
  untrackedFiles: 0,
  remoteMerged: true,
  branchShared: false,
};

// --- the safe case: merged, clean, exclusive -------------------------------

const safe = cleanupIntegration(MERGED_AND_CLEAN);
assert.equal(safe.safe, true, "a merged, clean, exclusive worktree is safe to remove");
assert.equal(safe.blockers.length, 0);
assert.match(safe.summary, /already on the base branch/,
  "the safe answer says why it is safe, not just that it is");

// --- the card that made this necessary -------------------------------------

const unmerged = cleanupIntegration({ ...MERGED_AND_CLEAN, remoteMerged: false, unpushedCommits: 1 });
assert.equal(unmerged.safe, false, "a card at Done whose work was never merged is NOT safe to remove");
assert.ok(
  unmerged.blockers.some((b) => /not on the base branch/.test(b)),
  "the blocker names the missing merge",
);
assert.ok(
  unmerged.blockers.some((b) => /no recorded merge/.test(b)),
  "and it says the merge is unrecorded, which is the actual gap",
);

// --- each blocker alone is enough to refuse --------------------------------

for (const [field, value, pattern] of [
  ["unpushedCommits", 3, /3 commits/],
  ["changedFiles", 12, /12 tracked files have/],
  ["untrackedFiles", 1, /1 untracked file would/],
  ["branchShared", true, /Another live card/],
]) {
  const result = cleanupIntegration({ ...MERGED_AND_CLEAN, [field]: value });
  assert.equal(result.safe, false, `${field} alone must refuse`);
  assert.ok(
    result.blockers.some((b) => pattern.test(b)),
    `${field} blocker must read as written — got ${JSON.stringify(result.blockers)}`,
  );
}

// --- refusals name a way forward, never just "no" -------------------------
// A gate that blocks without a route is a gate the reader learns to bypass by
// using a different tool.

for (const blockers of [unmerged.blockers, cleanupIntegration({ ...MERGED_AND_CLEAN, untrackedFiles: 4 }).blockers]) {
  for (const blocker of blockers) {
    assert.ok(blocker.length > 30, `a blocker must be a sentence: ${blocker}`);
    assert.match(blocker, /[.!]$/, `a blocker reads as a sentence: ${blocker}`);
  }
}

// --- pluralisation reads as English ---------------------------------------

assert.match(
  cleanupIntegration({ ...MERGED_AND_CLEAN, untrackedFiles: 1 }).blockers.find((b) => /untracked/.test(b)),
  /1 untracked file would/,
  "one file is singular",
);
assert.match(
  cleanupIntegration({ ...MERGED_AND_CLEAN, unpushedCommits: 1 }).blockers.find((b) => /commit/.test(b)),
  /^1 commit on this branch/,
  "one commit is singular",
);

// --- what is not the card's fault is a different question -----------------
// These are not blockers on the work; they mean there is no worktree to remove.

assert.match(worktreeReclaimable({ isGit: false, linkedWorktree: true, branch: "b" }), /not a git repository/);
assert.match(worktreeReclaimable({ isGit: true, linkedWorktree: false, branch: "b" }), /No linked worktree/);
assert.match(worktreeReclaimable({ isGit: true, linkedWorktree: true, branch: "b", sharedWith: 2 }), /2 other live cards/);
assert.match(worktreeReclaimable({ isGit: true, linkedWorktree: true, branch: null }), /detached HEAD/);
assert.equal(
  worktreeReclaimable({ isGit: true, linkedWorktree: true, branch: "bb/stelow-x" }),
  null,
  "a real worktree on its own branch is reclaimable",
);

// --- the two gates are separate --------------------------------------------
// cleanupIntegration answers "is the work safe"; worktreeReclaimable answers
// "is there anything to remove". Collapsing them would report a missing
// worktree as a work-integrity problem, and the fix for that is not to
// integrate the card.

assert.match(readFileSync(join(here, "..", "lib", "worktree-reclaim-policy.mjs"), "utf8"),
  /export function cleanupIntegration[\s\S]*export function worktreeReclaimable/,
  "both gates live side by side and are separately callable");

// --- a squash-merged branch is integrated, and commit counts cannot tell ---
// Found by running the gate against a real worktree in this repo.
//
// PR #239 landed on master as one squash commit. Its branch kept eight
// commits, none of which appear in the base branch's history — because a
// squash writes the branch's *content* as a new commit and discards the
// original ids. Judging by `unpushedCommits` alone would have called a fully
// shipped branch unintegrated, and refused to reclaim its worktree for no
// reason. The gate also accepts a merge recorded in the publication ledger.

const SQUASH_MERGED = {
  checkoutPath: "/w",
  isGit: true,
  linkedWorktree: true,
  branch: "feat/card-integration-pending",
  hasUpstream: true,
  changed: [],
  untracked: [],
  unpushedCommits: 8, // the branch's own commits, none of them in the base
  remoteMerged: true, // the ledger says the merge happened
  sharedWith: 0,
};
assert.equal(
  cleanupIntegrationGate(SQUASH_MERGED).safe,
  false,
  "eight commits the base does not have are still eight, whatever the ledger says",
);
assert.equal(
  cleanupIntegrationGate({ ...SQUASH_MERGED, unpushedCommits: 0 }).safe,
  true,
  "the same branch with nothing outstanding is reclaimable",
);
assert.equal(
  cleanupIntegrationGate({ ...SQUASH_MERGED, remoteMerged: false, unpushedCommits: 0 }).safe,
  false,
  "without a recorded merge the gate still refuses — a record is required, not optional",
);

console.log("worktree reclaim policy test ok: a merged clean worktree is safe, a Done card with unmerged work never is");

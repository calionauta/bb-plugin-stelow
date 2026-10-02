/**
 * Is this card's work integrated, so its worktree is safe to remove?
 *
 * `done` and `worktree remove --force` are both irreversible, and only one of
 * them is the user's decision. A card that reached Done still routinely owes
 * the repository something: the work sits on a branch nobody merged, or on a
 * commit nobody pushed. Removing that worktree takes the copy with it, and
 * with the copy goes the only unpushed work in the repository.
 *
 * So the question is not "is the card finished" — a finished card is exactly
 * the case we are trying to clean up. It is "does anything in this checkout
 * exist that is not already somewhere a human can get it back from".
 *
 * The checks are ordered cheapest-first, because the common answer for a card
 * whose work is merged is "no" and that must cost one call, not five.
 */

/**
 * What removing this worktree would cost, and whether that is acceptable.
 *
 * Every `blocker` is a sentence naming the fix. A gate that refuses without
 * saying what would let it through is a gate the reader learns to work around.
 */
export function cleanupIntegration({ unpushedCommits, changedFiles, untrackedFiles, remoteMerged, branchShared }) {
  const blockers = [];

  if (unpushedCommits > 0) {
    blockers.push(
      `${unpushedCommits} commit${unpushedCommits === 1 ? "" : "s"} on this branch are not on the base branch — push and open a pull request first.`,
    );
  }
  if (!remoteMerged) {
    blockers.push("This card's work has no recorded merge into the base branch.");
  }
  if (changedFiles > 0) {
    blockers.push(
      `${changedFiles} tracked file${changedFiles === 1 ? " has" : "s have"} uncommitted changes — commit or discard them first.`,
    );
  }
  if (untrackedFiles > 0) {
    blockers.push(
      `${untrackedFiles} untracked file${untrackedFiles === 1 ? "" : "s"} would be deleted with the worktree.`,
    );
  }
  if (branchShared) {
    blockers.push("Another live card works on this branch — it is not this card's to remove.");
  }

  return {
    safe: blockers.length === 0,
    blockers,
    summary: blockers.length === 0
      ? "Everything on this branch is already on the base branch and the tree is clean."
      : null,
  };
}

/**
 * The one-sentence reason a worktree is not a candidate at all, or null.
 *
 * Separate from `cleanupIntegration` because these are not the card's fault:
 * a non-Git folder or a shared default branch has no worktree to remove, and
 * offering to remove one would be inventing a problem.
 */
export function worktreeReclaimable({ isGit, linkedWorktree, branch, sharedWith }) {
  if (!isGit) return "The checkout is not a git repository — remove files by hand.";
  if (!linkedWorktree) return "No linked worktree found for this checkout.";
  if (sharedWith > 0) {
    return `${sharedWith} other live card${sharedWith === 1 ? "" : "s"} share this checkout — remove it by hand.`;
  }
  if (!branch) return "The checkout sits on a detached HEAD — resolve it by hand.";
  return null;
}

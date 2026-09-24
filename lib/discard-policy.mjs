/**
 * Discard policy: can a card's unpushed work be destroyed safely, and what
 * exactly happens next? Archive parks (work preserved, worker stopped);
 * discard destroys unpushed work, then archives. Pure decision + copy (no
 * git, no DB) so the matrix is exercised in node tests following the
 * worker-action-policy precedent. The server gathers evidence, executes,
 * and re-validates everything (TOCTOU) before touching the checkout.
 */

export const SHARED_BRANCH_PATTERN = /^(main|master|develop|staging|production|release\/.+)$/;
export const MAX_PREVIEW_FILES = 8;

/**
 * Evidence the server gathers per card (see discardEvidence in server.ts):
 * {
 *   status, workspaceKind: "project" | "exploratory",
 *   checkoutPath: string | null, dirExists: boolean,
 *   isGit: boolean, branch: string | null, hasUpstream: boolean,
 *   upstreamRef: string | null, changed: string[], untracked: string[],
 *   unpushedCommits: number, resetTarget: string | null,
 *   linkedWorktree: boolean, sharedWith: number,
 * }
 */
export function discardEligibility(evidence) {
  const ev = evidence ?? {};
  if (ev.status === "completed" || ev.status === "blocked") {
    return { eligible: false, action: null, reason: "Completed work is history — reset it by hand." };
  }
  if (!ev.checkoutPath) {
    return { eligible: false, action: null, reason: "This card has no workspace checkout to discard." };
  }
  if (ev.workspaceKind === "exploratory") {
    if (!ev.dirExists) {
      return { eligible: false, action: null, reason: "The exploratory folder is already gone — nothing to discard." };
    }
    return { eligible: true, action: "dir-delete", reason: null };
  }
  if (!ev.isGit) {
    return { eligible: false, action: null, reason: "The checkout is not a git repository — remove files by hand." };
  }
  if (!ev.branch) {
    return { eligible: false, action: null, reason: "The checkout sits on a detached HEAD — resolve it by hand." };
  }
  if (SHARED_BRANCH_PATTERN.test(ev.branch)) {
    return { eligible: false, action: null, reason: `The card works directly on ${ev.branch} — discarding would touch the shared line. Reset it by hand.` };
  }
  if (ev.hasUpstream) {
    const where = ev.upstreamRef ? ` (${ev.upstreamRef})` : "";
    return { eligible: false, action: null, reason: `The ${ev.branch} branch has pushed history${where}. Discarding stops at pushed work to protect shared history.` };
  }
  const dirty = [...(ev.changed ?? []), ...(ev.untracked ?? [])];
  if (dirty.length === 0 && (ev.unpushedCommits ?? 0) === 0) {
    return { eligible: false, action: null, reason: "The checkout is clean — nothing to discard." };
  }
  if (ev.linkedWorktree) {
    return { eligible: true, action: "worktree-drop", reason: null };
  }
  if (!ev.resetTarget) {
    return { eligible: false, action: null, reason: "No safe reset point could be determined — reset it by hand." };
  }
  return { eligible: true, action: "branch-reset", reason: null };
}

/** First N paths for the confirm copy; the count carries the rest. */
export function previewFileSample(changed, untracked, max = MAX_PREVIEW_FILES) {
  const all = [...(changed ?? []), ...(untracked ?? [])];
  const shown = all.slice(0, max);
  return all.length > shown.length ? `${shown.join(", ")} and ${all.length - shown.length} more` : shown.join(", ");
}

function sharedWarning(sharedWith, workspaceKind) {
  if (!(sharedWith > 0)) return "";
  const plural = sharedWith === 1 ? "" : "s";
  const verb = sharedWith === 1 ? "shares" : "share";
  // Project checkouts may be shared across cards (same project, one
  // worktree); exploratory folders are exact. Say only what is known.
  const scope = workspaceKind === "exploratory"
    ? `${verb} this folder — their uncommitted work is indistinguishable from this card's.`
    : `work in this project — their uncommitted work may live in the same checkout.`;
  return ` Warning: ${sharedWith} other live card${plural} ${scope}`;
}

/** Stash entries survive every discard action — name them so they are not forgotten. */
function stashNote(stashCount) {
  return stashCount > 0
    ? ` ${stashCount} stash entr${stashCount === 1 ? "y is" : "ies are"} left untouched.`
    : "";
}

/** Explicit confirm copy for an eligible discard (title + body, English). */
export function discardConfirm(evidence, action) {
  const ev = evidence ?? {};
  const dirty = [...(ev.changed ?? []), ...(ev.untracked ?? [])].length;
  const commits = ev.unpushedCommits ?? 0;
  const shared = sharedWarning(ev.sharedWith ?? 0, ev.workspaceKind);
  const stash = stashNote(ev.stashCount ?? 0);
  if (action === "worktree-drop") {
    return {
      title: `Discard the ${ev.branch} worktree?`,
      body: `This stops the worker, deletes the ${ev.branch} worktree (${ev.checkoutPath}) with ${commits} unpushed commit${commits === 1 ? "" : "s"} and ${dirty} changed file${dirty === 1 ? "" : "s"}, then archives the card. The main checkout is untouched.${shared}${stash} This cannot be undone.`,
    };
  }
  if (action === "dir-delete") {
    return {
      title: "Delete this card’s exploratory folder?",
      body: `This stops the worker, deletes ${ev.checkoutPath} (${dirty} file${dirty === 1 ? "" : "s"}), and archives the card.${shared}${stash} This cannot be undone.`,
    };
  }
  const sample = previewFileSample(ev.changed, ev.untracked);
  return {
    title: `Discard unpushed work on ${ev.branch}?`,
    body: `This stops the worker, resets ${ev.branch} to ${ev.resetTarget ? ev.resetTarget.slice(0, 12) : "its base"} (dropping ${commits} unpushed commit${commits === 1 ? "" : "s"} and ${dirty} changed file${dirty === 1 ? "" : "s"}${sample ? `: ${sample}` : ""}), then archives the card. Nothing pushed is touched — the branch has no upstream.${shared}${stash} This cannot be undone.`,
  };
}

/** One-line trail record plus the full file list, written as a card comment after a discard. */
export function discardTrail(action, evidence) {
  const ev = evidence ?? {};
  const dirty = [...(ev.changed ?? []), ...(ev.untracked ?? [])].length;
  const sample = previewFileSample(ev.changed, ev.untracked, 30);
  const files = sample ? ` [${sample}]` : "";
  if (action === "worktree-drop") return `Discarded the ${ev.branch} worktree (${ev.unpushedCommits ?? 0} commits, ${dirty} files${files}). Card archived.`;
  if (action === "dir-delete") return `Deleted the exploratory folder (${dirty} files${files}). Card archived.`;
  return `Reset ${ev.branch} to ${ev.resetTarget ? ev.resetTarget.slice(0, 12) : "its base"} (${ev.unpushedCommits ?? 0} commits, ${dirty} files dropped${files}). Card archived.`;
}

/**
 * Post-merge worktree cleanup (pure decision + copy, same evidence shape).
 * Unlike discard it never archives and never refuses completed cards — a
 * merged PR is exactly when the worktree becomes redundant. Dirty leftovers
 * and unpushed commits are shown, not auto-judged; removal still uses
 * --force behind an explicit confirm, and shared checkouts refuse.
 */
export function cleanupEligibility(evidence) {
  const ev = evidence ?? {};
  if (!ev.checkoutPath) {
    return { eligible: false, reason: "This card has no workspace checkout to clean up." };
  }
  if (ev.workspaceKind === "exploratory") {
    return { eligible: false, reason: "Exploratory folders are managed by workspace recovery, not worktree cleanup." };
  }
  if (!ev.isGit) {
    return { eligible: false, reason: "The checkout is not a git repository — remove files by hand." };
  }
  if (!ev.branch) {
    return { eligible: false, reason: "The checkout sits on a detached HEAD — resolve it by hand." };
  }
  if (SHARED_BRANCH_PATTERN.test(ev.branch)) {
    return { eligible: false, reason: `The card works directly on ${ev.branch} — there is no worktree to remove.` };
  }
  if (!ev.linkedWorktree) {
    return { eligible: false, reason: "No linked worktree found for this checkout." };
  }
  if ((ev.sharedWith ?? 0) > 0) {
    return { eligible: false, reason: `${ev.sharedWith} other live card${ev.sharedWith === 1 ? "" : "s"} share this checkout — remove it by hand.` };
  }
  return { eligible: true, reason: null };
}

/** Explicit confirm copy for worktree cleanup: benefit first, blast radius second. */
export function cleanupConfirm(evidence) {
  const ev = evidence ?? {};
  const dirty = [...(ev.changed ?? []), ...(ev.untracked ?? [])].length;
  const commits = ev.unpushedCommits ?? 0;
  const stash = stashNote(ev.stashCount ?? 0);
  return {
    title: `Remove the ${ev.branch} worktree?`,
    body: `Frees the separate copy this card worked in — your main checkout and the card record stay untouched. ` +
      `Deletes the ${ev.branch} worktree (${ev.checkoutPath}) with ${commits} unpushed commit${commits === 1 ? "" : "s"} and ${dirty} changed file${dirty === 1 ? "" : "s"}. ` +
      `Make sure anything worth keeping is merged or pushed first — this destroys unpushed work.${stash} This cannot be undone.`,
  };
}

/** One-line trail record for a cleanup, written as a card comment. */
export function cleanupTrail(evidence) {
  const ev = evidence ?? {};
  const dirty = [...(ev.changed ?? []), ...(ev.untracked ?? [])].length;
  const sample = previewFileSample(ev.changed, ev.untracked, 30);
  const files = sample ? ` [${sample}]` : "";
  return `Removed the ${ev.branch} worktree (${ev.unpushedCommits ?? 0} commits, ${dirty} files${files}). Card kept as record.`;
}

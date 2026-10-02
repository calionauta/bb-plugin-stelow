/**
 * Does a finished card still owe the repository something?
 *
 * `done` is a lifecycle state, not a publication state. A card can complete
 * with its work sitting uncommitted on a shared checkout, committed but never
 * pushed, or pushed as a pull request nobody merged — and the board read
 * "Done" for all three. Three cards reached Done in that state on this repo
 * and the work was only recovered by reading git history by hand.
 *
 * The signal answers one question for a reader scanning the board: is there
 * something still to land? It is deliberately a ladder of *recorded* facts,
 * never a live `git` call: the board lists every card, and a per-card git
 * invocation there would turn a scroll into a spawn.
 *
 * The ladder reads the `publication_events` ledger, which the publication
 * panel writes when the user acts. No event means the user never touched the
 * panel, which is itself the fact — not a gap in the data.
 */

/** The recorded publication facts a card has accumulated. */
function recordedActions(db, cardId) {
  return db.prepare(
    "SELECT action FROM publication_events WHERE card_id = ?",
  ).all(cardId).map((row) => String(row.action ?? ""));
}

/**
 * Does this action mean the work reached the base branch?
 *
 * `pull_request_merge` does. `squash_merge` is explicitly a *local* squash —
 * the panel offers it precisely because it cannot fetch or push — so counting
 * it as publication would re-open the exact hole this closes.
 *
 * `reconciled_integrated` does too, and it is the one action here the panel
 * does not write. The reconciler writes it when it has proved by content that
 * the base branch already carries this branch's files — the proof a squash
 * merge leaves and a commit id does not. It is the same proof the worktree
 * cleanup gate trusts, recorded so the cheap board read can see it.
 *
 * The rest are the panel's own `action` values, not a guess: `commit`,
 * `squash_merge`, `push_terminal`, `pull_request_ready`, `pull_request_draft`,
 * `pull_request_merge`.
 */
const PUBLISHES = new Set(["pull_request_merge", "reconciled_integrated"]);

/**
 * Is the work recorded as integrated for this card?
 *
 * One definition, asked by the board chip, by the reconciler that keeps it
 * honest, and by the worktree cleanup gate that deletes a directory. Two
 * copies of this rule are two answers to "is it safe to delete my work".
 */
export function hasRecordedIntegration(db, cardId) {
  try {
    return recordedActions(db, cardId).some((action) => PUBLISHES.has(action));
  } catch {
    // A missing ledger means "not proven integrated" — never a reason to delete.
    return false;
  }
}

/** Pushed to a remote. Remote-backed, but not yet on the base branch. */
const PUSHES = new Set(["push_terminal"]);

/**
 * The single pending-integration fact for a card, or null when nothing is
 * owed. Null is the overwhelmingly common case and must stay cheap to read.
 *
 * A card with no repository cannot owe the repository anything: an
 * exploratory workspace has no base branch to land on, so asking whether its
 * work was integrated is a question about nothing.
 */
export function integrationPending(db, card) {
  if (card.status !== "completed") return null;
  if (card.workspace_kind === "exploratory") return null;

  const actions = recordedActions(db, card.id);
  if (actions.length === 0) {
    return {
      state: "unpublished",
      label: "No commit recorded",
      detail:
        "No publication was ever recorded for this card, so the board cannot say whether its "
        + "work was committed, pushed or merged. Open the card to see what its workspace "
        + "actually holds.",
    };
  }
  if (actions.some((action) => PUBLISHES.has(action))) return null;

  const pullRequest = actions.some((action) => action.startsWith("pull_request_"));
  if (pullRequest) {
    return {
      state: "unmerged",
      label: "PR not merged",
      detail: "A pull request was opened for this card and has not been merged into the base branch.",
    };
  }
  if (actions.some((action) => PUSHES.has(action))) {
    return {
      state: "unmerged",
      label: "Pushed, not merged",
      detail: "This card's branch was pushed but no merge into the base branch is recorded.",
    };
  }
  return {
    state: "local",
    label: "Local commit only",
    detail: "This card was committed locally and never pushed or merged.",
  };
}

/**
 * The one-word form the board chip shows. Reads as a noun the reader can act
 * on, not a status the card already claims to have passed.
 */
export function integrationPendingLabel(card, integration) {
  return integration ? integration.label : null;
}

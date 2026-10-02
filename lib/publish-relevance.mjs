/**
 * Which publication actions make sense for this card, given what kind of work
 * it did.
 *
 * The panel decides what to offer from the git state alone: a clean tree, a
 * commit, a push. That is the wrong question for a card whose deliverable is
 * an answer. `card_1fgz8lge` investigated whether a skill showed a visual
 * representation, reached Done, and the panel offered it Commit, Push, Squash
 * and Merge PR — for a card whose entire output was prose in a thread
 * comment.
 *
 * A card's `kind` and `intent` are the facts the board already stores and the
 * panel already receives. Reading them costs nothing, and it is the only way
 * the panel can stop offering delivery machinery to work that needs none.
 *
 * What this deliberately does NOT do: decide how to publish. The BB SDK
 * exposes no create-branch, no push and no fetch — `environments` has commit,
 * status, diff, and pull-request actions and nothing else. "Create a branch"
 * is therefore not a button this plugin can add; it is a request for a host
 * capability. The rule below says what to hide, and the panel's existing
 * default-branch text already says what the user must do by hand.
 */

/**
 * Does this card produce work that belongs in the repository?
 *
 * An investigation produces a finding. A bugfix produces a change. The
 * distinction is the card's declared intent, not a guess from its output —
 * the same question asked as a build card and a research card gets different
 * answers, and the user chose the intent when they created the card.
 */
export function cardPublishesCode(kind, intent) {
  // Only build cards can change the repository. Research and explore are
  // read-only tracks by contract: their deliverable is a document.
  if (kind !== "build") return false;
  return intent !== "investigate";
}

/**
 * The publication actions this card's kind and intent can justify.
 *
 * Returned as a set so a caller renders whatever it has, and adding an
 * action later does not mean editing every branch that hides one.
 */
export function publishActionsFor(kind, intent) {
  if (cardPublishesCode(kind, intent)) {
    return new Set(["commit", "squash", "push", "sync", "pr"]);
  }
  // Commit stays available even for an investigation: a finding often comes
  // with the fix that came out of it, and that fix is real work. Push, squash
  // and merge do not — there is nothing here to integrate beyond the commit,
  // and offering them for a finding is what started this.
  return new Set(["commit"]);
}

/**
 * One sentence for a card whose deliverable is not code, saying why the
 * delivery buttons are absent. Null when the card publishes code, because a
 * card that can deliver needs no explanation of why it cannot.
 */
export function publishRelevanceNote(kind, intent) {
  if (cardPublishesCode(kind, intent)) return null;
  if (kind !== "build") {
    return [
      `${labelForKind(kind)} cards produce a document, not a change.`,
      "Commit is available if the work wrote files; push and merge are not.",
    ].join(" ");
  }
  return [
    "This card is an investigation: its deliverable is a finding.",
    "Commit is available if the work wrote files;",
    "push, squash and merge are not — there is nothing to integrate beyond the commit.",
  ].join(" ");
}

function labelForKind(kind) {
  return kind === "research" ? "Research" : "Exploration";
}

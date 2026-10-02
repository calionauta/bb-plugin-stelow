// The one sentence every surface refuses with when a card's state records and
// its state file disagree.
//
// The predicate lives beside the text on purpose. The failure they prevent is
// drift, and drift is invisible by construction: the sentence says "Reseed this
// card" while the button in the menu says "Restart fresh…", so the reader is
// told to use a door they cannot find — and the confirm dialog for that very
// button advises trying Retry first, which cannot help, because every command
// on an unowned card is refused until the records agree. EIGHT server sites
// refuse here and two components read the refusal; each site once held its own
// copy of the words, and three of them still did when a previous version of this
// comment claimed five. They read one constant now, and the two places that need
// to recognise the refusal read `isOwnershipRefusal` instead of matching a
// string they could have misspelled.
//
// The eight, verified by reading the sources (see the table in
// `tests/ownership-refusal.test.mjs`, which asserts the list and fails if a site
// re-spells the verdict inline): `workflow-state.ts` (the requireOwnedState
// card-worker guard), `worker-respawn-preparation.ts` (the Restart-worker path),
// `cli/cli-gap-scopes.ts` (the gap-scopes worker CLI), `build-thread-sync.ts`
// (the card's own last_error), `cli-inspection.ts` (the playbook CLI),
// `cli/cli-done-build.ts`, `card-mutations.ts` (the workflow-type mutation) and
// `card-audit-trail.ts`.
//
// What this module cannot do, and what the two files that pair with it have to
// do instead: prove the door opens. Asserting that this string CONTAINS "Restart
// fresh" proves only that a string contains some words — it passes unchanged if
// the reseed RPC grows a `requireOwnedState` guard, which is the exact change
// that turns the sentence into a lie. `tests/reseed-unowned-door.test.mjs` runs
// the real reseed against a real workspace whose records genuinely disagree and
// asks whether they agree afterwards. Keep the naming claims here and the
// behaviour claim there; a sentence and a door are different subjects.
//
// This is a plain module rather than something on the runtime core, because it
// is needed by the server AND by the client. Anything threaded through a deps
// bag would mean three wiring files and two dep types to move one string, and
// `wiring/gate-surfaces.ts` is not ours to edit.
//
// The wording is longer than a one-liner on purpose. It is the answer to "what
// do I do about this", and every clause is one a reader has otherwise had to
// infer: what failed, what Stelow will not do instead, which action clears it,
// where that action lives, and that the obvious alternative does not work.

export const OWNERSHIP_UNVERIFIED =
  "Workflow state ownership cannot be verified: this card's state records and its state file "
  + "disagree, and Stelow will not fall back to project-root state. Reseed this card — Restart "
  + "fresh… in the card actions menu — and a new worker re-seeds state.md and stelow.json from "
  + "triage. Retry cannot help: every command on this card is refused until the records agree.";

/**
 * Prefix match, not equality: the sites append their own tails (a card being
 * retyped gets a different last clause) and the sentence will evolve. What
 * must not happen is a message that merely *mentions* the phrase mid-sentence
 * being treated as the refusal, so this is `startsWith` rather than `includes`.
 */
export function isOwnershipRefusal(message) {
  return typeof message === "string"
    && message.startsWith("Workflow state ownership cannot be verified");
}

const REPAIR_RETRY_ADVICE = "Try Retry first — restart only if the worker itself is broken.";
const REPAIR_OWNERSHIP_ADVICE =
  "Retry cannot help here: every command on this card is refused until the records agree.";

/**
 * What the "Restart fresh" confirm dialog should say about trying something
 * cheaper first.
 *
 * Restart fresh is the right answer for most failures, so most of them get "try
 * Retry first". Not this one: on an unowned card a retry resumes a worker whose
 * every command is refused, which teaches the reader that Retry is the cheap
 * thing to try twice. Only the advice changes — the action, the confirmation
 * and its blast radius are identical.
 *
 * This lives beside the predicate rather than inside the component because a
 * sentence chosen by a ternary in JSX is testable only by matching its source,
 * and two clauses of advice is already the point where the copy starts to
 * disagree with itself.
 */
export function ownershipRepairAdvice(cardLastError) {
  return isOwnershipRefusal(cardLastError)
    ? REPAIR_OWNERSHIP_ADVICE
    : REPAIR_RETRY_ADVICE;
}
/**
 * A card's status, and what a person calls it.
 *
 * `cards.status` was the last status column in this schema with no authority
 * behind it. `execution_runs.normalized_status` has a CHECK constraint and its
 * names live beside it; a trackable's status has `TRACKABLE_STATUSES` and its
 * names live beside that. A card had neither — `status TEXT NOT NULL`, and four
 * values scattered across whichever code path happened to write them:
 * `draft` from creation and from a move reset, `in-progress` from the advance
 * and from thread sync, `completed` and `archived` from the board terminals.
 *
 * So this is the declaration. It is the third such module, not the first, and it
 * is last only because it was the only one nobody had looked at.
 *
 * **The five values, and how they were established.** Not guessed from the live
 * database, which holds three of them and would have missed `pending` and
 * `archived`. Every status literal in the repository was classified by axis, and
 * every one that is not one of these five belongs to a different machine:
 * `ready`, `missing`, `invalid`, `needs-depth` are research artifacts; `open` and
 * `answered` are execution boundary contracts; `human-review` is a review
 * verdict; `approved` is a scope map; `unverified` and `verified` are quality
 * seals.
 *
 * **`pending` is both a card status and a trackable status, and that is the
 * exact collision this module exists to end — I classified it wrong the first
 * time.** A first version of this list had four values and asserted, in these
 * comments, that "`pending` is a trackable". It is not only that: `insertCard`
 * writes `pending` for every Research and Explore card, `lib/tracks.mjs` maps the
 * Bucket column to it, and `track-projection.ts` reads it back to promote to
 * `in-progress`. A validator built on the four-value list threw on the creation
 * of every lightweight card and broke every drag back to Bucket — a regression
 * caught by an adversarial test pass, not by the suite, because no existing test
 * created a Research or Explore card.
 *
 * So the axis assignment was done by asking who WRITES the value, not by which
 * vocabulary the word appears in. `pending` belongs to both machines and so gets
 * an entry in each; sharing the entry would have been the bug.
 *
 * **Enforced at the write boundary, not by a CHECK constraint — deliberately.**
 * SQLite cannot add a CHECK to an existing table; it takes a rename, a rebuild,
 * a copy and a drop. This repo has done that before (`rebuildLegacyBandTable` in
 * preset-migrations.ts), so the pattern is not foreign — but `cards` is the
 * central table, several threads write to it continuously, and a rebuild buys
 * little over what the write boundary already gives. Every card write in the app
 * goes through exactly two functions: `writeCard` for updates and `insertCard`
 * for creation. Both refuse an unknown status, loudly, with the value named.
 *
 * What a CHECK would add is protection against writes that bypass the app —
 * hand-run SQL, a future script using the storage API directly. That is a real
 * gap and it is left open on purpose: a loud refusal at the boundary is worth
 * more than a constraint that fails during a migration, and the cost of the
 * constraint is paid at the worst possible moment. If the column is ever
 * rebuilt for another reason, add the CHECK then, from this list.
 */

/** The statuses a card can hold. Derived by who writes them, not by word. */
export const CARD_STATUSES = Object.freeze([
  "draft",
  "pending",
  "in-progress",
  "completed",
  "archived",
]);

/**
 * What a card's status is called when a person reads it.
 *
 * Note the board deliberately does NOT use these words. `buildBoardColumnFor`
 * answers "which column is this in", and the column headers are phases plus
 * Bucket and Done — so a mid-flight card shows "Planning", not "In progress",
 * because the useful question about a card on a board is where it is, not what
 * its row happens to say. These labels serve the surfaces that genuinely ask for
 * the status: the mention picker, and any diagnostic output.
 *
 * `pending` is the Bucket status for the lightweight tracks, so on a board it
 * reads "Bucket" and here it reads "Pending" — the same fact, asked two ways.
 *
 * `completed` reads "Completed" here and "Done" in `BUILD_BOARD_COLUMN_LABELS`,
 * and that is not a contradiction. "Done" is what a board column is called —
 * the place a card lands. "Completed" is what the status is. Same state, two
 * surfaces answering two different questions.
 */
export const CARD_STATUS_LABELS = Object.freeze({
  draft: "Draft",
  pending: "Pending",
  "in-progress": "In progress",
  completed: "Completed",
  archived: "Archived",
});

/** The name for a card status, falling back to the raw value. */
export function cardStatusLabel(status) {
  if (typeof status !== "string" || !status) return "";
  return CARD_STATUS_LABELS[status] ?? status;
}

/** Whether a value is one of the five. The write boundary asks this. */
export function isKnownCardStatus(status) {
  return typeof status === "string" && CARD_STATUSES.includes(status);
}

/**
 * Read a card's status, without borrowing a pendency's vocabulary to do it.
 *
 * This exists because card status was being run through the SCOPE normalizer —
 * `normalizeStatus(card.status)` in ten places — which only ever worked by
 * accident: the scope's vocabulary was a twelve-value superset that happened to
 * contain all five card statuses, so every value passed through unchanged. The
 * moment the scope vocabulary is described accurately, that function returns
 * `pending` for `draft` and `archived`, and every check of the form
 * `normalizeStatus(card.status) === "archived"` silently starts answering false.
 * A card's archive guard that stops guarding is not a type error; it is a card
 * that cannot be archived and a board that cannot tell an archived card from a
 * live one.
 *
 * So the axes read through their own reader. A value the write boundary would
 * have refused is a legacy row, and the honest reading of an unknown card status
 * is `draft` — not started — rather than a word borrowed from a pendency.
 */
export function readCardStatus(value) {
  if (isKnownCardStatus(value)) return value;
  return "draft";
}

/**
 * Refuse a status this build does not know, naming what it was and what exists.
 *
 * The message is the whole point. A bare CHECK failure says
 * `CHECK constraint failed: cards` and leaves the writer guessing; this says
 * which value, where, and what the five options are — so the bug is a one-line
 * fix at the call site instead of an archaeology exercise.
 *
 * `undefined` passes, because most card writes do not touch the status at all and
 * a validator that complained about an absent field would be noise.
 */
export function assertCardStatus(status, where) {
  if (status === undefined || status === null) return;
  if (isKnownCardStatus(status)) return;
  throw new Error(
    `Unknown card status ${JSON.stringify(status)} in ${where}. `
    + `A card's status is one of: ${CARD_STATUSES.join(", ")}.`,
  );
}

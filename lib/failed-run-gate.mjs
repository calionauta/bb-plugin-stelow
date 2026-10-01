// A failed native run holds the stage, and the hold has a door.
//
// The rule: a card may not advance out of a stage whose newest native run
// FAILED. The run is the work the stage was supposed to do; a failure that
// nobody looks at is how a card walks past a stage that produced nothing. On
// card_cbnihg4c (2026-09-30) the `scope-map` run failed with "the recipe
// produced no task outputs" — its staging directory was empty — and the card
// advanced to Tech planning anyway, so `Failed · scope` sat in Execution runs
// while the card was two stages on, reading as a contradiction with no way to
// tell whether the scope work had happened.
//
// The hold is on the NEWEST run for that stage, not on any failed run ever
// recorded. That distinction is the whole design: a retry creates a newer run,
// so the moment the retry starts, the hold releases and the card can move on
// if the retry succeeds. A rule that blocked on "a failed run exists" would
// need a way to clear the failed row, and nothing in this plugin does that —
// so that version is a wedge, and this one is not.
//
// The rule is deliberately NOT "the deliverable is missing". A failed run and
// a missing deliverable are two facts, and they come apart: a coordinator can
// do a stage's work itself, outside the native run, and this card's approved
// seven-scope `scope-map.json` is exactly that — the run's staging directory
// is empty and the stage's real output is sitting at its canonical path.
// Keying the gate on the deliverable would have let this card through and
// stopped a genuinely empty stage. The user chose the stricter rule knowing
// both facts, and the door below is what makes it safe to choose.

import { BLOCKING_RUN_STATUS } from "./execution-run-ledger.mjs";

/**
 * The failed run holding this card at this stage, or null.
 *
 * Scoped to the STAGE, not the card: a card accumulates runs for every stage it
 * has passed, and gating on the card's newest run would block a card that failed
 * three stages ago and has moved on cleanly since.
 *
 * The query carries its own ORDER BY rather than reading `listExecutionRuns`,
 * for two reasons that are the same reason. First, it asks for one row of one
 * stage instead of the card's whole history. Second — and this one is a bug
 * this function had and the test caught — `listExecutionRuns` orders by
 * `created_at DESC` alone, and two runs created in the same millisecond tie, and
 * SQLite does not promise an order for a tie. So "the newest run" was whatever
 * the scan happened to yield, which is exactly the kind of nondeterminism a
 * gate cannot be built on: a retry launched in the same tick as the run it
 * retries could be read as the older one, and the hold would report a run the
 * card had already moved past. `rowid DESC` breaks the tie by insertion order,
 * which is the thing "newest" actually means.
 */
export function blockingFailedRun(db, cardId, stage) {
  const row = db.prepare(
    "SELECT id, recipe_id, error_code, normalized_status FROM execution_runs "
    + "WHERE card_id = ? AND stage = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
  ).get(cardId, stage);
  if (!row || row.normalized_status !== BLOCKING_RUN_STATUS) return null;
  return { id: row.id, recipeId: row.recipe_id, errorCode: row.error_code ?? null };
}

/**
 * The refusal, naming the way out.
 *
 * A refusal that names no exit is a deadlock with a good error message, so
 * this sentence always carries the door: Retry run is the action that releases
 * the hold, and the run's own id is named so the reader can find the row they
 * are being pointed at.
 */
export function failedRunRefusal(run) {
  const reason = typeof run?.errorCode === "string" && run.errorCode.trim()
    ? run.errorCode.trim()
    : "the host gave no reason";
  return `The ${run.recipeId} run for this stage failed (${reason}). `
    + `Retry run to try it again — the card cannot leave the stage until a run of it succeeds. `
    + `Run ${run.id} is the one holding it.`;
}

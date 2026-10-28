import assert from "node:assert/strict";
import { effectiveActivity, attentionFromQuestions } from "../lib/card-activity.mjs";

/**
 * A card stops saying `awaiting-answer` when nothing is waiting.
 *
 * The row's `activity` column is a projection, and `awaiting-answer` is the one
 * value in it that names a fact outside the row: a live question on the worker
 * thread. Nothing rewrites the column when that question is answered, expires,
 * or leaves with a replaced thread — so the projection is re-derived on read.
 *
 * It used to be `openQuestions > 0 ? "awaiting-answer" : stored`, which had two
 * inputs for three states: "the source answered zero" and "the source could not
 * be read" were the same input, so a card whose question vanished kept its
 * badge and its inbox row forever. Three cards were in that state when this was
 * written (card_hce4tykn, card_qimjr9z4, card_g89gtmwt), and one worker was
 * refused with "the card won't take a second question while one is pending".
 *
 * Both halves are pinned: the rule itself, and the two read paths that must call
 * it instead of trusting the column.
 */

// --- 1. A successful read of zero ENDS an await. ---------------------------
assert.equal(
  effectiveActivity("awaiting-answer", 0),
  "idle",
  "zero open questions ends the wait it described — this is the phantom-wait fix",
);

// --- 2. An unreadable source keeps the last verified projection. ----------
for (const unknown of [null, undefined]) {
  assert.equal(
    effectiveActivity("awaiting-answer", unknown),
    "awaiting-answer",
    "an UNKNOWN question read is not a zero: keep the projection rather than guess",
  );
}

// --- 3. A live question re-asserts the wait. -------------------------------
assert.equal(effectiveActivity("idle", 2), "awaiting-answer");
assert.equal(effectiveActivity("awaiting-answer", 1), "awaiting-answer");

// --- 4. A question count never contradicts a worker-level state. -----------
assert.equal(effectiveActivity("error", 0), "error", "an error is about the worker, not the queue");
assert.equal(effectiveActivity("error", 3), "error");
assert.equal(effectiveActivity("held", 0), "held", "a hold is about the worker, not the queue");
assert.equal(effectiveActivity("held", 1), "held");

// --- 5. Ordinary idle/running is untouched. --------------------------------
assert.equal(effectiveActivity("idle", 0), "idle");
assert.equal(effectiveActivity("running", 0), "running");

// --- 6. An unrecognised stored value degrades to idle, not to a badge. ----
assert.equal(effectiveActivity("banana", 0), "idle");
assert.equal(effectiveActivity(undefined, 0), "idle");

// --- 7. The badge reads the same verdict. ---------------------------------
assert.equal(
  attentionFromQuestions("awaiting-answer", 0),
  null,
  "a resolved question stops asking for attention",
);
assert.equal(attentionFromQuestions("awaiting-answer", null), "question");
assert.equal(attentionFromQuestions("idle", 4), "question");
assert.equal(attentionFromQuestions("running", 0), null);

// --- 8. The wiring is a typecheck contract, not a text pin. ----------------
// `server/cards.ts` and `server/runtime/card-detail.ts` both import
// `effectiveActivity`; a missing export or a dropped import fails
// `npm run typecheck`. That is a real gate, so this file asserts the rule and
// leaves the wiring to it — a source-text pin here would pass on broken logic
// and break on a rename, which is the trade the source-pin ratchet refuses.

console.log(
  "card activity ok: a resolved question ends the wait, "
  + "an unreadable source does not, and a worker state outranks the count",
);

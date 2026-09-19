import assert from "node:assert/strict";
import { expiredAnswerPayload, cleanAnswerList } from "../lib/expired-question-answers.mjs";

assert.deepEqual(expiredAnswerPayload([{ id: "one" }, { id: "two" }], [["A", "B", "C"], []]), [], "an incomplete timed-out batch never creates a partial submit payload");
assert.deepEqual(expiredAnswerPayload([{ id: "one" }], [["  A  ", "", "B"]]), [{ questionId: "one", answers: ["A", "B"] }], "answers are cleaned without collapsing a multiple choice to its first value");
assert.deepEqual(expiredAnswerPayload(null, []), [], "odd inputs fail closed");

// The host re-cleans submitted answers at the RPC boundary — client cleaning
// is never trusted, and non-strings drop instead of throwing.
assert.deepEqual(cleanAnswerList(["  A  ", "", "B"]), ["A", "B"], "trims and drops empties");
assert.deepEqual(cleanAnswerList([" x ", null, 42, {}, "y "]), ["x", "y"], "non-strings drop instead of throwing");
assert.deepEqual(cleanAnswerList(null), [], "non-arrays clean to nothing");
assert.deepEqual(cleanAnswerList([]), [], "empty cleans to empty");

console.log("expired-question answers test ok: atomic payload retains all selections");

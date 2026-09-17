import assert from "node:assert/strict";
import { expiredAnswerPayload } from "../lib/expired-question-answers.mjs";

assert.deepEqual(expiredAnswerPayload([{ id: "one" }, { id: "two" }], [["A", "B", "C"], []]), [], "an incomplete timed-out batch never creates a partial submit payload");
assert.deepEqual(expiredAnswerPayload([{ id: "one" }], [["  A  ", "", "B"]]), [{ questionId: "one", answers: ["A", "B"] }], "answers are cleaned without collapsing a multiple choice to its first value");
assert.deepEqual(expiredAnswerPayload(null, []), [], "odd inputs fail closed");

console.log("expired-question answers test ok: atomic payload retains all selections");

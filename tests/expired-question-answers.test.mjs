import assert from "node:assert/strict";
import { expiredAnswerPayload } from "../lib/expired-question-answers.mjs";

assert.deepEqual(expiredAnswerPayload([{ id: "one" }, { id: "two" }], [["A", "B", "C"], []]), [{ questionId: "one", answers: ["A", "B", "C"] }], "a timed-out multi-choice keeps every selected option");
assert.deepEqual(expiredAnswerPayload([{ id: "one" }], [["  A  ", "", "B"]]), [{ questionId: "one", answers: ["A", "B"] }], "answers are cleaned without collapsing a multiple choice to its first value");
assert.deepEqual(expiredAnswerPayload(null, []), [], "odd inputs fail closed");

console.log("expired-question answers test ok: multi-choice payload retains all selections");

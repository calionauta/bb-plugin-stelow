import assert from "node:assert/strict";
import { QUESTION_ACTIVITY, questionWaitUpdates, askFinishedUpdates, researchColumnForStatus } from "../lib/card-question-state.mjs";

// The reported bug: a research card in Doing fell back to To-Do while a
// question waited. Waiting is activity, never board position.
assert.equal(QUESTION_ACTIVITY, "awaiting-answer", "activity value");

// questionWaitUpdates pins the write shape: activity only, no `status` key,
// so neither track can move columns while parking on a question.
for (const lastOutput of ["working…", null]) {
  const updates = questionWaitUpdates(lastOutput);
  assert.deepEqual(updates, { activity: "awaiting-answer", last_assistant_text: lastOutput }, `wait updates passthrough (${lastOutput})`);
  assert.equal("status" in updates, false, "wait updates never carry status");
}

// Finishing an ask only marks the worker running again — the ask layer never
// owns board position on either track (no Triage→Running jump on a first
// question, no To-Do→Doing jump on a mere timeout).
const finished = askFinishedUpdates();
assert.deepEqual(finished, { activity: "running" }, "finished updates resume running");
assert.equal("status" in finished, false, "finished updates never carry status");

// Stored statuses are used as-is: no value produced anywhere needs healing,
// so an unknown status reads as To-Do rather than crashing the board.
assert.equal(researchColumnForStatus("in-progress"), "doing", "in-progress -> doing");
assert.equal(researchColumnForStatus("approved"), "doing", "approved -> doing");
assert.equal(researchColumnForStatus("pending"), "todo", "pending -> todo");
assert.equal(researchColumnForStatus("draft"), "todo", "unknown -> todo");
assert.equal(researchColumnForStatus("completed"), "done", "completed -> done");
assert.equal(researchColumnForStatus("archived"), "archived", "archived passes through");

console.log("card question state test ok: activity-only waits, research columns");

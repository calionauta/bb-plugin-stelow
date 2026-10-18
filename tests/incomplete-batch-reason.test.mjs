import assert from "node:assert/strict";
import { incompleteBatchReason } from "../lib/question-presentation.mjs";

// The footer disables submit while any question is unanswered, and until this
// function existed it disabled it with no stated cause — a dead control, the
// same "disabled with no stated cause is a dead end" this codebase refuses in
// `submitBlockReason` (issue #384). `incompleteBatchReason` is that cause, so
// every assertion below fails if the count is wrong, the singular/plural split
// is lost, the exit is dropped, or the fully-answered case starts returning a
// line the refusal line would then sit beside.

const questions = (...ids) => ids.map((id) => ({ id, options: [] }));
const noneResolved = () => false;
const allResolved = () => true;
const resolvedExcept = (...resolvedIds) => (id) => resolvedIds.includes(id);

// --- The fully answered batch names nothing ---

// This is the boundary the footer depends on: it renders this line INSTEAD of
// the refusal line, so returning a string here would double up two explanations
// for a batch that has nothing wrong with it.
assert.equal(incompleteBatchReason(questions("q1", "q2", "q3"), allResolved), null,
  "a fully answered batch returns null: a string here would print a dead-end line beside the refusal it was meant to replace");
assert.equal(incompleteBatchReason(questions("q1"), allResolved), null,
  "a single answered question returns null, not a zero-remaining sentence");
assert.equal(incompleteBatchReason([], noneResolved), null,
  "an empty batch returns null: zero questions cannot remain unanswered");

// --- The count, and the singular/plural split ---

const one = incompleteBatchReason(questions("q1", "q2"), resolvedExcept("q2"));
assert.notEqual(one, null, "one unanswered question produces a reason");
assert.match(one, /\b1\b/, "the reason names the count: 'some questions remain' would not tell the reader how much is left");
assert.match(one, /question\b(?!s)/,
  "exactly one uses singular wording: '1 questions remain' is the plural leak this split exists to prevent");
assert.doesNotMatch(one, /questions/,
  "the singular sentence does not also contain the plural noun");

const two = incompleteBatchReason(questions("q1", "q2", "q3"), resolvedExcept("q1"));
assert.match(two, /\b2\b/, "two unanswered questions name the count 2");
assert.match(two, /questions/, "two or more uses plural wording");
assert.doesNotMatch(two, /\b1\b/, "the plural sentence does not misreport the count as one");

// The count must be the count of UNRESOLVED questions, never the batch size —
// reading `questions.length` would tell the reader that nothing was answered.
assert.match(incompleteBatchReason(questions("a", "b", "c", "d", "e"), resolvedExcept("a")), /\b4\b/,
  "with four of five unresolved the reason says 4, not 5: reporting the batch size would erase the reader's progress");
assert.match(incompleteBatchReason(questions("a", "b", "c", "d", "e"), resolvedExcept("a", "b", "c")), /\b2\b/,
  "and it recounts as more questions are resolved");
assert.match(incompleteBatchReason(questions("a", "b"), noneResolved), /\b2\b/, "no answers yet reports the full count");

// --- The exit must survive ---

// A reason with no exit is a deadlock with a good error message. The reader must
// be told they can answer OR skip — a "1 question remains." with no verb would
// leave the disabled button exactly as unexplained as before this function.
assert.match(one, /answer/i, "the reason names answering as the way out");
assert.match(one, /skip/i, "the reason names skipping as the alternative: dropping 'skip' would hide the only exit when the reader cannot answer");
assert.match(two, /answer/i, "the plural reason names answering as the way out");
assert.match(two, /skip/i, "the plural reason keeps the skip exit too");

// --- Unusable input never throws ---

// The footer calls this during render, so a throw would blank the card rather
// than explain the disabled button. Every malformed shape must degrade to null.
assert.equal(incompleteBatchReason([{ id: "q1" }], null), null,
  "a missing predicate treats everything as resolved instead of throwing: the footer must still render");
assert.equal(incompleteBatchReason([{ id: "q1" }], "not a function"), null,
  "a non-function predicate is ignored, not invoked");
assert.equal(incompleteBatchReason(null, noneResolved), null, "a null questions list reads as empty");
assert.equal(incompleteBatchReason("nope", noneResolved), null, "a non-array questions list reads as empty");
assert.equal(incompleteBatchReason(undefined, noneResolved), null, "an undefined questions list reads as empty");
assert.equal(incompleteBatchReason([null, undefined, "x", 7], noneResolved), null,
  "malformed entries are skipped, never counted: they have no id for the predicate to rule on");
assert.match(incompleteBatchReason([null, { id: "q1" }, 7], noneResolved), /\b1\b/,
  "a malformed entry beside a real one leaves the real one counted, not the batch poisoned");

// A predicate that only reads `id` means entries without one can never be
// resolved — pinned here so the filter and the predicate agree rather than
// silently disagreeing about whether a missing id is answerable.
assert.match(incompleteBatchReason([{ options: [] }], noneResolved), /\b1\b/,
  "an entry with no id and a false predicate still counts as incomplete");

console.log("incomplete batch reason test ok: count, singular/plural split and the answer-or-skip exit pinned");

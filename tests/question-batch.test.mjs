import assert from "node:assert/strict";
import {
  parseAskGroups,
  isBatchPayload,
  expandInteractionQuestions,
  splitQuestionId,
  groupBatchAnswers,
  formatBatchContinuation,
} from "../lib/question-batch.mjs";

// CLI group parsing: repeated --question blocks, options attach to current.
{
  const single = parseAskGroups(["--thread", "t", "--question", "Q?", "--option", "A", "--option", "B"]);
  assert.equal(single.error, undefined);
  assert.equal(single.groups.length, 1);
  assert.deepEqual(single.groups[0], { question: "Q?", multiple: false, options: ["A", "B"] });
}
{
  const multi = parseAskGroups(["--question", "Q1?", "--option", "A", "--option", "B", "--question", "Q2?", "--multiple", "--option", "C", "--option", "D"]);
  assert.equal(multi.error, undefined);
  assert.equal(multi.groups.length, 2);
  assert.equal(multi.groups[0].multiple, false);
  assert.equal(multi.groups[1].multiple, true);
  assert.deepEqual(multi.groups[1].options, ["C", "D"]);
}
{
  // --multiple before any --question is a usage error, not a silent attach.
  const bad = parseAskGroups(["--multiple", "--question", "Q?", "--option", "A", "--option", "B"]);
  assert.match(bad.error, /must follow a --question/);
}
{
  const short = parseAskGroups(["--question", "Q?", "--option", "Only"]);
  assert.match(short.error, /at least 2/);
}
{
  const empty = parseAskGroups(["--thread", "t"]);
  assert.match(empty.error, /Usage/);
}

// Payload shape detection + expansion.
assert.equal(isBatchPayload({ questions: [] }), true);
assert.equal(isBatchPayload({ question: "x", options: [] }), false);
{
  const legacy = expandInteractionQuestions({ id: "i1", title: "T", payload: { question: "Q?", multiple: false, options: [{ label: "A", description: "" }] } });
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].questionId, "i1", "legacy id stays the interaction id (compat)");
  assert.equal(legacy[0].index, 0);
}
{
  const batch = expandInteractionQuestions({
    id: "i9", title: "Batch", payload: { questions: [{ question: "Q1?", multiple: false, options: [{ label: "A", description: "" }] }, { question: "Q2?", multiple: true, options: [{ label: "B", description: "" }] }] },
  });
  assert.equal(batch.length, 2);
  assert.equal(batch[0].questionId, "i9#0");
  assert.equal(batch[1].questionId, "i9#1");
  assert.equal(batch[1].multiple, true);
}
{
  // Malformed sub-questions drop out; one bad apple never kills the batch.
  const partial = expandInteractionQuestions({ id: "i9", payload: { questions: [{ question: "bad", options: [] }, "junk", { question: "Q?", options: [{ label: "A", description: "" }] }] } });
  assert.equal(partial.length, 1);
  assert.equal(partial[0].questionId, "i9#2");
}

// Id splitting round-trips the expansion scheme.
assert.deepEqual(splitQuestionId("i1"), { interactionId: "i1", index: 0 });
assert.deepEqual(splitQuestionId("i9#2"), { interactionId: "i9", index: 2 });

// Answer grouping: one response per interaction, dense batch arrays.
{
  const grouped = groupBatchAnswers([
    { questionId: "i1", answers: ["A"] },
    { questionId: "i9#0", answers: ["X"] },
    { questionId: "i9#1", answers: ["Y", "Z"] },
  ]);
  assert.equal(grouped.size, 2);
  assert.deepEqual(grouped.get("i1"), { kind: "single", answers: ["A"] });
  assert.deepEqual(grouped.get("i9"), { kind: "batch", answers: [["X"], ["Y", "Z"]] });
}
{
  // Gaps densify to [] (skipped slot) and duplicates keep first write.
  const grouped = groupBatchAnswers([
    { questionId: "i9#1", answers: ["Y"] },
    { questionId: "i9#1", answers: ["OTHER"] },
  ]);
  assert.deepEqual(grouped.get("i9"), { kind: "batch", answers: [[], ["Y"]] });
}
{
  // Non-string answers are stripped, never crash the worker message.
  const grouped = groupBatchAnswers([{ questionId: "i1", answers: ["A", 42, null] }]);
  assert.deepEqual(grouped.get("i1"), { kind: "single", answers: ["A"] });
}

// Continuation text: atomic submit => one resume message.
{
  const text = formatBatchContinuation([{ question: "Q1?", answers: ["A"] }]);
  assert.match(text, /the pending question/);
  assert.match(text, /Q: Q1\?\nA: A/);
  const multi = formatBatchContinuation([{ question: "Q1?", answers: [] }, { question: "Q2?", answers: ["B", "C"] }]);
  assert.match(multi, /all 2 pending questions at once/);
  assert.match(multi, /skipped — use your recommendation/);
  assert.match(multi, /B, C/);
}

console.log("question batch test ok: cli groups, expansion, atomic grouping, continuation");

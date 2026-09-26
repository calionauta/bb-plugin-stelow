import assert from "node:assert/strict";
import { answerCommentBody, answeredCardPatch } from "../lib/question-answer-recording.mjs";

// Every answer leaves a record — the drift this module removes was that the
// live door skipped the comment for an undeclared answer while the recovery
// door always wrote one. Remove the "write on every answer" rule and the
// first assertion fails.
assert.equal(
  answerCommentBody([{ question: "What should it work on?", answers: ["Investigate"] }]),
  "Answer to a pending question:\n\nQ: What should it work on?\nA: Investigate",
  "an undeclared answer is still recorded in the trail, never dropped",
);

// A contract id must appear in the trail whichever door answered, so a grep
// for it cannot miss a satisfied contract. Invert the suffix and this fails.
assert.equal(
  answerCommentBody([{ question: "Which interface?", answers: ["CLI"], contract: "interface-pick" }]),
  "Answer to a pending question:\n\nQ: Which interface?\nA: CLI [contract: interface-pick]",
  "a declared contract is named in the trail exactly once",
);

assert.equal(
  answerCommentBody([
    { question: "First?", answers: ["A"] },
    { question: "Second?", answers: ["B", "C"], contract: "split" },
  ]),
  "Answer to a pending question:\n\nQ: First?\nA: A\n\nQ: Second?\nA: B, C [contract: split]",
  "a batch records every answer, contracts only where declared",
);

// A skipped multi-select is a real answer ("none"), not a missing one.
assert.equal(
  answerCommentBody([{ question: "Which?", answers: [] }]),
  "Answer to a pending question:\n\nQ: Which?\nA: (skipped — use your recommendation)",
  "an empty answer is recorded as a decision, not silently omitted",
);

assert.equal(answerCommentBody([]), null, "no decisions means no comment");
assert.equal(answerCommentBody(null), null, "odd input fails closed");
assert.equal(answerCommentBody([{ answers: ["A"] }]), null, "an untitled question is not recorded as a decision");
assert.equal(answerCommentBody([null, "nope", { question: "", answers: [] }]), null, "malformed entries drop instead of throwing");

// A fresh answer resumes the worker and clears the interrupted turn's
// failure; a card with other questions still open stays parked.
assert.deepEqual(
  answeredCardPatch(false),
  { activity: "running", status: "in-progress", last_error: null },
  "a fully answered card resumes and forgets the stale failure",
);
assert.deepEqual(
  answeredCardPatch(true),
  { activity: "awaiting-answer", status: "in-progress", last_error: null },
  "a card with questions still open stays parked instead of claiming to be running",
);

console.log("question answer recording test ok: one trail rule, one card patch, both doors");

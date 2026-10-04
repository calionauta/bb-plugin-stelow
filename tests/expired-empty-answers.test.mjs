import assert from "node:assert/strict";
import test from "node:test";
import { createQuestionAnswers } from "../server/runtime/question-answers.ts";

/**
 * Empty means none — but only where none is expressible. A multiple-choice
 * expired question submitted with nothing checked is a completed "none"
 * decision (keep nothing / add nothing); a single-select radio with nothing
 * picked is an unfinished form, so it stays unanswered and the batch refusal
 * names it. This is the Q2 trap from card_a9q5zhzd made impossible to repeat
 * wherever the authoring was correct (multiple): the host no longer forces
 * a pick nobody wants.
 */

function harness(expiredRows) {
  const calls = { sends: [], comments: [], updates: [] };
  const answered = [];
  const deps = {
    bb: {
      sdk: { threads: { send: async (input) => calls.sends.push(input) } },
      realtime: { publish: () => undefined },
    },
    db: {
      prepare: (sql) => sql.includes("FROM expired_questions")
        ? { all: () => expiredRows }
        : { run: (...args) => answered.push(args) },
      transaction: (fn) => fn,
    },
    errors: { cardNotFound: "missing", cardArchived: "archived" },
    getCard: () => ({ id: "card_1", worker_thread_id: "thr_1" }),
    isArchivedCard: () => false,
    pendingAsks: async () => [],
    openExpiredQuestionIds: () => [],
    syncPendingQuestionInbox: () => undefined,
    syncOpenQuestionInbox: async () => [],
    markInboxQuestionsAnswered: () => undefined,
    recordSplitAnswer: () => undefined,
    consumeAskContract: () => null,
    logCardComment: (...args) => calls.comments.push(args),
    updateCard: (cardId, fields) => calls.updates.push(fields),
    hasOpenQuestions: () => false,
  };
  return { deps, calls, answered };
}

const rows = (multiple) => [
  { id: "old_1", thread_id: "thr_1", question: "Keep?", multiple },
];

test("an empty multiple-choice expired answer completes as none", async () => {
  const { deps, calls } = harness(rows(1));
  const result = await createQuestionAnswers(deps).answerExpiredQuestions({
    cardId: "card_1",
    answers: [{ questionId: "old_1", answers: [] }],
  });
  assert.equal(result.ok, true, "empty on multiple is a decision, not a missing answer");
  assert.equal(result.answered, 1);
  assert.equal(calls.sends.length, 1, "the worker still resumes");
  assert.match(calls.sends[0].input[0].text, /skipped/, "naming the none for what it is");
});

test("an empty single-select expired answer still refuses", async () => {
  const { deps, calls } = harness(rows(0));
  const result = await createQuestionAnswers(deps).answerExpiredQuestions({
    cardId: "card_1",
    answers: [{ questionId: "old_1", answers: [] }],
  });
  assert.equal(result.ok, false, "a radio with nothing picked is unfinished, not none");
  assert.match(result.error, /Answer every pending question/);
  assert.equal(calls.sends.length, 0, "and the worker does not resume");
});

test("a mixed batch answers some and nones the rest", async () => {
  const { deps, calls } = harness([
    { id: "old_1", thread_id: "thr_1", question: "Keep?", multiple: 1 },
    { id: "old_2", thread_id: "thr_1", question: "Add?", multiple: 1 },
  ]);
  const result = await createQuestionAnswers(deps).answerExpiredQuestions({
    cardId: "card_1",
    answers: [
      { questionId: "old_1", answers: ["A", "B"] },
      { questionId: "old_2", answers: [] },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.answered, 2, "an empty multiple counts as answered");
  assert.equal(calls.comments.length, 1, "one trail comment for the batch");
  assert.match(calls.comments[0][4], /A, B/);
  assert.match(calls.comments[0][4], /skipped/);
});

test("a mixed batch with an empty single still refuses naming it", async () => {
  const { deps, calls } = harness([
    { id: "old_1", thread_id: "thr_1", question: "Keep?", multiple: 1 },
    { id: "old_2", thread_id: "thr_1", question: "Pick?", multiple: 0, kind: "standard" },
  ]);
  const result = await createQuestionAnswers(deps).answerExpiredQuestions({
    cardId: "card_1",
    answers: [
      { questionId: "old_1", answers: [] },
      { questionId: "old_2", answers: [] },
    ],
  });
  assert.equal(result.ok, false, "none on multiple cannot cover an unfinished radio");
  assert.match(result.error, /old_2/, "the refusal names the still-open question");
  assert.equal(calls.sends.length, 0);
});

test("an empty split multiple still refuses", async () => {
  const { deps, calls } = harness([
    { id: "old_1", thread_id: "thr_1", question: "Split?", multiple: 1, kind: "split" },
  ]);
  const result = await createQuestionAnswers(deps).answerExpiredQuestions({
    cardId: "card_1",
    answers: [{ questionId: "old_1", answers: [] }],
  });
  assert.equal(result.ok, false, "a split proposal without its keep choice is unfinished");
  assert.equal(calls.sends.length, 0);
});

test("a none decision still records, marks, and repaints", async () => {
  const marked = [];
  const { deps, calls } = harness([
    { id: "old_1", thread_id: "thr_1", question: "Add?", multiple: 1, kind: "standard" },
  ]);
  deps.markInboxQuestionsAnswered = (cardId, ids) => marked.push([cardId, ids]);
  const repainted = [];
  deps.updateCard = (cardId, fields) => { calls.updates.push(fields); repainted.push(cardId); };
  const result = await createQuestionAnswers(deps).answerExpiredQuestions({
    cardId: "card_1",
    answers: [{ questionId: "old_1", answers: [] }],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(marked, [["card_1", ["expired:old_1"]]], "the none still marks its inbox row answered");
  assert.deepEqual(repainted, ["card_1"], "and the card repaints");
  assert.equal(calls.comments.length, 1, "leaving the openable trail record");
  assert.match(calls.comments[0][4], /Add\?/);
});

console.log("expired empty answers test ok: none is a decision on multiple, unfinished on single");

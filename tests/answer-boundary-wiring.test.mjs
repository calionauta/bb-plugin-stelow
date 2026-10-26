import assert from "node:assert/strict";
import test from "node:test";
import { createQuestionAnswers } from "../server/runtime/question-answers.ts";
import { answerDeps } from "./fixtures/answer-deps.mjs";

/**
 * The continuations that are NOT the worker thread: the run's own native
 * boundary, and the recovery door.
 *
 * Split out of `answer-resume-wiring` when that file crossed its line budget, and
 * the split is the subject's own: both of these resume something the thread path
 * never touches, and both carry the same review comments through it.
 */

test("a boundary answer resumes the run and never the worker thread", async () => {
  const resumed = [];
  const { deps, calls } = answerDeps({
    deps: {
      boundary: {
        read: () => ({
          routeAnswerContinuation: async () => ({ id: "run_1" }),
          resumeAfterAnswers: async (run, decisions) => {
            resumed.push({ run, decisions });
            return null;
          },
        }),
      },
    },
  });
  const result = await createQuestionAnswers(deps).answerQuestions({
    cardId: "card_1",
    answers: [{ questionId: "ask_1", answers: ["A"] }],
  });
  assert.equal(result.ok, true);
  assert.equal(resumed.length, 1, "the boundary run is resumed once");
  assert.equal(resumed[0].run.id, "run_1");
  assert.equal(calls.sends.length, 0, "a boundary answer is not an ordinary worker continuation");
});

// The native resume takes decisions, not text — but it is still the continuation
// that resumes the work, so what the person wrote while reviewing has to reach
// it. The port reports whether the resume happened, and only that word lets the
// comments be marked carried: this used to be decided by omission (comments
// stayed pending forever on a card whose answers resume runs).
test("a boundary answer carries the review comments into the run", async () => {
  const carried = [];
  const seen = [];
  const { deps } = answerDeps({
    deps: {
      boundary: {
        read: () => ({
          routeAnswerContinuation: async () => ({ id: "run_1" }),
          resumeAfterAnswers: async (_run, _decisions, feedback) => {
            seen.push(feedback);
            return null;
          },
        }),
      },
      answerFeedback: async () => ({
        block: "## Feedback written while answering\n\n### Comment 1\n\nRe plan.md: keep it",
        ids: ["c1"],
      }),
      markAnswerFeedbackCarried: (ids) => carried.push(...ids),
    },
  });
  const result = await createQuestionAnswers(deps).answerQuestions({
    cardId: "card_1",
    answers: [{ questionId: "ask_1", answers: ["A"] }],
  });
  assert.equal(result.delivery, "sent");
  assert.equal(seen.length, 1);
  assert.match(seen[0], /Re plan\.md: keep it/);
  assert.deepEqual(carried, ["c1"]);
});

// The port's refusal is the only thing standing between a comment and a second
// delivery: a run that did not resume did not carry anything.
test("a refused boundary resume leaves its comments pending", async () => {
  const carried = [];
  const { deps } = answerDeps({
    deps: {
      boundary: {
        read: () => ({
          routeAnswerContinuation: async () => ({ id: "run_1" }),
          resumeAfterAnswers: async () => "the boundary has moved on",
        }),
      },
      answerFeedback: async () => ({ block: "## Feedback written while answering", ids: ["c1"] }),
      markAnswerFeedbackCarried: (ids) => carried.push(...ids),
    },
  });
  const result = await createQuestionAnswers(deps).answerQuestions({
    cardId: "card_1",
    answers: [{ questionId: "ask_1", answers: ["A"] }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.delivery, "refused");
  assert.match(result.deliveryLine, /boundary has moved on/);
  assert.deepEqual(carried, []);
});

// A refused resume is reported, never swallowed: the answer was recorded, and
// the caller has to learn that the run did not restart.
// A refused boundary resume used to return before any bookkeeping, which left a
// phantom wait: the interaction was already consumed, so the card claimed
// `awaiting-answer` and its Inbox row could not be answered again. What regresses
// if this fails: an unanswerable row plus a card stuck on a question nobody can
// settle.
test("a refused boundary resume still settles the questions and reports the refusal", async () => {
  const { deps, calls } = answerDeps({
    deps: {
      boundary: {
        read: () => ({
          routeAnswerContinuation: async () => ({ id: "run_1" }),
          resumeAfterAnswers: async () => "The native boundary contract is missing or no longer current.",
        }),
      },
    },
  });
  const result = await createQuestionAnswers(deps).answerQuestions({
    cardId: "card_1",
    answers: [{ questionId: "ask_1", answers: ["A"] }],
  });
  // The answer was recorded by the host before the resume was attempted, so the
  // door succeeds at what it was asked and reports the wake separately.
  assert.equal(result.ok, true);
  assert.equal(result.answered, 1);
  assert.equal(result.delivery, "refused");
  assert.match(result.deliveryLine, /no longer current/);
  assert.match(result.deliveryLine, /Resume the card/);
  // The Inbox row and the card are settled: no phantom wait is left behind.
  assert.deepEqual(calls.answered, ["ask_1"]);
  assert.equal(calls.updates[0].activity, "idle");
  assert.equal(calls.sends.length, 0, "a refused boundary resume does not fall back to the thread");
});

// The comment mark follows the SAME standard as the card: only a dispatch that
// landed carries it. What regresses if this fails: a comment the host queued is
// stamped carried, and the resume prompt never contains it.
test("an absent boundary port answers as an ordinary worker continuation", async () => {
  const { deps, calls } = answerDeps();
  const result = await createQuestionAnswers(deps).answerQuestions({
    cardId: "card_1",
    answers: [{ questionId: "ask_1", answers: ["A"] }],
  });
  assert.equal(result.ok, true);
  assert.equal(calls.sends.length, 1);
});

// The other half of the rule: what the person wrote while reviewing rides the
// answer itself, and only a dispatch that landed marks it carried. What
// regresses if this fails: the comments are stamped as carried by an answer that
// never went, so the worker never sees them and nothing says so.
test("the recovery door wakes the row's thread when the card has none", async () => {
  const { deps, calls } = answerDeps({
    expiredRows: [{ id: "old_1", thread_id: "thr_9", question: "Keep?", multiple: 1 }],
    deps: { getCard: () => ({ id: "card_1", worker_thread_id: null }) },
  });
  const result = await createQuestionAnswers(deps).answerExpiredQuestions({
    cardId: "card_1",
    answers: [{ questionId: "old_1", answers: [] }],
  });
  assert.equal(result.delivery, "sent");
  assert.equal(calls.sends[0].threadId, "thr_9");
});

// And when there is no thread anywhere, the verdict says so instead of reporting
// a resume nobody performed.
test("the recovery door names a card with no worker thread at all", async () => {
  const { deps, calls } = answerDeps({
    expiredRows: [{ id: "old_1", thread_id: null, question: "Keep?", multiple: 1 }],
    deps: { getCard: () => ({ id: "card_1", worker_thread_id: null }) },
  });
  const result = await createQuestionAnswers(deps).answerExpiredQuestions({
    cardId: "card_1",
    answers: [{ questionId: "old_1", answers: [] }],
  });
  assert.equal(result.delivery, "refused");
  assert.match(result.deliveryLine, /no worker thread/);
  assert.equal(calls.sends.length, 0);
});

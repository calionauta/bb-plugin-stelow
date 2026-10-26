import assert from "node:assert/strict";
import test from "node:test";
import { createQuestionAnswers } from "../server/runtime/question-answers.ts";
import { answerDeps, card } from "./fixtures/answer-deps.mjs";

/**
 * What the answer door reports about the wake.
 *
 * The answers and the resume are two acts with two fates: the answers are
 * recorded, and the worker is sent, queued, or refused. The door used to report
 * one boolean for all three. What regresses if these fail: a queued answer
 * reads as delivered, the card claims to be running, and the reader learns the
 * truth only from a card that never moved.
 */

// The host answered the dispatch with a queue, not a send. The card used to take
// that as a resume: it claimed `running` for a turn nobody had started, and the
// reader was told nothing. What regresses if this fails: a queued answer reads
// as delivered, the card claims work, and the reconciler spends the budget
// recovering a card that never stopped.
test("a queued resume is reported as a hold, and the card stops claiming to run", async () => {
  const { deps, calls } = answerDeps({
    send: () => ({
      delivery: "queued",
      queuedMessage: { waitingOn: { kind: "plugin", reason: "4 of 4 running on host alpha" } },
    }),
  });
  const result = await createQuestionAnswers(deps).answerQuestions({
    cardId: "card_1",
    answers: [{ questionId: "ask_1", answers: ["A"] }],
  });
  // The person's part is done, so the door succeeds...
  assert.equal(result.ok, true);
  assert.equal(result.answered, 1);
  assert.deepEqual(calls.answered, ["ask_1"]);
  // ...and the waking is reported as what it was, in the host's own words.
  assert.equal(result.delivery, "queued");
  assert.match(result.deliveryLine, /^The answer is saved\./);
  assert.match(result.deliveryLine, /4 of 4 running on host alpha/);
  // The card says held and stays in its column: a transport wait is not progress.
  assert.equal(calls.updates[0].activity, "held");
  assert.equal(calls.updates[0].status, "in-progress");
});

// The send threw. The answers are recorded and the worker never heard about
// them. What regresses if this fails: the door reports `ok: true` with no
// verdict, so a reader closes the card believing a paused worker was woken.
test("a refused resume keeps the recorded answers and names the host's reason", async () => {
  const { deps, calls } = answerDeps({
    send: () => {
      throw new Error("thread 1 is gone");
    },
  });
  const result = await createQuestionAnswers(deps).answerQuestions({
    cardId: "card_1",
    answers: [{ questionId: "ask_1", answers: ["A"] }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.delivery, "refused");
  assert.match(result.deliveryLine, /thread 1 is gone/);
  assert.match(result.deliveryLine, /Resume the card/);
  assert.deepEqual(calls.answered, ["ask_1"]);
  // Nothing is running, and the card must not say it is.
  assert.equal(calls.updates[0].activity, "idle");
});

test("live answer refuses an unknown question without resuming the worker", async () => {
  const { deps, calls } = answerDeps();
  const result = await createQuestionAnswers(deps).answerQuestions({
    cardId: "card_1",
    answers: [{ questionId: "ask_missing", answers: ["A"] }],
  });
  assert.match(result.error, /No open question/);
  assert.equal(calls.sends.length, 0);
  assert.equal(calls.updates.length, 0);
});

test("archived cards refuse live and expired answers before persistence", async () => {
  const { deps, calls } = answerDeps({
    expiredRows: [],
    deps: { isArchivedCard: () => true },
  });
  const answer = createQuestionAnswers(deps);
  const live = await answer.answerQuestions({
    cardId: "card_1",
    answers: [{ questionId: "ask_1", answers: ["A"] }],
  });
  const expired = await answer.answerExpiredQuestions({
    cardId: "card_1",
    answers: [{ questionId: "old_1", answers: ["A"] }],
  });
  assert.equal(live.error, "archived");
  assert.equal(expired.error, "archived");
  assert.equal(calls.sends.length, 0);
  assert.equal(calls.comments.length, 0);
});

test("expired answers remain all-or-nothing and use the current worker", async () => {
  const rows = [
    { id: "old_1", thread_id: "old_thread", question: "Q1?" },
    { id: "old_2", thread_id: "old_thread", question: "Q2?" },
  ];
  const { deps, calls } = answerDeps({
    expiredRows: rows,
    deps: { getCard: () => card({ worker_thread_id: "current_thread" }) },
  });
  const answer = createQuestionAnswers(deps);
  const refused = await answer.answerExpiredQuestions({
    cardId: "card_1",
    answers: [{ questionId: "old_1", answers: ["A"] }],
  });
  assert.match(refused.error, /Answer every pending question/);
  assert.equal(calls.comments.length, 0);
  assert.equal(calls.answered.length, 0);
  const accepted = await answer.answerExpiredQuestions({
    cardId: "card_1",
    answers: rows.map((row) => ({ questionId: row.id, answers: ["A"] })),
  });
  assert.equal(accepted.ok, true);
  assert.equal(calls.sends[0].threadId, "current_thread");
  // One trail comment for the batch, not one per question: the two doors share
  // a single recording rule (lib/question-evidence), so a grep for a
  // satisfied contract cannot miss one spelling and find the other.
  assert.equal(calls.comments.length, 1);
  assert.match(calls.comments[0][4], /Q1\?/);
  assert.match(calls.comments[0][4], /Q2\?/);
  assert.match(calls.comments[0][4], /\[contract: direction-contract\]/);
});

// The native-boundary port: an answer that IS the run's boundary resumes the
// RUN, and the worker thread is left alone. Without the port the same answer
// sends an ordinary continuation, so removing the routing is a silent
// regression a needs-input card would only discover at runtime.
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

// A refused resume is reported, never swallowed: the answer was recorded, and
// the caller has to learn that the run did not restart.
test("a refused boundary resume surfaces its refusal with the answer counted", async () => {
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
  assert.equal(result.ok, false);
  assert.equal(result.answered, 1, "the answer still counts: it was recorded before the resume");
  assert.match(result.error, /no longer current/);
  assert.equal(calls.sends.length, 0, "a refused boundary resume does not fall back to the thread");
});

// An unbound port (before the execution layer is wired) is the pre-native
// behavior, not a crash.
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
test("an answer carries the comments written while reviewing", async () => {
  const carried = [];
  const block = "## Feedback written while answering\n\n### Comment 1\n\nRe a.md: keep it";
  const { deps, calls } = answerDeps({
    deps: {
      answerFeedback: async () => ({ block, ids: ["c1"] }),
      markAnswerFeedbackCarried: (ids) => carried.push(...ids),
    },
  });
  const result = await createQuestionAnswers(deps).answerQuestions({
    cardId: "card_1",
    answers: [{ questionId: "ask_1", answers: ["A"] }],
  });
  assert.equal(result.delivery, "sent");
  const text = calls.sends[0].input[0].text;
  // The continuation leads: the answers are the instruction, the comments are
  // what came with them.
  assert.match(text, /^The user answered the pending question/);
  assert.ok(text.indexOf("Feedback written while answering") > 0);
  assert.match(text, /Re a\.md: keep it/);
  assert.deepEqual(carried, ["c1"]);
});

test("a refused answer leaves its comments pending for the next one", async () => {
  const carried = [];
  const { deps } = answerDeps({
    send: () => {
      throw new Error("thread 1 is gone");
    },
    deps: {
      answerFeedback: async () => ({ block: "## Feedback written while answering", ids: ["c1"] }),
      markAnswerFeedbackCarried: (ids) => carried.push(...ids),
    },
  });
  const result = await createQuestionAnswers(deps).answerQuestions({
    cardId: "card_1",
    answers: [{ questionId: "ask_1", answers: ["A"] }],
  });
  assert.equal(result.delivery, "refused");
  assert.deepEqual(carried, [], "a comment is never marked carried by a send that failed");
});

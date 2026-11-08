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

// The comment mark follows the SAME standard as the card: only a dispatch that
// landed carries it. What regresses if this fails: a comment the host queued is
// stamped carried, and the resume prompt never contains it.
test("a queued dispatch does not mark its comments carried", async () => {
  const carried = [];
  const { deps } = answerDeps({
    send: () => ({
      delivery: "queued",
      queuedMessage: { waitingOn: { kind: "plugin", reason: "4 of 4 running on host alpha" } },
    }),
    deps: {
      answerFeedback: async () => ({ block: "## Feedback written while answering", ids: ["c1"] }),
      markAnswerFeedbackCarried: (ids) => carried.push(...ids),
    },
  });
  const result = await createQuestionAnswers(deps).answerQuestions({
    cardId: "card_1",
    answers: [{ questionId: "ask_1", answers: ["A"] }],
  });
  assert.equal(result.delivery, "queued");
  assert.deepEqual(carried, []);
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

// The card patch order used to let a refused verdict replace `awaiting-answer`
// on a card that still had open questions. What regresses if this fails: a card
// waiting on the person reads as idle, and the reconciler spends a resume budget
// on a card that is not stuck.
test("a card still waiting on the person never reports idle", async () => {
  const { deps, calls } = answerDeps({
    send: () => {
      throw new Error("gone");
    },
    deps: { openExpiredQuestionIds: () => ["q2"] },
  });
  const result = await createQuestionAnswers(deps).answerQuestions({
    cardId: "card_1",
    answers: [{ questionId: "ask_1", answers: ["A"] }],
  });
  assert.equal(result.delivery, "refused");
  assert.equal(calls.updates[0].activity, "awaiting-answer");
});

// The order of the two bookkeeping calls is a rule, not an accident: the answers
// are named BEFORE the inbox sync, because a row that merely disappears reads as
// superseded. What regresses if this fails: an answered question is filed as
// "you answered it, then it went away on its own", and the trail says the wrong
// thing about why it closed.
test("an answered question is named before the inbox is synced", async () => {
  const order = [];
  const { deps } = answerDeps({
    deps: {
      markInboxQuestionsAnswered: (_cardId, ids) => order.push(`answered:${ids.join(",")}`),
      syncPendingQuestionInbox: () => order.push("sync"),
    },
  });
  const result = await createQuestionAnswers(deps).answerQuestions({
    cardId: "card_1",
    answers: [{ questionId: "ask_1", answers: ["A"] }],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(order, ["answered:ask_1", "sync"]);
});

// The ack read is fail-soft by contract: a store that cannot answer must not fail
// the answer. What regresses if this fails: a broken comment store blocks the
// person from answering anything.
test("a failing feedback reader does not fail the answer", async () => {
  const { deps, calls } = answerDeps({
    deps: {
      answerFeedback: async () => {
        throw new Error("store unavailable");
      },
    },
  });
  const result = await createQuestionAnswers(deps).answerQuestions({
    cardId: "card_1",
    answers: [{ questionId: "ask_1", answers: ["A"] }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.delivery, "sent");
  assert.equal(calls.sends.length, 1);
  assert.doesNotMatch(calls.sends[0].input[0].text, /Feedback written while answering/);
});

// The recovery door's thread fallback: the row's thread may be stale, but it is
// still better than nothing when the card has no worker of its own.

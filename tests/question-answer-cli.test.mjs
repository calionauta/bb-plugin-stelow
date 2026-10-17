import assert from "node:assert/strict";
import { isExpiredQuestionId, expiredQuestionRowId, expiredQuestionId, parseAnswerArgs, buildAnswerPayload } from "../lib/question-evidence.mjs";
import { createAnswerCommand } from "../server/runtime/cli/cli-answer.ts";
import { stelowCliCommands } from "../server/runtime/cli-registry.ts";
import { createQuestionAnswers } from "../server/runtime/question-answers.ts";

// The recovery/live discriminator is the only thing telling the two answering
// doors apart in the CLI payload. Break the prefix and both doors start
// accepting each other's question ids, answering the wrong question.
assert.ok(isExpiredQuestionId("expired:qexp_1"), "a recovery question is recognized by its prefix");
assert.ok(!isExpiredQuestionId("int_abc"), "a live interaction id is not a recovery question");
assert.ok(!isExpiredQuestionId(null), "a non-string is not a recovery question");
assert.equal(expiredQuestionRowId("expired:qexp_1"), "qexp_1", "the row id is recovered from the prefixed question id");
assert.equal(expiredQuestionRowId("int_abc"), "int_abc", "a live id passes through unchanged");
assert.equal(expiredQuestionId("qexp_1"), "expired:qexp_1", "the id round-trips");

// The verb exists and is documented, so the door is discoverable rather than
// a hidden RPC. Remove the registration and the CLI can never answer a card.
{
  const entry = stelowCliCommands.find((command) => command.name === "answer");
  assert.ok(entry, "bb stelow answer is a contracted CLI verb");
  assert.match(entry.summary, /Answer a card's pending questions/, "the verb summary names the door");
  assert.match(entry.usage, /--question/, "the usage names the question flag");
}
{
  // The verb has a handler: it answers nothing for other verbs and refuses
  // a typo'd call without touching any door.
  const calls = [];
  const doors = {
    answerQuestions: async (input) => { calls.push(["live", input]); return { ok: true, answered: 1, error: null }; },
    answerExpiredQuestions: async (input) => { calls.push(["expired", input]); return { ok: true, answered: 1, error: null }; },
  };
  const deps = { getCard: (id) => (id === "c1" ? { id: "c1" } : undefined), getCardByWorkerThread: () => ({ id: "c1" }) };
  const run = createAnswerCommand(deps, doors);
  assert.equal(await run(["status"], { threadId: null }), null, "other verbs pass through untouched");
  const typo = await run(["answer", "--card", "c1", "--queston", "q", "--answer", "A"], { threadId: null });
  assert.equal(typo.exitCode, 2, "a typo'd flag refuses");
  assert.equal(calls.length, 0, "a refused call never reaches a door");
}

// A typo'd flag must refuse instead of silently answering the wrong thing:
// the dangerous case is a dropped --question, which would otherwise attach an
// answer to the previous question or to nothing at all.
assert.match(
  parseAnswerArgs(["--card", "c1", "--queston", "q", "--answer", "A"]).error,
  /Unknown flag --queston/,
  "a typo'd flag refuses rather than being ignored",
);
assert.match(parseAnswerArgs(["--answer", "A"]).error, /--answer must follow a --question/, "an answer with no question refuses");
assert.match(parseAnswerArgs(["--question"]).error, /--question needs a value/, "a flag with no value refuses");
assert.match(parseAnswerArgs(["--card", "c1"]).error, /Usage: bb stelow answer/, "a call with no answers refuses");
assert.ok(parseAnswerArgs(null).error, "odd input fails closed instead of answering nothing");

// --answer belongs to the --question immediately before it, so a multi-select
// is written as two --answer values on one question. Swap this to
// question-major grouping and a multi-select silently answers the wrong pair.
assert.deepEqual(
  parseAnswerArgs(["--card", "c1", "--question", "q1", "--answer", "A", "--answer", "B", "--question", "q2", "--answer", "C"]).pairs,
  [{ question: "q1", answer: "A" }, { question: "q1", answer: "B" }, { question: "q2", answer: "C" }],
  "each answer binds to the question immediately before it",
);
assert.equal(parseAnswerArgs(["--json"]).json, undefined, "--json alone carries no answers and still refuses");
assert.equal(parseAnswerArgs(["--card", "c1", "--question", "q", "--answer", "A", "--json"]).json, true, "--json is reported alongside the pairs");

const payload = buildAnswerPayload([{ question: "expired:q1", answer: "A" }, { question: "int_1", answer: "B" }]);
assert.deepEqual(payload.expired, [{ questionId: "expired:q1", answers: ["A"] }], "a recovery question lands in the recovery door");
assert.deepEqual(payload.live, [{ questionId: "int_1", answers: ["B"] }], "a live interaction lands in the live door");
assert.deepEqual(
  buildAnswerPayload([{ question: "q1", answer: "A" }, { question: "q1", answer: "B" }]).live,
  [{ questionId: "q1", answers: ["A", "B"] }],
  "a multi-select question keeps every selected option on its own entry",
);
assert.deepEqual(
  parseAnswerArgs(["--card", "c1", "--question", "q1", "--answer", ""]).pairs,
  [{ question: "q1", answer: "" }],
  "an empty --answer value survives argv parsing: the server reads it as none on multiple-choice",
);
assert.deepEqual(
  buildAnswerPayload([{ question: "q1", answer: "" }]).live,
  [{ questionId: "q1", answers: [""] }],
  "and it groups like any answer — cleaning to none happens server-side, once",
);

// Answering is atomic per door: mixing live and recovery ids in one call is
// refused instead of half-answering, because each door answers its own set.
{
  const calls = [];
  const doors = {
    answerQuestions: async (input) => { calls.push(["live", input]); return { ok: true, answered: 1, error: null }; },
    answerExpiredQuestions: async (input) => { calls.push(["expired", input]); return { ok: true, answered: 1, error: null }; },
  };
  const deps = { getCard: () => ({ id: "c1" }), getCardByWorkerThread: () => ({ id: "c1" }) };
  const run = createAnswerCommand(deps, doors);
  const mixed = await run(["answer", "--card", "c1", "--question", "int_1", "--answer", "A", "--question", "expired:q1", "--answer", "B"], { threadId: null });
  assert.equal(mixed.exitCode, 2, "mixed doors refuse");
  assert.match(mixed.stderr, /separate calls/, "the two doors are never mixed in one call");
  assert.equal(calls.length, 0, "a mixed call answers nothing");
}

// The CLI delegates to the shared implementations instead of re-implementing
// the recording rule — a second copy is how the two doors drifted before.
{
  const calls = [];
  const doors = {
    answerQuestions: async (input) => { calls.push(["live", input]); return { ok: true, answered: 1, error: null }; },
    answerExpiredQuestions: async (input) => { calls.push(["expired", input]); return { ok: true, answered: 1, error: null }; },
  };
  const deps = { getCard: () => ({ id: "c1" }), getCardByWorkerThread: () => ({ id: "c1" }) };
  const run = createAnswerCommand(deps, doors);
  const live = await run(["answer", "--card", "c1", "--question", "int_1", "--answer", "A"], { threadId: null });
  assert.equal(live.exitCode, 0, "a live answer succeeds");
  assert.deepEqual(calls[0][0], "live", "the CLI calls the shared live door");
  assert.deepEqual(calls[0][1], { cardId: "c1", answers: [{ questionId: "int_1", answers: ["A"] }] }, "the live payload reaches the door unchanged");
  calls.length = 0;
  const recovery = await run(["answer", "--card", "c1", "--question", "expired:q1", "--answer", "A"], { threadId: null });
  assert.equal(recovery.exitCode, 0, "a recovery answer succeeds");
  assert.deepEqual(calls[0][0], "expired", "the CLI calls the shared recovery door");
  assert.deepEqual(calls[0][1], { cardId: "c1", answers: [{ questionId: "q1", answers: ["A"] }] }, "the recovery id loses its prefix on the way in");
  // The argv contract is parsed in lib/, so it is unit-testable without a host
  // and cannot drift from the server's own copy: an empty --answer value
  // survives parsing here and groups like any answer.
  const empty = await run(["answer", "--card", "c1", "--question", "int_1", "--answer", ""], { threadId: null });
  assert.equal(empty.exitCode, 0, "an empty answer parses and delegates");
}

console.log("question answer CLI test ok: one door per call, unknown flags refuse, shared handlers");

// A refusal must name the way out. Answering a recovery question with its
// bare row id used to say "No open question awaits an answer on this card" —
// blaming the card for a question that was open, and leaving the caller with
// no idea which id space was wanted. Every refusal here names the exit.
{
  const card = { id: "card_1", worker_thread_id: "thr_1" };
  const base = {
    bb: { sdk: { threads: { interactions: { respond: async () => undefined }, send: async () => undefined } }, realtime: { publish: () => undefined } },
    db: { prepare: () => ({ get: () => undefined, all: () => [], run: () => ({}) }) },
    errors: { cardNotFound: "missing", cardArchived: "archived" },
    getCard: () => card,
    isArchivedCard: () => false,
    syncPendingQuestionInbox: () => undefined,
    syncOpenQuestionInbox: async () => [],
    markInboxQuestionsAnswered: () => undefined,
    recordSplitAnswer: () => undefined,
    consumeAskContract: () => null,
    logCardComment: () => undefined,
    updateCard: () => undefined,
    hasOpenQuestions: () => false,
  };
  const liveDoor = createQuestionAnswers({
    ...base,
    pendingAsks: async () => [],
    openExpiredQuestionIds: () => ["qexp_1"],
  });
  const rawId = await liveDoor.answerQuestions({ cardId: "card_1", answers: [{ questionId: "qexp_1", answers: ["A"] }] });
  assert.match(rawId.error, /not a live interaction/, "a raw id aimed at a recovery question says which id space it wants");
  assert.match(rawId.error, /expired:<id>/, "the refusal names the accepted form too");
  const expiredDoor = createQuestionAnswers({
    ...base,
    db: {
      prepare: (sql) => (sql.includes("SELECT")
        ? { all: () => [
          { id: "old_1", thread_id: "t", question: "Q1?" },
          { id: "old_2", thread_id: "t", question: "Q2?" },
        ] }
        : { run: () => ({}) }),
      transaction: (fn) => fn,
    },
    pendingAsks: async () => [],
    openExpiredQuestionIds: () => [],
  });
  const partial = await expiredDoor.answerExpiredQuestions({ cardId: "card_1", answers: [{ questionId: "old_1", answers: ["A"] }] });
  assert.match(partial.error, /Still open: expired:old_2/, "an incomplete batch names exactly which questions are still open");
  const emptyDoor = createQuestionAnswers({ ...base, pendingAsks: async () => [], openExpiredQuestionIds: () => [] });
  const empty = await emptyDoor.answerExpiredQuestions({ cardId: "card_1", answers: [{ questionId: "old_9", answers: ["A"] }] });
  assert.match(empty.error, /Recovery questions use `expired:<id>`/, "the empty-refusal names the accepted form too");
}

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isExpiredQuestionId, expiredQuestionRowId, expiredQuestionId, parseAnswerArgs, buildAnswerPayload } from "../lib/question-answer-recording.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(join(root, "server.ts"), "utf8");

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
assert.match(server, /name: "answer",\n\s*summary: "Answer a card's pending questions/, "bb stelow answer is a contracted CLI verb");
assert.match(server, /if \(argv\[0\] === "answer"\)/, "the verb has a handler");

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

// Answering is atomic per door: mixing live and recovery ids in one call is
// refused instead of half-answering, because each door answers its own set.
assert.match(server, /Answer live and recovery questions in separate calls/, "the two doors are never mixed in one call");

// The CLI delegates to the shared implementations instead of re-implementing
// the recording rule — a second copy is how the two doors drifted before.
assert.match(server, /\? await answerQuestions\(\{ cardId: answerCard\.id, answers: live \}\)/, "the CLI calls the shared live door");
assert.match(server, /: await answerExpiredQuestions\(\{/, "the CLI calls the shared recovery door");
// The argv contract is parsed in lib/, so it is unit-testable without a host
// and cannot drift from the server's own copy.
assert.match(server, /const parsedAnswer = parseAnswerArgs\(argv\.slice\(1\)\);/, "the CLI delegates argv parsing to the tested lib helper");

console.log("question answer CLI test ok: one door per call, unknown flags refuse, shared handlers");

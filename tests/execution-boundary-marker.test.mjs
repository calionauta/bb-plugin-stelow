import assert from "node:assert/strict";
import { boundaryIdFromQuestion, boundaryQuestionShape } from "../lib/execution-boundary-marker.mjs";

// The marker is the protocol the host already depends on: the reconcile tells
// the worker to include `[Stelow boundary <id>]`, and that inclusion is what
// flips the run's needs-input-sent flag. Reading it back ties a card question
// to the boundary that produced it.
assert.equal(
  boundaryIdFromQuestion("First reaction? [Stelow boundary boundary-1]"),
  "boundary-1",
  "the boundary id is read back out of the question text",
);
assert.equal(
  boundaryIdFromQuestion("Two boundaries [Stelow boundary a-1] and [Stelow boundary b-2]"),
  "a-1",
  "the first marker wins — one question answers one boundary",
);
for (const [label, question] of [
  ["no marker", "Which layout should we keep?"],
  ["empty text", ""],
  ["a non-string", null],
  ["an unterminated marker", "[Stelow boundary abc"],
  ["a marker with no id", "[Stelow boundary ]"],
]) {
  assert.equal(boundaryIdFromQuestion(question), null, `${label} correlates to no boundary`);
}

// The regression this closes: the boundary `kind` was validated into the
// ledger and read by nobody, so a `reaction` boundary rendered exactly like a
// `confirmation` — a question could ask what someone's first reaction was
// while listing the options the agent had already generated, replacing the
// recorded reaction with the agent's own framing.
const reaction = boundaryQuestionShape("reaction", { hasOptions: false });
assert.equal(reaction.showOptions, false, "a reaction has nothing to pick between yet");
assert.match(reaction.heading, /First reaction/, "the heading says which moment this is");
assert.match(reaction.notice, /before the comparison/, "the notice explains the moment");

const reactionWithOptions = boundaryQuestionShape("reaction", { hasOptions: true });
assert.equal(reactionWithOptions.showOptions, false, "options authored on a reaction are still withheld");
assert.match(
  reactionWithOptions.notice,
  /withheld/,
  "withholding is named, not silent — a reader must not wonder where the options went",
);

const confirmation = boundaryQuestionShape("confirmation", { hasOptions: true });
assert.equal(confirmation.showOptions, true, "a confirmation is recorded after synthesis: the list is the point");
assert.equal(confirmation.notice, null, "a confirmation needs no explanation of a moment it does not have");

// Most card questions are ordinary ones. They must keep today's behaviour
// rather than inheriting boundary framing they have nothing to do with.
for (const kind of [null, undefined, "standard", "split", "", 7]) {
  assert.equal(boundaryQuestionShape(kind), null, `kind ${JSON.stringify(kind)} is not a boundary question`);
}

console.log("execution boundary marker test ok: a question is tied to its boundary, and a reaction never shows the options");

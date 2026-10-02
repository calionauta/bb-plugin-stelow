import assert from "node:assert/strict";
import { questionSubstanceGate } from "../lib/question-substance.mjs";
import { decideAskGate } from "../lib/ask-gate.mjs";

// Regression pin for card_48uuhus1, where a worker probing "is a question
// already pending?" ran `--question "ping" --option "a" --option "b"` and the
// host interrupted a human with a nonsense form. Every row below fails if the
// substance floor is deleted or weakened.

const allowed = questionSubstanceGate({ groups: [{ question: "Which scope ships first?", options: [{ label: "Scopes 1-3 first" }] }] });
assert.equal(allowed.allowed, true, "a real question with real options passes");
assert.equal(allowed.error, null, "a pass carries no error");

// The exact probe from the card.
const probe = questionSubstanceGate({ groups: [{ question: "ping", options: [{ label: "a" }, { label: "b" }] }] });
assert.equal(probe.allowed, false, "the probe that reached a human is refused");
assert.match(probe.error, /placeholder/, "the refusal names the actual problem");
assert.match(probe.error, /--force/, "the refusal names the way out");

// Substance, not a wordlist, is what carries it.
assert.equal(questionSubstanceGate({ groups: [{ question: "" }] }).allowed, false, "an empty question is refused");
assert.equal(questionSubstanceGate({ groups: [{ question: "   " }] }).allowed, false, "whitespace is not a question");
assert.equal(questionSubstanceGate({ groups: [] }).allowed, false, "no question groups is refused");
assert.equal(questionSubstanceGate({ groups: [{ question: "Ship the refactor now, or wait for the render check?" }] }).allowed, true,
  "a sentence without options still passes");

// The floor must not swallow legitimate short gate questions: "Approve?" and
// "Proceed?" are real asks a human answers at a review gate.
assert.equal(questionSubstanceGate({ groups: [{ question: "Approve?" }] }).allowed, true, "a short gate question is not a placeholder");
assert.equal(questionSubstanceGate({ groups: [{ question: "Proceed?" }] }).allowed, true, "a short yes/no question is not a placeholder");
assert.equal(questionSubstanceGate({ groups: [{ question: "Ship it?" }] }).allowed, true, "another short real question passes");

// Options are read by a human choosing between them.
assert.equal(questionSubstanceGate({ groups: [{ question: "Which scope ships first?", options: [{ label: "a" }] }] }).allowed, false,
  "single-letter options are refused");
assert.equal(questionSubstanceGate({ groups: [{ question: "Which scope ships first?", options: [{ label: "" }] }] }).allowed, false,
  "an empty option is refused");
assert.match(
  questionSubstanceGate({ groups: [{ question: "Which scope ships first?", options: [{ label: "b" }] }] }).error,
  /too short to name a decision/,
  "the option refusal explains what is wrong",
);
assert.equal(
  questionSubstanceGate({ groups: [{ question: "Which scope ships first?", options: ["Add the DOM render lane"] }] }).allowed,
  true,
  "bare string options are read too, not only shaped ones",
);

// Short options are NOT suspect on their own — "Yes"/"No" are the correct
// options at an Approve gate, and gate-ask-evidence commits to label-only
// options keeping working. A floor that refused them would break real gates.
assert.equal(questionSubstanceGate({ groups: [{ question: "Approve?", options: [{ label: "Yes" }, { label: "No" }] }] }).allowed, true,
  "Yes/No options at a gate pass");
assert.equal(questionSubstanceGate({ groups: [{ question: "Proceed?", options: [{ label: "ok" }, { label: "skip" }] }] }).allowed, true,
  "ok/skip labels are real choices");

// Case and spacing do not smuggle a placeholder through.
assert.equal(questionSubstanceGate({ groups: [{ question: "  PING  " }] }).allowed, false, "case and padding are normalized");
assert.equal(questionSubstanceGate({ groups: [{ question: "any  update" }] }).allowed, false, "extra internal spacing is normalized");

// Every refusal names a way out — a refusal without an exit is a deadlock
// with a good error message.
for (const groups of [[], [{ question: "ping" }], [{ question: "Which one?", options: [{ label: "a" }] }]]) {
  const refusal = questionSubstanceGate({ groups });
  assert.equal(refusal.allowed, false, `refuses ${JSON.stringify(groups)}`);
  assert.match(refusal.error, /--force/, "every substance refusal names the override");
}

// Precedence in the real dispatcher: duplicate wins, and --force overrides the
// floor but never the duplicate guard.
const base = {
  liveCount: 0,
  expiredCount: 0,
  kind: "build",
  intent: "feature",
  stage: "shape",
  tag: "standard",
  forced: false,
  groups: [{ question: "ping", options: [{ label: "a" }] }],
};
assert.match(decideAskGate({ ...base, liveCount: 1 }).reason ?? "", /already pending/, "duplicate still wins over the substance floor");
assert.equal(decideAskGate({ ...base, liveCount: 1 }).code, 1, "duplicate keeps its transient code");
assert.equal(decideAskGate(base).allowed, false, "the floor refuses through the dispatcher");
assert.equal(decideAskGate(base).code, 2, "a substance refusal is not retried blindly");
assert.equal(decideAskGate({ ...base, forced: true }).allowed, true, "--force overrides the floor");

console.log("question substance test ok: placeholder questions, degenerate options and the --force boundary pinned");
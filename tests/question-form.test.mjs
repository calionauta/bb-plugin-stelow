import assert from "node:assert/strict";
import {
  askTimelineLabels,
  artifactViewerModeForOption,
  describeAskSubmission,
  questionFormActions,
  questionFormItems,
  questionFormSubmission,
  submitBlockReason,
} from "../lib/question-presentation.mjs";

const interaction = {
  id: "ask_1",
  title: "Stelow questions (2)",
  payload: {
    questions: [
      {
        question: "Choose A",
        options: [
          { label: "A", artifact: "plans/a.md" },
          { label: "B", description: "other" },
        ],
      },
      {
        question: "Choose B",
        multiple: true,
        options: [{ label: "B1" }, { label: "B2" }],
      },
      { question: "Drop malformed", options: ["not an object", { description: "no label" }] },
    ],
  },
};

const single = questionFormItems({
  id: "ask_0",
  title: "Choose one",
  payload: { question: "Continue?", options: [{ label: "Yes" }, { label: "No" }] },
});
assert.equal(single.length, 1, "a single-question interaction stays single");
assert.equal(single[0].title, "Choose one", "a meaningful host title remains the form heading");
assert.equal(single[0].prompt, "Continue?", "the explicit question is the prompt");

const items = questionFormItems(interaction);
assert.deepEqual(items.map((item) => item.id), ["q0", "q1"], "only answerable questions become form items");
assert.equal(items[0].title, "", "the generated host title is not repeated above every question");
assert.equal(items[0].options[0].artifact.path, "plans/a.md", "one attached document normalizes for thread display");
assert.equal(items[0].options[1].artifact.path, "plans/a.md", "siblings inherit the attached document");
assert.equal(items[0].options[0].artifact.absolutePath, null, "thread questions never invent a card file target");
assert.equal(items[1].options[1].label, "B2", "object options preserve their submitted labels");
assert.equal(items[1].multiple, true, "batch selection flags survive normalization");

// The thread mapping rebuilt options with four fields and dropped both
// boolean flags on the floor — the same seam --selected fell through in
// cli-ask-gate (ask-intent-selected) and --needs-note fell through in
// parseAskIntent (ask-intent-needs-note). A conditional pick or an opt-out
// confirm then rendered as a plain pick in the thread: no chip, no gate,
// no checked rows.
const flagged = questionFormItems({
  id: "ask_2",
  title: "Stelow question",
  payload: {
    question: "Pick?",
    multiple: true,
    options: [
      { label: "A", selected: true },
      { label: "B", needsNote: true },
      { label: "C" },
    ],
  },
});
assert.deepEqual(
  flagged[0].options.map((option) => option.selected === true),
  [true, false, false],
  "preselected options travel checked to the thread stepper",
);
assert.deepEqual(
  flagged[0].options.map((option) => option.needsNote === true),
  [false, true, false],
  "conditional options travel conditional to the thread stepper",
);
for (const option of flagged[0].options) {
  if (option.label !== "A") assert.ok(!("selected" in option), "absence reads as unchecked — never invent a false");
  if (option.label !== "B") assert.ok(!("needsNote" in option), "absence reads as submittable — never invent a requirement");
}

assert.deepEqual(questionFormSubmission([["A"]], false), { answers: ["A"] }, "one question keeps the host's flat answer contract");
assert.deepEqual(questionFormSubmission([["A"], ["B1", "B2"]], true), { answers: [["A"], ["B1", "B2"]] }, "a batch keeps one dense answer list per question");
assert.deepEqual(questionFormSubmission([], false), { answers: [] }, "an empty single submission never invents an answer");

const calls = [];
const actions = questionFormActions(
  async (value) => calls.push(["submit", value]),
  async () => calls.push(["cancel"]),
);
await actions.submit([["A"]], false);
await actions.submit([["A"], ["B1", "B2"]], true);
await actions.cancel();
assert.deepEqual(calls, [
  ["submit", { answers: ["A"] }],
  ["submit", { answers: [["A"], ["B1", "B2"]] }],
  ["cancel"],
], "the form forwards single, batch, and cancel callbacks exactly once without changing their promise contract");

// Registration and slot wiring, proven through the contracts the shell and
// the stepper both read: one flat payload for a single question, one dense
// list per question for a batch, timeline labels that name the wait and the
// resolution, and a single footer gate over the batch answers.
{
  assert.deepEqual(askTimelineLabels({ batched: false }), {
    pending: "Stelow question — waiting for answer",
    completed: "Stelow question — answered",
  }, "a single question names its wait and its resolution");
  assert.deepEqual(askTimelineLabels({ batched: true, count: 2 }), {
    pending: "Stelow questions (2) — waiting for answers",
    completed: "Stelow questions (2) — answered",
  }, "a batch counts its questions in both labels");
  assert.deepEqual(describeAskSubmission({ answers: ["A"] }), {
    title: "Stelow answer",
    detail: "- A",
  }, "a single submission describes the decision");
  assert.deepEqual(describeAskSubmission({ answers: [["A"], ["B1", "B2"]] }), {
    title: "Stelow answers (2 of 2)",
    detail: "- Q1: A\n- Q2: B1, B2",
  }, "a batch submission keeps one line per question");
  assert.deepEqual(describeAskSubmission({ answers: [] }), { title: "Stelow answer (skipped)" }, "an empty submission reads as skipped, never invented");
}
// The footer gate reads one shared block rule over the batch answers: one
// submit, enabled only when every question carries a decision.
{
  const batch = [
    { id: "q0", options: [{ label: "A" }, { label: "B" }] },
    { id: "q1", options: [{ label: "C", needsNote: true }, { label: "D" }] },
  ];
  assert.equal(submitBlockReason(batch, { q0: ["A"], q1: ["D"] }, {}), null, "decided plain picks submit");
  assert.match(
    submitBlockReason(batch, { q0: ["A"], q1: ["C"] }, {}),
    /needs a note/,
    "a picked conditional without its note blocks the one submit",
  );
  assert.equal(submitBlockReason(batch, { q0: ["A"], q1: ["C"] }, { q1: "drop the extras" }), null, "the note unblocks");
  assert.equal(artifactViewerModeForOption("Approve plan"), "review", "the approval reads before deciding");
}

console.log("question form test ok: parsing, payload, submit, cancel, and slot wiring are covered");

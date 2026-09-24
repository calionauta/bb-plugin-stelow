import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  questionFormActions,
  questionFormItems,
  questionFormSubmission,
} from "../lib/question-form.mjs";

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

const app = readFileSync(new URL("../app.tsx", import.meta.url), "utf8");
const form = readFileSync(new URL("../components/conversation/question-form.tsx", import.meta.url), "utf8");
const button = readFileSync(new URL("../components/ui/button.tsx", import.meta.url), "utf8");
const batch = readFileSync(new URL("../components/conversation/question-batch.tsx", import.meta.url), "utf8");
assert.match(
  app,
  /import \{ registerPendingInteraction \} from "\.\/components\/conversation\/question-form"/,
  "the app shell imports the extracted registration boundary",
);
assert.match(app, /registerPendingInteraction\(app\);/, "the app registers pending questions through the conversation boundary");
assert.doesNotMatch(app, /function QuestionForm\(/, "the form body no longer remains in the shell");
assert.match(
  form,
  /pendingInteraction\(\{\s*id: "stelow-question",\s*component: QuestionForm,/,
  "the extracted registration keeps the renderer id and component contract",
);
assert.match(form, /const batched = items\.length > 1;/, "the host payload shape follows the rendered question count");
assert.match(form, /<Button variant="outline" onClick=\{\(\) => void actions\.cancel\(\)\}>/, "cancel uses the shared button control");
assert.match(button, /const Comp = asChild \? Slot : "button";/, "the shared button is natively keyboard-operable by default");
assert.match(
  batch,
  /sel\.isLastQuestion \? <Button size="sm" disabled=\{!sel\.complete \|\| busy\}/,
  "submit uses the shared native button after every question is decided",
);
assert.match(
  form,
  /<BatchStepper[\s\S]*onSubmit=\{\(answers\) => void actions\.submit\(answers, batched\)\}/,
  "the shared submit control reaches the host completion callback",
);

console.log("question form test ok: parsing, payload, submit, cancel, and slot wiring are covered");

import assert from "node:assert/strict";
import { SPLIT_QUESTION_GUIDANCE, isSplitQuestion, splitOptionDescription, splitQuestionText, splitSelectionNotice } from "../lib/split-question-presentation.mjs";
import { askTimelineLabels, describeAskSubmission, englishQuestionContentError, questionCopy } from "../lib/question-presentation.mjs";

const original = "Which deliveries should split?";
const old = `${original}\n\nSelect the deliveries that should become new independent cards. Anything you do not select stays in this card; nothing is discarded. Choose "Keep as one card" to keep the entire request together.`;
assert.equal(splitQuestionText(old), `${original}\n\n${SPLIT_QUESTION_GUIDANCE}`, "old timed-out split copy upgrades on display without changing its stored answer identity");
assert.equal(splitOptionDescription("Own the frontend.\n\nSelecting this creates one independent card for this delivery; unselected deliveries remain in this card."), "Own the frontend.", "legacy generated option consequence is not repeated");
assert.equal(splitOptionDescription("Two\n\nAuthor paragraphs stay."), "Two\n\nAuthor paragraphs stay.", "author-written scope is preserved");
assert.equal(isSplitQuestion({ multiple: true, options: [{ label: "A" }, { label: "Keep as one card" }] }), true, "the keep option tags split presentation");
assert.equal(isSplitQuestion({ multiple: false, options: [{ label: "Keep as one card" }] }), false, "ordinary single questions are not restyled as a split");
assert.equal(isSplitQuestion({ kind: "split", multiple: false, options: [] }), true, "new payloads carry an explicit semantic kind");
const choices = [{ label: "A" }, { label: "B" }, { label: "C" }, { label: "Keep as one card" }];
assert.match(splitSelectionNotice(choices, ["A", "B", "C"]).text, /archive this card/, "selecting every delivery warns that the parent will archive before submit");
assert.match(splitSelectionNotice(choices, ["A"]).text, /stays active with the remaining work/, "partial selection confirms the parent remains");
assert.match(splitSelectionNotice(choices, ["Keep as one card"]).text, /no child cards/, "the exclusive keep alternative explains its result contextually");
assert.equal(questionCopy().recoveryHeading, "Waiting for you", "recovery uses one concise, English-only status instead of repeated timeout prose");
assert.equal(englishQuestionContentError("Which delivery should split?", [{ label: "Refactor app.tsx", description: "Break the frontend into modules." }]), null, "English question content is accepted");
assert.match(englishQuestionContentError("Quais entregáveis devem virar cards?", [{ label: "Refatorar app.tsx", description: "Decompor o frontend." }]) ?? "", /must be written in English/, "Portuguese structured question content is refused before it reaches a card");

// Timeline labels: the pending row names the wait, the settled row the resolution.
assert.deepEqual(askTimelineLabels({ batched: false, count: 1 }), {
  pending: "Stelow question — waiting for answer",
  completed: "Stelow question — answered",
}, "single asks read as one wait");
assert.deepEqual(askTimelineLabels({ batched: true, count: 3 }), {
  pending: "Stelow questions (3) — waiting for answers",
  completed: "Stelow questions (3) — answered",
}, "batches count their questions");
for (const labels of [askTimelineLabels({ batched: false }), askTimelineLabels({ batched: true, count: 12 })]) {
  assert.ok(labels.pending.length <= 80 && labels.completed.length <= 80, "timeline labels fit BB's row cap");
}

// Submission descriptions: decisions only, never payload content or throws.
assert.deepEqual(describeAskSubmission({ answers: ["Ship it"] }), {
  title: "Stelow answer",
  detail: "- Ship it",
}, "a single answer names its choice");
assert.deepEqual(describeAskSubmission({ answers: [] }), { title: "Stelow answer (skipped)" }, "a skip reads as a skip, not an empty answer");
assert.deepEqual(describeAskSubmission({ answers: [["A", "B"], []] }), {
  title: "Stelow answers (1 of 2)",
  detail: "- Q1: A, B\n- Q2: skipped",
}, "a batch counts answered questions and names skips");
assert.deepEqual(describeAskSubmission({ answers: [["  Line\nbreak  "]] }), {
  title: "Stelow answers (1 of 1)",
  detail: "- Q1: Line break",
}, "labels collapse whitespace instead of breaking the row");
assert.deepEqual(describeAskSubmission(null), {}, "unknown shapes fall back to BB's default labels");
assert.deepEqual(describeAskSubmission({ answers: "nope" }), {}, "non-array answers fall back to BB's default labels");
assert.deepEqual(describeAskSubmission({ boom: true }), {}, "missing answers fall back to BB's default labels");

console.log("split-question presentation test ok: legacy copy upgrades without losing answer identity");

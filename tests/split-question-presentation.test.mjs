import assert from "node:assert/strict";
import { SPLIT_QUESTION_GUIDANCE, isSplitQuestion, splitOptionDescription, splitQuestionText, splitSelectionNotice } from "../lib/split-question-presentation.mjs";
import { questionCopy } from "../lib/question-presentation.mjs";

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

console.log("split-question presentation test ok: legacy copy upgrades without losing answer identity");

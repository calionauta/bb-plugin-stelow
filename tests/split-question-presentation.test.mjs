import assert from "node:assert/strict";
import { SPLIT_QUESTION_GUIDANCE, isSplitQuestion, splitOptionDescription, splitQuestionText } from "../lib/split-question-presentation.mjs";

const original = "Which deliveries should split?";
const old = `${original}\n\nSelect the deliveries that should become new independent cards. Anything you do not select stays in this card; nothing is discarded. Choose \"Keep as one card\" to keep the entire request together.`;
assert.equal(splitQuestionText(old), `${original}\n\n${SPLIT_QUESTION_GUIDANCE}`, "old timed-out split copy upgrades on display without changing its stored answer identity");
assert.equal(splitOptionDescription("Own the frontend.\n\nSelecting this creates one independent card for this delivery; unselected deliveries remain in this card."), "Own the frontend.", "legacy generated option consequence is not repeated");
assert.equal(splitOptionDescription("Two\n\nAuthor paragraphs stay."), "Two\n\nAuthor paragraphs stay.", "author-written scope is preserved");
assert.equal(isSplitQuestion({ multiple: true, options: [{ label: "A" }, { label: "Keep as one card" }] }), true, "the keep option tags split presentation");
assert.equal(isSplitQuestion({ multiple: false, options: [{ label: "Keep as one card" }] }), false, "ordinary single questions are not restyled as a split");

console.log("split-question presentation test ok: legacy copy upgrades without losing answer identity");

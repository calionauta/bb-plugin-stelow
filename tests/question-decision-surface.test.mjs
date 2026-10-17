import assert from "node:assert/strict";
import {
  OPTION_DESCRIPTION_PREVIEW_LIMIT,
  artifactViewerModeForOption,
  splitOptionDescriptionPreview,
  submitBlockReason,
} from "../lib/question-presentation.mjs";
import { cleanOptions } from "../lib/question-batch.mjs";

// Two defects found by looking at a real card, both from the same cause: the
// decision surface pushed the decision itself out of reach. The contracts
// below own those decisions in lib/, where they are unit-testable without a
// host — the rendered disclosures read these same helpers, so the policy
// cannot drift from the markup.

// 1. Short previews must be readable at a glance: a 27-104 character preview
// behind a click costs two clicks for less information than the label beside
// it. The glance cap keeps previews glances (not documents); cleaning keeps a
// short preview verbatim so there is something inline to read.
assert.ok(OPTION_DESCRIPTION_PREVIEW_LIMIT >= 120, "the description glance covers the real walls that were unreadable");
{
  const short = splitOptionDescriptionPreview("Two lines of prose, under the glance.");
  assert.equal(short.tail, null, "a short description needs no disclosure");
  const wall = splitOptionDescriptionPreview("w ".repeat(400));
  assert.ok(wall.head.length > 0 && wall.tail !== null, "a 400-token wall splits: the decision stays at a glance, the rest is one click away");
  const cleaned = cleanOptions([{ label: "A", preview: "27-char glance here" }]);
  assert.equal(cleaned[0].preview, "27-char glance here", "a short preview survives cleaning verbatim");
  const blank = cleanOptions([{ label: "A", preview: "   " }]);
  assert.equal(blank[0].preview, null, "a whitespace preview is not evidence and never renders");
}

// 2. The consequence is stated before the evidence: the reader's first
// decision is whether the change MATTERS. The submit gate names the missing
// piece before any file list could — a blocked submit says what to DO.
{
  const questions = [{ id: "q0", options: [{ label: "Trim the scope", needsNote: true }] }];
  assert.match(
    submitBlockReason(questions, { q0: ["Trim the scope"] }, {}),
    /needs a note/,
    "a picked conditional option blocks with the action, not the evidence",
  );
  assert.equal(submitBlockReason(questions, { q0: ["Trim the scope"] }, { q0: "drop discretionary items" }), null, "a note unblocks");
  assert.equal(submitBlockReason(questions, { q0: [] }, {}), null, "an unpicked conditional never blocks");
}

// 3. Option descriptions at 150+ characters each turned a 4-option question
// into a wall nobody reads before picking. The row splits instead of
// printing inline, and the viewer mode follows the option's decision —
// approvals read, everything else can quote-and-comment.
{
  assert.equal(artifactViewerModeForOption("Approve plan"), "review", "an approval opens read-only");
  assert.equal(artifactViewerModeForOption("Request changes"), "comment", "a change request keeps the comment path");
  const split = splitOptionDescriptionPreview("x".repeat(OPTION_DESCRIPTION_PREVIEW_LIMIT + 10));
  assert.ok(split.tail && split.tail.length > 0, "over-limit text always has a tail behind the disclosure");
}

console.log("question decision surface test ok: previews readable at a glance, staleness says what to do first");

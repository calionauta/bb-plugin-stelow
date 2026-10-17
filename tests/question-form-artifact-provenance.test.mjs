import assert from "node:assert/strict";
import { artifactViewerModeForOption, questionFormItems, sharedQuestionArtifact } from "../lib/question-presentation.mjs";

// Context: a worker attached `--artifact` to ONE option. The host's
// inheritance rule then handed that same file to every sibling, so four rows
// each rendered "Open document" pointing at one shared brief. Nothing said
// so, and the reader could not tell what any of the four documents actually
// was — the filename only existed in a hover-only title. That reads as a
// broken control and tells the reader nothing about what distinguishes the
// options.
const own = (label, path) => ({ label, description: "", preview: null, artifact: path });
const question = (options) => questionFormItems({ id: "q1", title: "t", payload: { question: "p", options, multiple: false } })[0];

// The option that brought the document says so.
const mixed = question([
  own("Hybrid A+C", "interfaces/interfaces.md"),
  own("A stacked blocks", null),
  own("B compact table", null),
]);
assert.equal(mixed.options[0].artifactInherited, false, "the option that brought the document owns it");
assert.equal(mixed.options[1].artifactInherited, true, "an option with no document of its own is marked as inherited");
assert.equal(mixed.options[2].artifactInherited, true, "every inheriting option is marked, not just the first");

// The inherited path still resolves — inheritance exists so nobody is left
// with nothing to open. The flag describes provenance, it does not remove
// the affordance.
assert.equal(mixed.options[1].artifact?.path, "interfaces/interfaces.md", "an inherited option still opens the shared brief");

// When NO option brought a document, nothing is invented and nothing is
// marked: there is no shared brief to be confusing about.
const bare = question([own("A", null), own("B", null)]);
assert.equal(bare.options[0].artifact, null, "no document is invented when none was attached");
assert.equal(bare.options[0].artifactInherited, false, "nothing is marked inherited when there is nothing to inherit");

// Per-option documents stay per-option. This is the contract the interface
// skill states: each option carries its own reference, so the reader can
// tell them apart. Collapse these and every row reads as the same evidence.
const perOption = question([
  own("A stacked blocks", "interfaces/proposal-a.md"),
  own("B compact table", "interfaces/proposal-b.md"),
]);
assert.equal(perOption.options[0].artifactInherited, false, "a document attached per option is owned, not inherited");
assert.equal(perOption.options[1].artifactInherited, false, "the second per-option document is owned too");
assert.equal(perOption.options[0].artifact?.path, "interfaces/proposal-a.md", "each option keeps its own path");
assert.equal(perOption.options[1].artifact?.path, "interfaces/proposal-b.md", "the second option keeps its own path");

console.log("question form artifact provenance test ok: an inherited brief is marked, a per-option document is not");

// The rendered control is where the reader actually learns what a row opens.
// Proven behaviorally through the contracts the row reads: an inherited
// brief resolves to ONE shared document (so one embedded reader replaces N
// identical per-row buttons), per-option documents stay distinct, and the
// viewer mode follows the decision — approvals read, changes can comment.
{
  const shared = sharedQuestionArtifact(mixed.options);
  assert.equal(shared?.path, "interfaces/interfaces.md", "a shared brief resolves to one document, not N buttons");
  assert.equal(sharedQuestionArtifact(perOption.options), null, "competing proposals keep their own documents — no shared reader");
  assert.equal(sharedQuestionArtifact(bare.options), null, "no document means no reader and nothing to mislabel");
  assert.equal(artifactViewerModeForOption("Approve plan"), "review", "the approval reads");
  assert.equal(artifactViewerModeForOption("Request changes"), "comment", "the change request keeps the comment path");
  assert.equal(mixed.options[1].artifactInherited, true, "the shared reader is marked shared, never presented as the option's own");
}

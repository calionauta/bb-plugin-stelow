import assert from "node:assert/strict";
import { GATE_EVIDENCE_STAGES, PER_OPTION_EVIDENCE_STAGES, gateEvidenceGate } from "../lib/question-evidence.mjs";
import { decideAskGate } from "../lib/question-gate.mjs";
import { validateAskContracts } from "../lib/question-contracts.mjs";
import { inheritAskArtifact } from "../lib/question-batch.mjs";
import {
  artifactViewerModeForOption,
  questionFormItems,
  sharedQuestionArtifact,
} from "../lib/question-presentation.mjs";
import { selectBuildReviewArtifact } from "../lib/build-review-target.mjs";
import { optionSectionExcerpt } from "../lib/option-anchor.mjs";

// A review gate with nothing to review is refused deterministically:
// "approve the plan" must carry the plan. Label-only options keep working
// everywhere that is not a gate stage.
assert.deepEqual(GATE_EVIDENCE_STAGES, ["gate", "int-gate", "selection", "plan-gate"], "the gate stages are one const");

const bareAtPlanGate = {
  kind: "build",
  stage: "plan-gate",
  tag: "standard",
  forced: false,
  groups: [{ question: "Approve the plan?", options: [{ label: "Approve", description: "go", preview: null, artifact: null }] }],
};
assert.equal(gateEvidenceGate(bareAtPlanGate).allowed, false, "a gateless plan approval is refused");
assert.match(gateEvidenceGate(bareAtPlanGate).error, /nothing to review/, "the refusal names the failure");
assert.match(gateEvidenceGate(bareAtPlanGate).error, /--artifact/, "the refusal names the fix");
assert.match(gateEvidenceGate(bareAtPlanGate).error, /--force/, "the refusal names the explicit override");

const withFile = structuredClone(bareAtPlanGate);
withFile.groups[0].options[0].artifact = { path: "scopes.md" };
assert.equal(gateEvidenceGate(withFile).allowed, true, "one attached file evidences the whole ask");

const withGlance = structuredClone(bareAtPlanGate);
withGlance.groups[0].options[0].preview = "10 scopes, linear.";
assert.equal(gateEvidenceGate(withGlance).allowed, true, "an inline preview counts for short content");

const blankPreview = structuredClone(bareAtPlanGate);
blankPreview.groups[0].options[0].preview = "   ";
assert.equal(gateEvidenceGate(blankPreview).allowed, false, "a whitespace preview is not evidence");

// Everything else passes untouched: explicit force, other stages, other
// tracks, split mechanics, and label-only options outside gates.
assert.equal(gateEvidenceGate({ ...bareAtPlanGate, forced: true }).allowed, true, "--force opts out");
assert.equal(gateEvidenceGate({ ...bareAtPlanGate, tag: "split" }).allowed, true, "split mechanics keep their own gate");
assert.equal(gateEvidenceGate({ ...bareAtPlanGate, stage: "planning" }).allowed, true, "planning questions are untouched");
assert.equal(gateEvidenceGate({ ...bareAtPlanGate, stage: "triage" }).allowed, true, "triage questions are untouched");
assert.equal(gateEvidenceGate({ ...bareAtPlanGate, kind: "research" }).allowed, true, "other tracks are untouched");
assert.equal(gateEvidenceGate({ ...bareAtPlanGate, groups: [] }).allowed, false, "empty groups at a gate are still gateless");

// Host wiring (behavioral): refused before anything persists, on slug truth —
// decided inside the shared dispatcher (precedence pinned in
// ask-gate.test.mjs). The dispatcher runs duplicate first, so a second form
// while one is answerable refuses as transient even when gateless; --force
// bypasses evidence but never the duplicate guard.
{
  const gateless = {
    liveCount: 0,
    expiredCount: 0,
    kind: "build",
    stage: "plan-gate",
    tag: "standard",
    forced: false,
    groups: [{ question: "Approve the plan?", options: [{ label: "Approve", description: "go", preview: null, artifact: null }] }],
  };
  const refused = decideAskGate(gateless);
  assert.equal(refused.allowed, false, "the ask handler decides through the shared dispatcher (evidence gate inside)");
  assert.match(refused.reason, /nothing to review/, "the gate reads slug truth: plan-gate refuses");
  assert.equal(decideAskGate({ ...gateless, forced: true }).allowed, true, "--force opts out through the dispatcher");
  assert.equal(decideAskGate({ ...gateless, stage: "planning" }).allowed, true, "planning questions are untouched");
  const duplicate = decideAskGate({ ...gateless, liveCount: 1 });
  assert.equal(duplicate.allowed, false, "a second form while one is answerable refuses first");
  assert.equal(duplicate.code, 1, "the duplicate refusal is transient — retry the same ask once");
}
// Every option resolves through one inheritance rule, so an approval can never
// render without the document its siblings were given. The old all-or-nothing
// fallback only covered all-label-only asks, which is exactly how the
// 2026-09-15 plan gate shipped an unreadable "Approve plan".
{
  const inherited = inheritAskArtifact([
    { label: "Approve plan", artifact: null },
    { label: "Request changes", artifact: { path: "plans/spec.md" } },
  ]);
  assert.equal(inherited[0]?.path, "plans/spec.md", "the approval inherits the document the ask attached to its sibling");
  assert.equal(
    inheritAskArtifact([{ label: "A" }, { label: "B" }]).every((entry) => entry === null),
    true,
    "nothing attached yields no affordance, so manifest recovery still applies",
  );
  // Optional contract declarations are validated, never enforced here:
  // unknown ids with a readable checklist refuse with the valid list, and
  // without one the ask records raw (fail-open).
  const bad = validateAskContracts([{ contractId: "nope" }], [{ id: "interface-pick", kind: "human-ask" }]);
  assert.equal(bad.ok, false, "an unknown contract with a readable checklist refuses");
  assert.match(bad.error, /interface-pick/, "the refusal names the valid ids");
  assert.equal(validateAskContracts([{ contractId: "nope" }], null).ok, true, "without a checklist the ask records raw");
  assert.equal(validateAskContracts([], [{ id: "interface-pick", kind: "human-ask" }]).ok, true, "no declarations, no validation");
}

// Hero entry (behavioral): the document under decision wins over a manifest
// guess. Board position deliberately stays behind while a question waits, so
// the pending question's own option artifact must come first; manifest stage
// match is second, newest artifact only the last resort. The recovery scores
// candidates by which document actually NAMES the options.
{
  const card = { stage: "plan-gate" };
  const manifest = { role: "plan", stage: "planning", path: "plans/spec.md" };
  const questionDoc = { path: "plans/asked.md" };
  const detailWithQuestion = {
    pendingQuestions: [{ options: [{ label: "Approve", artifact: questionDoc }, { label: "Changes", artifact: null }] }],
    expiredQuestions: [],
    artifacts: [manifest],
  };
  assert.deepEqual(
    selectBuildReviewArtifact({ detail: detailWithQuestion, card, heroKind: "decision" }),
    questionDoc,
    "the pending document wins over the manifest guess",
  );
  const detailManifestOnly = { pendingQuestions: [], expiredQuestions: [], artifacts: [manifest] };
  assert.deepEqual(
    selectBuildReviewArtifact({ detail: detailManifestOnly, card, heroKind: "decision" }),
    manifest,
    "without a pending document the stage match serves",
  );
  const detailEvidenceOnly = { pendingQuestions: [], expiredQuestions: [], artifacts: [{ role: "evidence", stage: "planning", path: "ev.md" }] };
  assert.equal(
    selectBuildReviewArtifact({ detail: detailEvidenceOnly, card, heroKind: "decision" }),
    null,
    "evidence never serves as the review document",
  );
  assert.equal(
    selectBuildReviewArtifact({ detail: detailManifestOnly, card, heroKind: "other" }),
    null,
    "without a pending question only the decision hero reads the manifest",
  );
  const doc = "# Interface\n\n## Stacked blocks\n\nA layout.\n\n## Compact table\n\nAnother layout.\n";
  assert.ok(optionSectionExcerpt(doc, "Stacked blocks"), "the document naming the option resolves to its section");
  assert.equal(optionSectionExcerpt(doc, "Nonexistent direction"), null, "a document without the option scores nothing, so it loses recovery");
  // Approval and change options select their viewer mode: approvals read,
  // everything else keeps the quote-and-comment path.
  assert.equal(artifactViewerModeForOption("Approve plan"), "review", "the approval reads");
  assert.equal(artifactViewerModeForOption("Request changes"), "comment", "the change request keeps the comment path");
}

// Selection compares proposals: one evidenced option must not launder
// blind siblings (upstream Pattern 2 fills every option). Other gates
// review one shared document, so "Approve" stays legitimately label-only.
assert.deepEqual(PER_OPTION_EVIDENCE_STAGES, ["selection"], "per-option evidence is selection-only");
const selectionAsk = {
  kind: "build",
  stage: "selection",
  tag: "standard",
  forced: false,
  groups: [{
    question: "Which interface direction?",
    options: [
      { label: "A", description: "a", preview: "wireframe", artifact: { path: "proposal-a.md" } },
      { label: "Hybrid", description: "h", preview: "wireframe", artifact: { path: "interfaces.md" } },
      { label: "C", description: "c", preview: null, artifact: null },
    ],
  }],
};
assert.equal(gateEvidenceGate(selectionAsk).allowed, false, "one blind option fails selection");
assert.match(gateEvidenceGate(selectionAsk).error, /every option/, "the refusal names the per-option fix");
const fullSelection = structuredClone(selectionAsk);
fullSelection.groups[0].options[2].preview = "wireframe";
assert.equal(gateEvidenceGate(fullSelection).allowed, true, "fully evidenced selection passes");
const mixedPlanGate = {
  kind: "build",
  stage: "plan-gate",
  tag: "standard",
  forced: false,
  groups: [{
    question: "Approve the plan?",
    options: [
      { label: "Approve", description: "go", preview: null, artifact: null },
      { label: "Request changes", description: "no", preview: "3 scopes", artifact: null },
    ],
  }],
};
assert.equal(gateEvidenceGate(mixedPlanGate).allowed, true, "label-only approvals stay valid at plan-gate");

console.log("gate ask evidence test ok: gates require evidence, everything else untouched");

// Provenance of a per-option document (behavioral). Two paths put a document
// on an option that never attached one: the inheritance rule, and the manifest
// recovery that fires when the ask carried nothing at all. A real card hit the
// SECOND one — the worker attached nothing, the host injected `interfaces.md`,
// and all four options rendered one shared file as if it were each option's
// own evidence. The thread path applies the same rule as the server, so the
// card and a live question never disagree.
{
  const thread = questionFormItems({
    id: "ask_1",
    title: "Which direction?",
    payload: {
      question: "Pick one.",
      options: [
        { label: "Hybrid", artifact: "interfaces/interfaces.md" },
        { label: "Stacked", artifact: null },
      ],
    },
  })[0];
  assert.equal(thread.options[0].artifactInherited, false, "an option that attached its own document owns it");
  assert.equal(thread.options[1].artifactInherited, true, "an option that borrowed its document is marked, and one that attached its own is not");
  assert.equal(thread.options[1].artifact?.path, "interfaces/interfaces.md", "the borrowed document still opens");
  assert.equal(sharedQuestionArtifact(thread.options)?.path, "interfaces/interfaces.md", "one shared brief resolves to one reader, not per-row copies");
}

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GATE_EVIDENCE_STAGES, gateEvidenceGate } from "../lib/gate-ask-evidence.mjs";

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

// Host wiring: refused before anything persists, on slug truth.
const serverSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../server.ts"), "utf8");
assert.match(serverSource, /gateEvidenceGate\(\{/, "the ask handler decides through the shared gate");
assert.match(serverSource, /stage: gateCard \? await cardStageSlug\(gateCard\) : null/, "the gate reads slug truth");
assert.match(serverSource, /async function fallbackGateAskArtifact/, "older gate asks recover their manifest evidence for per-option review");
assert.match(serverSource, /question\.options\.every\(\(option\) => !option\.artifact\)/, "only all-legacy label-only asks receive the fallback");

// Hero fallback: with no manifest artifact, the card offers the first
// evidence attached to a pending or recoverable question instead.
const appSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../app.tsx"), "utf8");
assert.match(appSource, /pendingQuestionArtifact/, "the hero falls back to question-attached evidence");
assert.match(appSource, /artifactViewerModeForOption/, "approval and change options select their appropriate viewer mode");
assert.match(appSource, /mode === "comment"/, "the review-only viewer hides comment and editor controls");

console.log("gate ask evidence test ok: gates require evidence, everything else untouched");

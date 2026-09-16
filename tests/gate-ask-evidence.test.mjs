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
// Every option resolves through one path, so an approval can never render
// without the document its siblings were given. The old ".every(option =>
// !option.artifact)" fallback only covered all-label-only asks, which is
// exactly how the 2026-09-15 plan gate shipped an unreadable "Approve plan".
assert.match(serverSource, /async function resolveAskOptions/, "one resolver owns per-option artifacts");
assert.match(serverSource, /inheritAskArtifact/, "per-option artifacts inherit the ask's document");
assert.match(serverSource, /const inherited = inheritAskArtifact\(options\)/, "the resolver inherits before resolving");
assert.doesNotMatch(serverSource, /options\.every\(\(option\) => !option\.artifact\)/, "the all-or-nothing fallback is gone");

// Hero entry: the document under decision wins over a manifest guess. Board
// position deliberately stays behind while a question waits, so the pending
// question's own option artifact must come first; manifest stage match is
// second, newest artifact only the last resort.
const appSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../app.tsx"), "utf8");
assert.match(appSource, /pendingQuestionArtifact/, "the hero reads question-attached evidence");
assert.match(appSource, /pendingQuestionArtifact \?\? detail\.artifacts\.find/, "the pending document wins over the manifest guess");
assert.match(appSource, /artifactViewerModeForOption/, "approval and change options select their appropriate viewer mode");
assert.match(appSource, /mode === "comment"/, "the review-only viewer hides comment and editor controls");
assert.match(appSource, /const inherited = inheritAskArtifact\(list\)/, "thread questions inherit per-option evidence too");
// The option's document affordance is the shared outline Button, so it can
// never drift back into a hand-rolled third color beside the amber panel.
assert.match(appSource, /variant="outline"\s+size="sm"\s+onClick=\{\(\) => onOpenArtifact\(/, "the document control uses the shared outline treatment");
assert.doesNotMatch(appSource, /border-emerald-500\/40 bg-emerald-500\/10 px-3/, "the emerald slab beside the amber options is gone");

console.log("gate ask evidence test ok: gates require evidence, everything else untouched");

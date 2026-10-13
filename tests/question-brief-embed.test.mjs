import assert from "node:assert/strict";
import { sharedQuestionArtifact } from "../lib/question-presentation.mjs";

// One brief behind N options: uniform documents embed a single reader,
// anything ambiguous keeps the per-row buttons (null = rows as before).
const doc = (overrides = {}) => ({ path: "docs/brief.md", display: "brief.md", absolutePath: "/work/docs/brief.md", hostId: null, ...overrides });
const opt = (artifact, label = "Approve") => ({ label, description: "d", preview: null, artifact });

// Uniform artifacts (same path) collapse to the one document.
const uniform = [opt(doc()), opt(doc()), opt(doc())];
assert.equal(sharedQuestionArtifact(uniform), uniform[0].artifact, "uniform artifacts return the shared doc");

// Same file via absolutePath with different path spellings is still one file.
const variants = [opt(doc({ path: "docs/brief.md" })), opt(doc({ path: "./docs//brief.md" })), opt(doc({ path: "docs/../docs/brief.md" }))];
assert.equal(sharedQuestionArtifact(variants), variants[0].artifact, "absolutePath identity survives path respellings");

// Genuinely different documents keep their per-row buttons.
const mixed = [opt(doc()), opt(doc({ path: "docs/other.md", display: "other.md", absolutePath: "/work/docs/other.md" }))];
assert.equal(sharedQuestionArtifact(mixed), null, "mixed documents return null");

// One option missing its document is ambiguous, not uniform.
assert.equal(sharedQuestionArtifact([opt(doc()), opt(null)]), null, "a null artifact returns null");
assert.equal(sharedQuestionArtifact([opt(doc()), { label: "Approve", description: "d", preview: null }]), null, "a missing artifact returns null");

// No options, or no option list, is not a shared brief.
assert.equal(sharedQuestionArtifact([]), null, "empty options return null");
for (const input of [null, undefined, "brief", 42, {}]) {
  assert.equal(sharedQuestionArtifact(input), null, `non-array input ${JSON.stringify(input)} returns null`);
}

// Non-object entries degrade to null instead of throwing.
assert.equal(sharedQuestionArtifact([null, "Approve", 42]), null, "non-object entries return null without throwing");
assert.equal(sharedQuestionArtifact([opt(doc()), null]), null, "a null entry beside a doc returns null");

// An artifact with empty path AND empty absolutePath has no identity to match on.
const blank = { path: "", display: "brief.md", absolutePath: "", hostId: null };
assert.equal(sharedQuestionArtifact([opt({ ...blank }), opt({ ...blank })]), null, "empty path and absolutePath return null");
assert.equal(sharedQuestionArtifact([opt({ ...blank, absolutePath: null })]), null, "null absolutePath with empty path returns null");

console.log("question brief embed test ok: sharedQuestionArtifact embeds one brief only when every option names one file");

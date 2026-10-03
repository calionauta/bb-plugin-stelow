import assert from "node:assert/strict";
import { TECHNIQUE_CATALOG, techniqueById } from "../lib/stage-catalog.mjs";
import { contractForExplore } from "../lib/artifact-contracts.mjs";

const alternatives = techniqueById("architecture-alternatives");
assert.ok(alternatives, "architecture-alternatives resolves");
assert.equal(alternatives.skill, "stelow-workflow-architecture-alternatives", "Explore delegates to the construction exploration skill");
assert.ok(TECHNIQUE_CATALOG.some((entry) => entry.id === "architecture-alternatives"), "Architecture alternatives is in the Explore catalog");

const contrast = techniqueById("architecture-contrast");
assert.ok(contrast, "architecture-contrast resolves");
assert.equal(contrast.skill, "stelow-workflow-architecture-contrast", "Explore delegates to the invariants-first decision skill");
assert.ok(TECHNIQUE_CATALOG.some((entry) => entry.id === "architecture-contrast"), "Architecture contrast is in the Explore catalog");
assert.ok(Array.isArray(contrast.optionalEvidence) && contrast.optionalEvidence.includes("architecture/contrast.json"), "contrast carries optional evidence");

// Contracts exist for both, so thin work fails instead of passing silently.
assert.ok(contractForExplore("architecture-alternatives"), "alternatives contract exists");
assert.ok(contractForExplore("architecture-contrast"), "contrast contract exists");

console.log("explore architecture test ok: catalog, skills, evidence, contracts");

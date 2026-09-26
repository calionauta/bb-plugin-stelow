import assert from "node:assert/strict";
import { validateExecutionArtifacts } from "../lib/execution-artifacts.mjs";
import { recipeById } from "../lib/recipe-catalog.mjs";

const catalogRecipe = recipeById("interface-contrast");
const recipe = { ...catalogRecipe, tasks: [catalogRecipe.tasks.find((task) => task.output === "interfaces/contrast.json")] };
const valid = {
  schemaVersion: 1,
  receiptId: "contrast-1",
  route: "interface-refinement",
  briefStatus: "generation-ready",
  authority: "agent",
  disposition: "continue",
  shapeVersion: "v3",
  scopeMapVersion: "map-1",
  decisionQuestion: "Which context should stay visible?",
  primaryDimension: "retained context",
  fixedConstraints: [{ name: "safety", value: "warn before commit", source: "simulation" }],
  criteria: ["scan cost", "accessibility"],
  evidence: [{ source: "simulation", reference: "case-1", claim: "split context improves scanning" }],
  options: [{ id: "split", primaryValue: "split view", relatedValues: [], compatibility: "valid" }],
  nextAction: "Continue to the bounded comparison.",
};
assert.equal(validateExecutionArtifacts({ recipe, contents: { "interfaces/contrast.json": JSON.stringify(valid) } }).ok, true, "valid contrast receipt passes execution artifact validation");

const invalid = structuredClone(valid);
invalid.authority = "agent";
invalid.evidence.push({ source: "human", reference: "invented", claim: "not allowed" });
const result = validateExecutionArtifacts({ recipe, contents: { "interfaces/contrast.json": JSON.stringify(invalid) } });
assert.equal(result.ok, false, "contrast semantic contract rejects fabricated human evidence");
assert.ok(result.malformed.includes("interfaces/contrast.json"), "invalid contrast receipt names the artifact path");

console.log("interface contrast artifact integration test ok: semantic validation reaches execution outputs");

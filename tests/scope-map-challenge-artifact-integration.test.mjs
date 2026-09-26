import assert from "node:assert/strict";
import { validateExecutionArtifacts } from "../lib/execution-artifacts.mjs";

const recipe = {
  id: "scope-map-challenge-recipe",
  tasks: [{
    id: "challenge",
    output: "scope-map-challenge.json",
    output_schema_contract: { type: "object", required: ["schemaVersion"], properties: { schemaVersion: { type: "number" } }, additionalProperties: true },
  }],
};
const valid = {
  schemaVersion: 1,
  challengeId: "challenge-1",
  mapId: "map-1",
  mapShapeVersion: "v1",
  kind: "product-commitment",
  affectedScopeIds: ["scope-1"],
  reason: "A new approval actor changes the product commitment.",
  disposition: "human-decision-required",
  authority: "agent",
  evidence: ["simulation:case-2"],
  requestedBy: "interface-contrast",
};
assert.equal(validateExecutionArtifacts({ recipe, contents: { "scope-map-challenge.json": JSON.stringify(valid) } }).ok, true, "valid challenge passes execution artifact validation");

const invalid = structuredClone(valid);
invalid.affectedScopeIds = [];
const result = validateExecutionArtifacts({ recipe, contents: { "scope-map-challenge.json": JSON.stringify(invalid) } });
assert.equal(result.ok, false, "challenge semantic contract is enforced by execution artifacts");
assert.ok(result.malformed.includes("scope-map-challenge.json"), "invalid challenge names the artifact path");

console.log("scope map challenge artifact integration test ok: semantic validation reaches execution outputs");

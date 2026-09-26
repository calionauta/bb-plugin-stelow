import assert from "node:assert/strict";
import { validateExecutionArtifacts } from "../lib/execution-artifacts.mjs";

const recipe = {
  id: "scope-map-recipe",
  tasks: [{
    id: "scope-map",
    output: "scope-map.json",
    output_schema_contract: { type: "object", required: ["schemaVersion"], properties: { schemaVersion: { type: "number" } }, additionalProperties: true },
  }],
};
const valid = {
  schemaVersion: 1,
  mapId: "map-1",
  status: "approved",
  shapeVersion: "v1",
  provenance: ["simulation:case-1"],
  approval: { receiptId: "approval-1", approvedBy: "simulation" },
  openDecisions: [],
  scopes: [{
    id: "scope-1",
    title: "One scope",
    outcome: "Delivers the bounded outcome.",
    capabilities: ["core"],
    inScope: ["one behavior"],
    outOfScope: [],
    dependsOn: [],
    status: "current",
  }],
};
assert.equal(
  validateExecutionArtifacts({ recipe, contents: { "scope-map.json": JSON.stringify(valid) } }).ok,
  true,
  "valid scope map passes execution artifact validation",
);

const invalid = structuredClone(valid);
invalid.scopes[0].dependsOn = ["scope-1", "scope-1"];
const result = validateExecutionArtifacts({ recipe, contents: { "scope-map.json": JSON.stringify(invalid) } });
assert.equal(result.ok, false, "scope map semantic contract is enforced by execution artifacts");
assert.ok(result.malformed.includes("scope-map.json"), "invalid scope map names the artifact path");

console.log("scope map artifact integration test ok: semantic validation reaches execution outputs");

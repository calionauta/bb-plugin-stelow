import assert from "node:assert/strict";
import { validateInterfaceContrastReceipt } from "../lib/interface-contrast.mjs";
import { resolveScopeMapChallenge, validateScopeMap } from "../lib/scope-map.mjs";

const cases = [
  {
    id: "context-refinement",
    expectedRoute: "interface-refinement",
    receipt: {
      schemaVersion: 1, receiptId: "sim-1", route: "interface-refinement", briefStatus: "generation-ready", authority: "agent", disposition: "continue", shapeVersion: "v3", scopeMapVersion: "map-1", decisionQuestion: "Which context stays visible?", primaryDimension: "context", fixedConstraints: [{ name: "safety", value: "warn before commit", source: "simulation" }], criteria: ["scan cost", "accessibility"], evidence: [{ source: "simulation", reference: "case-1", claim: "split view keeps the queue visible" }], options: [{ id: "split", primaryValue: "split view", relatedValues: [], compatibility: "valid" }],
    },
  },
  {
    id: "new-approval-actor",
    expectedRoute: "shape-contrast",
    receipt: {
      schemaVersion: 1, receiptId: "sim-2", route: "shape-contrast", briefStatus: "stop", authority: "agent", disposition: "human-decision-required", shapeVersion: "v6", scopeMapVersion: "map-1", fixedConstraints: [{ name: "actor", value: "operator", source: "simulation" }], evidence: [{ source: "simulation", reference: "case-2", claim: "reviewer approval is a new commitment" }], options: [],
    },
  },
  {
    id: "command-batch-audit",
    expectedRoute: "interface-refinement",
    receipt: {
      schemaVersion: 1, receiptId: "sim-3", route: "interface-refinement", briefStatus: "generation-ready", authority: "agent", disposition: "continue", shapeVersion: "v4", scopeMapVersion: "map-1", decisionQuestion: "Where should batch feedback appear?", primaryDimension: "feedback timing", fixedConstraints: [{ name: "undo", value: "undo after commit", source: "simulation" }], criteria: ["recovery confidence", "review cost"], evidence: [{ source: "simulation", reference: "case-3", claim: "review drawer reduces batch review cost" }], options: [{ id: "drawer", primaryValue: "review drawer", relatedValues: [], compatibility: "valid" }],
    },
  },
  {
    id: "map-comprehension",
    expectedRoute: "research-needed",
    receipt: {
      schemaVersion: 1, receiptId: "sim-4", route: "research-needed", briefStatus: "stop", authority: "agent", disposition: "research-required", shapeVersion: "v5", scopeMapVersion: "map-1", fixedConstraints: [{ name: "map clarity", value: "relationships are clear", source: "simulation" }], evidence: [{ source: "simulation", reference: "case-4", claim: "task observation is missing" }], options: [],
    },
  },
  {
    id: "existing-interface-baseline",
    expectedRoute: "existing-interface-no-comparison",
    receipt: {
      schemaVersion: 1, receiptId: "sim-5", route: "existing-interface-no-comparison", briefStatus: "no-comparison", authority: "agent", disposition: "continue", shapeVersion: "v3", scopeMapVersion: "map-1", fixedConstraints: [{ name: "organizing unit", value: "slice", source: "simulation" }], evidence: [{ source: "simulation", reference: "case-5", claim: "existing interface is accepted" }], options: [],
    },
  },
  {
    id: "scope-map-challenge",
    expectedRoute: "shape-contrast",
    challenge: {
      schemaVersion: 1, challengeId: "sim-6", mapId: "map-1", mapShapeVersion: "v3", kind: "product-commitment", affectedScopeIds: ["scope-2"], reason: "A new approval actor changes the commitment.", disposition: "human-decision-required", authority: "agent", evidence: ["simulation:case-6"], requestedBy: "interface-contrast",
    },
  },
];

for (const testCase of cases) {
  if (testCase.receipt) {
    assert.deepEqual(validateInterfaceContrastReceipt(testCase.receipt), [], `${testCase.id} simulated receipt passes`);
    assert.equal(testCase.receipt.route, testCase.expectedRoute, `${testCase.id} keeps its expected route`);
  } else {
    assert.equal(resolveScopeMapChallenge(testCase.challenge).destination, "shape", `${testCase.id} routes product challenge to Shape`);
  }
}

const map = {
  schemaVersion: 1, mapId: "map-1", status: "approved", shapeVersion: "v3", provenance: ["simulation:matrix"], approval: { receiptId: "approval-1", approvedBy: "simulation" }, openDecisions: [], scopes: [{ id: "scope-1", title: "One", outcome: "One outcome", capabilities: ["core"], inScope: ["one behavior"], outOfScope: [], dependsOn: [], status: "current" }],
};
assert.deepEqual(validateScopeMap(map), [], "simulated map remains valid across the matrix");

console.log("interface contrast simulated matrix test ok: six sequential cases, no human authority fabricated");

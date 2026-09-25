import assert from "node:assert/strict";
import { resolveInterfaceContrastRoute, validateInterfaceContrastReceipt } from "../lib/interface-contrast.mjs";

const base = {
  schemaVersion: 1,
  receiptId: "route-1",
  route: "interface-refinement",
  briefStatus: "generation-ready",
  authority: "agent",
  disposition: "continue",
  shapeVersion: "v1",
  decisionQuestion: "Which layout should remain focused?",
  primaryDimension: "focus",
  fixedConstraints: [{ name: "scope", value: "approved", source: "simulation" }],
  criteria: ["focus", "accessibility"],
  evidence: [{ source: "simulation", reference: "case", claim: "layout is testable" }],
  options: [{ id: "split", primaryValue: "split view", relatedValues: [], compatibility: "valid" }],
  nextAction: "Continue the bounded comparison.",
};
assert.deepEqual(validateInterfaceContrastReceipt(base), [], "route-compatible receipt is valid");
assert.deepEqual(resolveInterfaceContrastRoute(base), { destination: "interface", staleArtifacts: [], requiresApproval: false }, "interface refinement resumes the interface loop");
assert.deepEqual(resolveInterfaceContrastRoute({ ...base, route: "shape-contrast", briefStatus: "stop", disposition: "human-decision-required" }), { destination: "shape", staleArtifacts: ["scope-map", "interface-contrasts", "selection"], requiresApproval: true }, "product commitment stops at Shape with invalidation");
assert.deepEqual(resolveInterfaceContrastRoute({ ...base, route: "research-needed", briefStatus: "stop", disposition: "research-required" }), { destination: "research", staleArtifacts: ["selection", "technical-plan"], requiresApproval: false }, "missing evidence routes to research");
const invalid = { ...base, route: "research-needed", disposition: "continue" };
assert.ok(validateInterfaceContrastReceipt(invalid).some((issue) => issue.includes("route/disposition")), "route and disposition combinations cannot disagree");
assert.throws(() => resolveInterfaceContrastRoute(invalid), /route\/disposition/, "invalid combinations fail closed at the route resolver");

console.log("interface contrast route test ok: destinations, invalidation, approval, refusal");

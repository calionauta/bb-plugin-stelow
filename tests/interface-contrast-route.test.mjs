import assert from "node:assert/strict";
import { describeInterfaceContrastRoute, resolveInterfaceContrastRoute, validateInterfaceContrastReceipt } from "../lib/interface-contrast.mjs";

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
assert.deepEqual(
  resolveInterfaceContrastRoute(base),
  {
    destination: "interface",
    staleArtifacts: [],
    requiresApproval: false },
  "interface refinement resumes the interface loop",
);
assert.deepEqual(
  resolveInterfaceContrastRoute({ ...base, route: "shape-contrast", briefStatus: "stop", disposition: "human-decision-required" }),
  { destination: "shape", staleArtifacts: ["scope-map", "interface-contrasts", "selection"], requiresApproval: true },
  "product commitment stops at Shape with invalidation",
);
assert.deepEqual(
  resolveInterfaceContrastRoute({ ...base, route: "research-needed", briefStatus: "stop", disposition: "research-required" }),
  { destination: "research", staleArtifacts: ["selection", "technical-plan"], requiresApproval: false },
  "missing evidence routes to research",
);
const invalid = { ...base, route: "research-needed", disposition: "continue" };
assert.ok(validateInterfaceContrastReceipt(invalid).some((issue) => issue.includes("route/disposition")), "route and disposition combinations cannot disagree");
assert.throws(() => resolveInterfaceContrastRoute(invalid), /route\/disposition/, "invalid combinations fail closed at the route resolver");

// The trail line is the only machine record of where a run decided to go, and
// it lived in server wiring with no seam to test. `human` is a destination,
// not a stage: printing it bare sent the reader hunting for a stage that does
// not exist.
const toHuman = describeInterfaceContrastRoute({ ...base, route: "stop-and-name-decision", briefStatus: "stop", disposition: "human-decision-required" });
assert.equal(toHuman.destination, "human", "the destination stays machine-readable");
assert.match(toHuman.note, /not a stage/, "the line says `human` is not a stage");
assert.match(
  toHuman.note,
  /scope-map, interface-contrasts, selection, technical-plan/,
  "the line names what went stale on the way",
);

const toInterface = describeInterfaceContrastRoute(base);
assert.equal(toInterface.note, "Interface Contrast route: interface; stale artifacts: none.", "a stage destination prints as itself");
assert.equal(toInterface.requiresApproval, false, "a refinement needs no approval");

const toShape = describeInterfaceContrastRoute({ ...base, route: "shape-contrast", briefStatus: "stop", disposition: "shape-required" });
assert.equal(toShape.requiresApproval, true, "a product commitment needs a human");

console.log("interface contrast route test ok: destinations, invalidation, approval, refusal");

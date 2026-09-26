import assert from "node:assert/strict";
import {
  assertBoundaryAnswerCurrent,
  validateHumanBoundary,
  validateInterfaceContrastReceipt,
} from "../lib/interface-contrast.mjs";

const receipt = {
  schemaVersion: 1,
  receiptId: "receipt-queue-1",
  route: "interface-refinement",
  briefStatus: "generation-ready",
  authority: "agent",
  disposition: "continue",
  shapeVersion: "v3",
  scopeMapVersion: "map-queue-v1",
  decisionQuestion: "Which retained-context representation helps the operator act?",
  fixedConstraints: [{ name: "safety", value: "warning before commit", source: "simulation" }],
  criteria: ["scan cost", "accessibility"],
  primaryDimension: "retained context",
  evidence: [
    { source: "simulation", reference: "queue-operator-case", claim: "split context reduces reopen cost" },
    { source: "fixture", reference: "accessibility-constraint", claim: "keyboard path must remain complete" },
  ],
  options: [
    { id: "split-context", primaryValue: "split view", relatedValues: [], compatibility: "valid" },
    { id: "ghost-whole", primaryValue: "crop with ghost whole", relatedValues: [], compatibility: "valid" },
  ],
};

assert.deepEqual(validateInterfaceContrastReceipt(receipt), [], "simulated Interface Contrast receipt is valid");
assert.deepEqual(
  validateHumanBoundary({
    contractId: "reaction-queue-1",
    boundaryId: "boundary-1",
    kind: "reaction",
    status: "answered",
    answer: "Keep the operator's first reading of the queue visible.",
    shapeVersion: "v3",
    scopeMapVersion: "map-queue-v1",
  }),
  [],
  "reaction boundary carries its own durable contract",
);
assert.equal(
  assertBoundaryAnswerCurrent(
    { shapeVersion: "v3", scopeMapVersion: "map-queue-v1" },
    { status: "answered", shapeVersion: "v3", scopeMapVersion: "map-queue-v1" },
  ),
  true,
  "matching versions make an answer current",
);
assert.equal(
  assertBoundaryAnswerCurrent(
    { shapeVersion: "v4", scopeMapVersion: "map-queue-v1" },
    { status: "answered", shapeVersion: "v3", scopeMapVersion: "map-queue-v1" },
  ),
  false,
  "a Shape version change invalidates an old answer",
);

const invalidReceipt = structuredClone(receipt);
invalidReceipt.evidence.push({ source: "human", reference: "invented", claim: "not allowed" });
assert.ok(validateInterfaceContrastReceipt(invalidReceipt).some((issue) => issue.includes("human evidence")), "agent receipts cannot carry human evidence");
const humanReceipt = structuredClone(receipt);
humanReceipt.authority = "human";
assert.ok(!validateInterfaceContrastReceipt(humanReceipt).some((issue) => issue.includes("authority")), "human authority is valid when explicitly recorded");

console.log("interface contrast contract test ok: receipt, authority, boundary freshness, refusals");

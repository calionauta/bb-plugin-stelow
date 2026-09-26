import assert from "node:assert/strict";
import { approveScopeMap } from "../lib/scope-map-approval.mjs";
import { validateScopeMap } from "../lib/scope-map.mjs";

const draft = {
  schemaVersion: 1,
  mapId: "map-1",
  status: "draft",
  shapeVersion: "spec-product_v2",
  provenance: ["human:card"],
  openDecisions: [],
  scopes: [{
    id: "S1",
    title: "Map section",
    outcome: "Every scope visible",
    capabilities: ["core"],
    inScope: ["the map section"],
    outOfScope: ["mutations"],
    dependsOn: [],
    status: "current",
  }],
};

// The gap this closes: nothing wrote status/approval, so the X-ray could only
// ever be reached by hand-editing the artifact. Drop the stamping and the
// approved map below stops existing.
const approved = approveScopeMap(draft, { receiptId: "receipt-1", approvedBy: "operator" });
assert.equal(approved.ok, true, "a contract-valid draft is approvable");
assert.equal(approved.map.status, "approved", "approval stamps the status the X-ray requires");
assert.deepEqual(approved.map.approval, { receiptId: "receipt-1", approvedBy: "operator" }, "approval records who signed and against which receipt");
assert.deepEqual(validateScopeMap(approved.map), [], "the approved map still satisfies its own contract");

// The original is not mutated: an approval is a new decision, not an edit
// that rewrites what the agent produced.
assert.equal(draft.status, "draft", "the source map keeps its own status");

// Fail-closed on every axis, each with a named reason.
const invalid = approveScopeMap({ mapId: "map-1" }, { receiptId: "r", approvedBy: "o" });
assert.equal(invalid.ok, false, "a map that violates its contract cannot be approved");
assert.match(invalid.reason, /does not satisfy its contract/, "the refusal names the contract, not a generic error");

const twice = approveScopeMap(approved.map, { receiptId: "receipt-2", approvedBy: "someone-else" });
assert.equal(twice.ok, false, "an already-approved map is not re-approvable");
assert.match(twice.reason, /already approved/, "re-approving says so, and says why it matters");

for (const [label, approval] of [
  ["no receipt", { approvedBy: "operator" }],
  ["blank receipt", { receiptId: "   ", approvedBy: "operator" }],
  ["no approver", { receiptId: "receipt-1" }],
  ["blank approver", { receiptId: "receipt-1", approvedBy: "  " }],
  ["missing object", undefined],
]) {
  const result = approveScopeMap(draft, approval);
  assert.equal(result.ok, false, `${label} is refused`);
  assert.match(result.reason, /receipt id and who approved it/, `${label} names what is missing`);
}

for (const [label, value] of [["null", null], ["a string", "map"], ["an array", []], ["a number", 7]]) {
  assert.equal(approveScopeMap(value, { receiptId: "r", approvedBy: "o" }).ok, false, `${label} is never approvable`);
}

console.log("scope map approval test ok: approval stamps, validates, and refuses everything unaccountable");

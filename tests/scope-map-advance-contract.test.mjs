import assert from "node:assert/strict";
import { checkAdvanceContracts } from "../lib/advance-contracts.mjs";

const map = {
  schemaVersion: 1,
  mapId: "map-advance",
  status: "approved",
  shapeVersion: "v1",
  provenance: ["simulation:advance"],
  approval: { receiptId: "approval-1", approvedBy: "simulation" },
  openDecisions: [],
  scopes: [{
    id: "scope-1",
    title: "One",
    outcome: "One outcome",
    capabilities: ["core"],
    inScope: ["one behavior"],
    outOfScope: [],
    dependsOn: [],
    status: "current",
  }],
};
const base = {
  stage: "scope",
  enteredAt: 100,
  contracts: [{ id: "scope-adjustment-auto", kind: "agent-receipt", receipt: "scope-map.json" }],
  receipts: [{ path: "scope-map.json", content: JSON.stringify(map), modifiedAtMs: 100 }],
  answered: true,
};
assert.equal(checkAdvanceContracts(base), null, "fresh valid Scope Map JSON is a real stage receipt without a Markdown marker");
const invalid = { ...base, receipts: [{ ...base.receipts[0], content: JSON.stringify({ ...map, scopes: [] }) }] };
assert.match(checkAdvanceContracts(invalid), /scope-map\.json/, "invalid Scope Map JSON refuses with the receipt path");
console.log("scope map advance contract test ok: structured Scope receipt, freshness, invalid refusal");

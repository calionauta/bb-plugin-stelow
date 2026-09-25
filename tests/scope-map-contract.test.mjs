import assert from "node:assert/strict";
import { projectScopeMapToTracking, scopeMapFreshness, validateScopeMap } from "../lib/scope-map.mjs";

const map = {
  schemaVersion: 1,
  mapId: "map-queue-v1",
  status: "approved",
  shapeVersion: "v3",
  provenance: ["simulated:product-gate"],
  approval: { receiptId: "approval-1", approvedBy: "simulation" },
  openDecisions: [],
  scopes: [
    {
      id: "scope-1",
      title: "Queue context",
      outcome: "Operators can inspect and act on queue work.",
      capabilities: ["queue"],
      inScope: ["retained context", "warning before commit"],
      outOfScope: ["new persistence"],
      dependsOn: [],
      status: "current",
    },
    {
      id: "scope-2",
      title: "Accessible feedback",
      outcome: "Feedback remains keyboard and screen-reader complete.",
      capabilities: ["accessibility"],
      inScope: ["focus order", "screen reader labels"],
      outOfScope: ["visual redesign"],
      dependsOn: ["scope-1"],
      status: "current",
    },
  ],
};

assert.deepEqual(validateScopeMap(map), [], "approved simulated map satisfies the contract");
assert.deepEqual(
  projectScopeMapToTracking(map),
  {
    mapId: "map-queue-v1",
    shapeVersion: "v3",
    scopes: [
      { id: "scope-1", name: "Queue context", status: "pending", blockedBy: [] },
      { id: "scope-2", name: "Accessible feedback", status: "pending", blockedBy: ["scope-1"] },
    ],
  },
  "tracking is derived from the approved map and never invents ownership",
);
assert.deepEqual(scopeMapFreshness(map, { currentShapeVersion: "v3" }), { state: "current", stale: false }, "matching Shape version is current");
assert.deepEqual(scopeMapFreshness(map, { currentShapeVersion: "v4" }), { state: "stale", stale: true }, "newer Shape version makes the map stale");

const invalid = structuredClone(map);
invalid.scopes[1].dependsOn = ["scope-1", "scope-1"];
invalid.scopes[1].capabilities = ["accessibility", ""];
assert.ok(validateScopeMap(invalid).some((issue) => issue.includes("dependsOn")), "dependency references are validated");
assert.ok(validateScopeMap(invalid).some((issue) => issue.includes("capabilities")), "capability entries are validated");

const draft = structuredClone(map);
draft.status = "draft";
delete draft.approval;
assert.equal(validateScopeMap(draft).some((issue) => issue.includes("approved")), false, "draft maps do not require an approval receipt");
assert.throws(() => projectScopeMapToTracking(draft), /approved/, "draft maps cannot become execution tracking");

console.log("scope map contract test ok: validation, derived tracking, freshness, refusals");

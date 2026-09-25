import assert from "node:assert/strict";
import { buildScopeXray, parseCurrentShapeVersion } from "../lib/scope-xray.mjs";

const map = {
  schemaVersion: 1,
  mapId: "map-xray",
  status: "approved",
  shapeVersion: "v3",
  provenance: ["simulation:xray"],
  approval: { receiptId: "approval-xray", approvedBy: "simulation" },
  openDecisions: [],
  scopes: [
    { id: "scope-1", title: "Context", outcome: "Context", capabilities: ["queue"], inScope: ["context"], outOfScope: [], dependsOn: [], status: "current" },
    { id: "scope-2", title: "Feedback", outcome: "Feedback", capabilities: ["accessibility"], inScope: ["feedback"], outOfScope: [], dependsOn: ["scope-1"], status: "current" },
  ],
};

assert.deepEqual(buildScopeXray(map, { currentShapeVersion: "v3" }), {
  source: "server-projection",
  mutable: false,
  mapId: "map-xray",
  mapVersion: "v3",
  freshness: "current",
  nodes: [
    { id: "scope-1", title: "Context", capabilities: ["queue"], state: "current", provenance: ["simulation:xray"] },
    { id: "scope-2", title: "Feedback", capabilities: ["accessibility"], state: "current", provenance: ["simulation:xray"] },
  ],
  edges: [{ from: "scope-1", to: "scope-2", kind: "depends-on", state: "current", provenance: ["simulation:xray"] }],
}, "X-ray projects approved map facts without inventing edges");

assert.equal(parseCurrentShapeVersion("shape_version: v3\ncurrent_stage: interface"), "v3", "state evidence supplies the current Shape version");
assert.equal(parseCurrentShapeVersion("current_stage: interface"), null, "missing Shape evidence stays unknown");
const stale = buildScopeXray(map, { currentShapeVersion: "v4" });
assert.equal(stale.freshness, "stale");
assert.ok(stale.nodes.every((node) => node.state === "stale"), "stale Shape version marks every node stale");
assert.ok(stale.edges.every((edge) => edge.state === "stale"), "stale Shape version marks every edge stale");

assert.throws(() => buildScopeXray({ ...map, status: "draft" }), /approved map/, "draft maps cannot enter the approved-map X-ray");

console.log("scope xray test ok: read-only projection, provenance, freshness, approved-only input");

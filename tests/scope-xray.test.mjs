import assert from "node:assert/strict";
import { buildScopeDraft, buildScopeXray, parseCurrentShapeVersion } from "../lib/scope-xray.mjs";

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
    {
      id: "scope-2",
      title: "Feedback",
      outcome: "Feedback",
      capabilities: ["accessibility"],
      inScope: ["feedback"],
      outOfScope: [],
      dependsOn: ["scope-1"],
      status: "current" },
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

// Draft preview: same graph, opposite gate, unmistakable marker.
const draft = { ...map, status: "draft" };
const preview = buildScopeDraft(draft, { currentShapeVersion: "v3" });
assert.equal(preview.draft, true, "the draft carries its marker");
assert.equal(preview.nodes.length, 2, "the draft projects every scope");
assert.deepEqual(preview.edges.map((edge) => [edge.from, edge.to]), [["scope-1", "scope-2"]], "the draft keeps dependencies");
assert.throws(() => buildScopeDraft(map), /draft map/, "approved maps cannot enter the draft preview");
assert.throws(() => buildScopeDraft({ ...map, status: "draft", scopes: [] }), /scope draft cannot project/, "off-contract drafts are refused, not drawn");

console.log("scope xray test ok: read-only projection, provenance, freshness, approved-only input");

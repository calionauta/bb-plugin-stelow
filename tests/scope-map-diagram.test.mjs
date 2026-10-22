import assert from "node:assert/strict";
import { SCOPE_DIAGRAM_KIND, scopeMapToFlowchart } from "../lib/scope-map-diagram.mjs";

// A valid map draws the DAG: one node per scope, one edge per dependency.
const map = {
  scopes: [
    { id: "s1", title: "Capture", dependsOn: [] },
    { id: "s2", title: "Shape", dependsOn: ["s1"] },
    { id: "s3", title: "Build", dependsOn: ["s2"] },
  ],
};
const out = scopeMapToFlowchart(map);
assert.equal(SCOPE_DIAGRAM_KIND, "flowchart", "the kind stays a flowchart");
assert.ok(out.startsWith("flowchart TB\n"), "the first line is the kind and direction");
for (const [id, title] of [["s1", "Capture"], ["s2", "Shape"], ["s3", "Build"]]) {
  assert.ok(out.includes(`["${id}: ${title}"]`), `${id} has one node labelled with its id and title`);
}
assert.ok(out.includes("s1 --> s2"), "s2 depending on s1 draws an edge");
assert.ok(out.includes("s2 --> s3"), "s3 depending on s2 draws an edge");
assert.doesNotMatch(out, /stroke-dasharray/, "all-current scopes draw no dashed handling");

// Non-current scopes stay visible by shape of line, never colour alone.
const staleOut = scopeMapToFlowchart({
  scopes: [
    { id: "a", title: "Aye", status: "stale" },
    { id: "b", title: "Bee", dependsOn: ["a"] },
  ],
});
assert.match(staleOut, /stroke-dasharray:5 5/, "a stale scope draws dashed");
assert.match(staleOut, /scopestale/, "the stale class names its status");
const blockedOut = scopeMapToFlowchart({
  scopes: [{ id: "a", title: "Aye", status: "blocked" }],
});
assert.match(blockedOut, /stroke-dasharray:5 5/, "a blocked scope draws dashed");
assert.match(blockedOut, /scopeblocked/, "the blocked class names its status");

// A dependency on nothing is a refusal, not a pretty picture of something else.
assert.throws(
  () => scopeMapToFlowchart({ scopes: [{ id: "a", title: "A", dependsOn: ["nope"] }] }),
  /unknown scope/,
  "a dangling dependency throws",
);

// Merging two scopes into one node would present a hole as a decision.
assert.throws(
  () => scopeMapToFlowchart({ scopes: [{ id: "a-b", title: "X" }, { id: "a_b", title: "Y" }] }),
  /collide/,
  "ids colliding after sanitizing throw",
);

// Degenerate input never draws.
for (const bad of [null, undefined, 42, "scopes", [], {}, { scopes: [] }, { scopes: "nope" }]) {
  assert.throws(() => scopeMapToFlowchart(bad), /scope-map diagram/, `${String(bad)} throws`);
}
for (const bad of [{ title: "no id" }, { id: "" }, { id: 42 }, null]) {
  assert.throws(
    () => scopeMapToFlowchart({ scopes: [bad] }),
    /string id/,
    "a scope without a string id throws",
  );
}

// The same map always draws the same bytes: a diff in the picture is a diff in the map.
const first = scopeMapToFlowchart(map);
const second = scopeMapToFlowchart(JSON.parse(JSON.stringify(map)));
assert.equal(second, first, "the same input twice is byte-identical");
assert.equal(scopeMapToFlowchart(map), first, "a third render still matches");

console.log("scope map diagram ok: nodes, edges, dashed non-current, refusals, and determinism hold");

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

// Outcomes render as a second line; absent outcomes stay single-line.
const outcomeOut = scopeMapToFlowchart({
  scopes: [
    { id: "S1", title: "Title", outcome: "first   outcome\nsecond\tline" },
    { id: "S2", title: "Next", dependsOn: ["S1"] },
  ],
});
assert.ok(outcomeOut.includes('S1["S1: Title<br/>first outcome second line"]'), "outcome renders collapsed as the node second line");
assert.ok(outcomeOut.includes('S2["S2: Next"]'), "an absent outcome stays a single-line label");
const bareLine = outcomeOut.split("\n").find((line) => line.includes('S2["'));
assert.doesNotMatch(bareLine, /<br\/>/, "an absent outcome adds no second line");

// Long outcomes truncate with an ellipsis instead of wrapping the node.
const truncOut = scopeMapToFlowchart({ scopes: [{ id: "S1", title: "T", outcome: "o".repeat(100) }] });
const truncLine = truncOut.split("\n").find((line) => line.includes("S1["));
assert.match(truncLine, /…"\]$/, "a 100-char outcome ends its line with an ellipsis");
const truncSecond = truncLine.split("<br/>")[1].replace(/…"\]$/, "");
assert.ok(truncSecond.length <= 63, "the pre-ellipsis part stays within 63 chars");

// Waves group scopes by topological depth: a chain spreads one scope per wave.
const linearOut = scopeMapToFlowchart({
  scopes: [
    { id: "S1", title: "One" },
    { id: "S2", title: "Two", dependsOn: ["S1"] },
    { id: "S3", title: "Three", dependsOn: ["S2"] },
  ],
});
for (const n of [1, 2, 3]) assert.ok(linearOut.includes(`subgraph W${n}["Wave ${n}"]`), `a linear S1->S2->S3 draws Wave ${n}`);
const w1At = linearOut.indexOf("subgraph W1");
const w2At = linearOut.indexOf("subgraph W2");
const w3At = linearOut.indexOf("subgraph W3");
assert.ok(linearOut.indexOf('S1["S1: One"]') > w1At, "S1 sits after the W1 header");
assert.ok(linearOut.indexOf('S1["S1: One"]') < w2At, "S1 sits before the W2 header");
assert.ok(linearOut.indexOf('S2["S2: Two"]') > w2At, "S2 sits after the W2 header");
assert.ok(linearOut.indexOf('S2["S2: Two"]') < w3At, "S2 sits before the W3 header");
assert.ok(linearOut.indexOf('S3["S3: Three"]') > w3At, "S3 sits after the W3 header");

// A diamond shares Wave 2 across both arms and leaves the tip alone in Wave 3.
const diamondOut = scopeMapToFlowchart({
  scopes: [
    { id: "S1", title: "One" },
    { id: "S2", title: "Two", dependsOn: ["S1"] },
    { id: "S3", title: "Three", dependsOn: ["S1"] },
    { id: "S4", title: "Four", dependsOn: ["S2", "S3"] },
  ],
});
const diaW2 = diamondOut.indexOf("subgraph W2");
const diaW3 = diamondOut.indexOf("subgraph W3");
const w2Block = diamondOut.slice(diaW2, diamondOut.indexOf("end", diaW2));
const w3Block = diamondOut.slice(diaW3, diamondOut.indexOf("end", diaW3));
assert.ok(w2Block.includes("S2[") && w2Block.includes("S3["), "diamond arms S2 and S3 share Wave 2");
assert.ok(w3Block.includes('S4["S4: Four"]'), "diamond tip S4 sits in Wave 3");
assert.ok(!w3Block.includes("S2[") && !w3Block.includes("S3["), "Wave 3 holds S4 alone");

// A dependency cycle refuses the whole view instead of drawing a DAG lie.
const cycleMap = { scopes: [{ id: "S1", title: "A", dependsOn: ["S2"] }, { id: "S2", title: "B", dependsOn: ["S1"] }] };
assert.throws(() => scopeMapToFlowchart(cycleMap), /cycle/, "an S1<->S2 cycle throws");

// The waved view stays derived: the same map twice is byte-identical.
const wavedMap = { scopes: [{ id: "S1", title: "One", outcome: "O1" }, { id: "S2", title: "Two", dependsOn: ["S1"] }] };
assert.equal(scopeMapToFlowchart(JSON.parse(JSON.stringify(wavedMap))), scopeMapToFlowchart(wavedMap), "the waved map twice is byte-identical");

console.log("scope map diagram ok: nodes, edges, dashed non-current, refusals, and determinism hold");

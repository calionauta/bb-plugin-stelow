import assert from "node:assert/strict";
import { extractFencedMermaid } from "../lib/fenced-mermaid.mjs";
import { derivedDiagram } from "../lib/artifact-diagram.mjs";

// --- First fenced ```mermaid block, trimmed. --------------------------------
assert.equal(
  extractFencedMermaid("# T\n\n```mermaid\nflowchart TB\n  A-->B\n```\n"),
  "flowchart TB\n  A-->B",
  "the first fence is returned",
);
assert.equal(
  extractFencedMermaid("```mermaid\n   flowchart TB   \n```"),
  "flowchart TB",
  "the block is trimmed",
);
assert.equal(
  extractFencedMermaid("before\n```mermaid\n  one  \n```\nmid\n```mermaid\ntwo\n```\nafter"),
  "one",
  "the second fence is ignored",
);
assert.equal(extractFencedMermaid("# No fence here\n```js\ncode\n```\n"), null, "no mermaid fence reads as null");
assert.equal(extractFencedMermaid("# Title only\n"), null, "prose without a fence reads as null");
assert.equal(extractFencedMermaid("```mermaid\n   \n```"), null, "an empty fence reads as null");
for (const bad of [null, undefined, 42, {}, [], ""]) {
  assert.equal(extractFencedMermaid(bad), null, `${String(bad)} reads as null`);
}

console.log("fenced mermaid ok: first block trimmed, second ignored, degenerate reads null");

// --- Which diagram, if any, the viewer derives for one file. -----------------
const scopeMap = JSON.stringify({
  scopes: [
    { id: "s1", title: "Capture" },
    { id: "s2", title: "Shape", dependsOn: ["s1"] },
  ],
});
const danglingMap = JSON.stringify({ scopes: [{ id: "a", title: "A", dependsOn: ["nope"] }] });

// (a) `.mmd` is the source itself: no derivation, no staleness.
for (const path of ["scope.mmd", "x/breadboard.mmd"]) {
  const got = derivedDiagram(path, "flowchart TB\n  A-->B", { truncated: false });
  assert.ok(got && got.mermaid === "flowchart TB\n  A-->B", `${path} returns its own source`);
}

// (b) `scope-map.json` derives the flowchart, or nothing when the map refuses.
const fromMap = derivedDiagram("scope-map.json", scopeMap, { truncated: false });
assert.ok(fromMap, "a valid scope map derives a diagram");
assert.match(fromMap.mermaid, /^flowchart TB/, "the derivation is a flowchart");
assert.ok(fromMap.mermaid.includes("s1") && fromMap.mermaid.includes("s2"), "the flowchart names the scopes");
assert.equal(derivedDiagram("scope-map.json", "not json {", {}), null, "unparseable JSON derives nothing");
assert.equal(derivedDiagram("scope-map.json", danglingMap, {}), null, "a dangling dependency derives nothing");

// (c) Drafts read the same way: a refused draft is source, never a picture.
const fromDraft = derivedDiagram("scope-map-draft.json", scopeMap, {});
assert.ok(fromDraft, "a valid draft derives a diagram");
assert.match(fromDraft.mermaid, /^flowchart TB/, "the draft derivation is a flowchart");
assert.ok(fromDraft.mermaid.includes("s1"), "the draft flowchart names the scopes");
assert.equal(derivedDiagram("scope-map-draft.json", "not json {", {}), null, "an unparseable draft derives nothing");
assert.equal(derivedDiagram("scope-map-draft.json", danglingMap, {}), null, "a dangling draft derives nothing");

// (d) Diagrammable Markdown renders only an authored fence; prose stays prose.
const fenced = "# Tech\n\n```mermaid\nflowchart TB\n  A-->B\n```\n";
const fencedOut = derivedDiagram("plans/spec-tech_v1.md", fenced, {});
assert.ok(fencedOut, "a fenced tech spec derives its block");
assert.equal(fencedOut.mermaid, "flowchart TB\n  A-->B", "the derivation is the authored block");
assert.equal(
  derivedDiagram("plans/spec-tech_v1.md", "# Tech\nNo fence here.\n", {}),
  null,
  "a fence-less tech spec derives nothing",
);

// (e) `breadboard.json` deliberately derives nothing: the upstream projection
// owns its views, and a second serializer would eventually disagree.
assert.equal(derivedDiagram("breadboard.json", scopeMap, {}), null, "breadboard derives nothing");
assert.equal(
  derivedDiagram("interfaces/breadboard.json", JSON.stringify({ places: [] }), {}),
  null,
  "a nested breadboard still derives nothing",
);

// (f) A truncated file never derives: a partial map, cut fence, or half-written
// projection would render a hole as a decision.
assert.equal(derivedDiagram("scope.mmd", "flowchart TB", { truncated: true }), null, "truncated .mmd derives nothing");
assert.equal(derivedDiagram("scope-map.json", scopeMap, { truncated: true }), null, "truncated map derives nothing");
assert.equal(
  derivedDiagram("scope-map-draft.json", scopeMap, { truncated: true }),
  null,
  "truncated draft derives nothing",
);
assert.equal(derivedDiagram("plans/spec-tech_v1.md", fenced, { truncated: true }), null, "truncated fence derives nothing");
assert.equal(derivedDiagram("breadboard.json", scopeMap, { truncated: true }), null, "truncated breadboard derives nothing");

// (g) No content is no diagram, and never a throw.
for (const content of [null, undefined, "", 42, {}]) {
  assert.equal(derivedDiagram("scope.mmd", content, {}), null, `${String(content)} .mmd derives nothing`);
  assert.equal(derivedDiagram("scope-map.json", content, {}), null, `${String(content)} map derives nothing`);
  assert.equal(derivedDiagram("plans/spec-tech_v1.md", content, {}), null, `${String(content)} prose derives nothing`);
}

console.log("artifact diagram ok: .mmd passthrough, scope-map derivation, fenced prose, breadboard refusal, truncation honesty");

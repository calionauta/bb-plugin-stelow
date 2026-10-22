import assert from "node:assert/strict";
import {
  PELE_HOMEPAGE,
  PELE_PIN,
  PELE_PLAYGROUND,
  PELE_REPO,
  diagramForArtifact,
  isDiagrammable,
  pelePlaygroundUrl,
} from "../lib/diagram-strategy.mjs";

// The pin and links are the contract the About panel and the artifact viewer
// share: a pin bump that leaves one surface behind ships two truths.
assert.equal(PELE_PIN, "1.8.0", "pele pin stays on 1.8.0");
assert.ok(PELE_REPO.includes("github.com/obsidianmd/pele"), "pele repo link points at obsidianmd/pele");
assert.equal(PELE_HOMEPAGE, "https://pele.run", "pele homepage is pele.run");

// --- Derived JSON/Markdown artifacts never hand-write pele syntax. ---------
let rec = diagramForArtifact("interfaces/breadboard.json");
assert.deepEqual(rec.kinds, ["flowchart"], "breadboard derives a flowchart");
assert.equal(rec.derived, true, "breadboard diagram is derived");

rec = diagramForArtifact("scope-map.json");
assert.deepEqual(rec.kinds, ["flowchart"], "scope map derives a flowchart");

rec = diagramForArtifact("interfaces/selected-interface.md");
assert.ok(rec.kinds.includes("block-beta"), "selected interface recommends block-beta");

rec = diagramForArtifact("plans/spec-product_v1.md");
assert.ok(rec.kinds.includes("usecase-beta"), "product spec recommends usecase-beta");

rec = diagramForArtifact("plans/spec-tech_v1.md");
for (const kind of ["flowchart", "swimlane-beta", "sequence"]) {
  assert.ok(rec.kinds.includes(kind), `tech spec recommends ${kind}`);
}

rec = diagramForArtifact("architecture/selected-architecture.md");
assert.ok(rec.kinds.includes("C4Component"), "selected architecture recommends C4Component");

rec = diagramForArtifact("x/breadboard.mmd");
assert.equal(rec.derived, true, ".mmd diagram is derived");

// --- Anything else has no recommendation, and the predicate agrees. ---------
for (const path of ["state.md", "", null, 42]) {
  assert.equal(diagramForArtifact(path), null, `${String(path)} has no diagram`);
  assert.equal(isDiagrammable(path), false, `${String(path)} is not diagrammable`);
}
assert.equal(isDiagrammable("interfaces/breadboard.json"), true, "breadboard is diagrammable");

// --- Playground links preload small sources and refuse broken ones. ---------
assert.equal(pelePlaygroundUrl(""), PELE_PLAYGROUND, "empty source links the bare playground");
assert.equal(pelePlaygroundUrl(null), PELE_PLAYGROUND, "null source links the bare playground");
assert.equal(pelePlaygroundUrl("x".repeat(5000)), PELE_PLAYGROUND, "oversize source falls back to the bare playground");
const preloaded = pelePlaygroundUrl("flowchart TB");
assert.ok(preloaded.startsWith(`${PELE_PLAYGROUND}#source=`), "small source preloads via #source=");
assert.ok(preloaded.includes(encodeURIComponent("flowchart TB")), "preloaded source is encoded");

console.log("diagram strategy ok: pins, per-artifact kinds, and playground links hold");

import { derivedDiagram } from "../lib/artifact-diagram.mjs";

// --- General interfaces/*.md branch sits AFTER the exact selected-interface.md branch. ---
assert.deepEqual(
  diagramForArtifact("interfaces/option-a.md"),
  { kinds: ["block-beta", "flowchart"], source: "interfaces/*.md", derived: true },
  "general interfaces file derives block-beta/flowchart",
);
assert.equal(isDiagrammable("interfaces/option-a.md"), true, "general interfaces file is diagrammable");
assert.equal(
  diagramForArtifact("interfaces/selected-interface.md").source,
  "selected-interface.md",
  "exact selected-interface branch still wins over the general one",
);
const interfacesFenced = "# Option A\n\n```mermaid\nflowchart TB\n  A-->B\n```\n";
const interfacesOut = derivedDiagram("interfaces/option-a.md", interfacesFenced, {});
assert.equal(interfacesOut && interfacesOut.mermaid, "flowchart TB\n  A-->B", "fenced interfaces option derives its block");

console.log("diagram strategy ok: general interfaces/*.md branch pinned behind the exact one");

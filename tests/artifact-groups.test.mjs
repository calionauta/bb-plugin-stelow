import assert from "node:assert/strict";
import { STAGE_SEQUENCE, groupArtifactsByStage } from "../lib/artifact-groups.mjs";

const item = (stage, path) => ({ stage, path, display: path.split("/").pop() });

// Known stages follow the canonical sequence even when input is scrambled;
// unknown stages (and stageless items as "other") trail alphabetically.
const grouped = groupArtifactsByStage([
  item("planning", "spec-tech.md"),
  item("mystery", "x.md"),
  item("shape", "spec-product.md"),
  item("research", "brief.md"),
  item("shape", "critique.md"),
  { path: "orphan.md" },
]);
assert.deepEqual(
  grouped.map((group) => group.stage),
  ["shape", "planning", "mystery", "other", "research"],
  "sequence order first, then alphabetical including other",
);
assert.deepEqual(
  grouped.find((group) => group.stage === "shape").items.map((entry) => entry.path),
  ["spec-product.md", "critique.md"],
  "input order preserved inside a group",
);
assert.deepEqual(groupArtifactsByStage([]), [], "no artifacts, no groups");
assert.deepEqual(groupArtifactsByStage(null), [], "null input is safe");
assert.ok(STAGE_SEQUENCE.indexOf("audit") > STAGE_SEQUENCE.indexOf("triage"), "canonical order covers triage to audit");

console.log("artifact groups test ok: sequence order, unknown trailing, input order kept");

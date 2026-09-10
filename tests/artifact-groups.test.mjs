import assert from "node:assert/strict";
import { STAGE_SEQUENCE, groupArtifactsByStage, groupResearchArtifacts } from "../lib/artifact-groups.mjs";

const item = (stage, path) => ({ stage, path, display: path.split("/").pop() });

// Known stages follow the canonical sequence even when input is scrambled;
// unknown stages (and stageless items as "other") trail alphabetically.
const grouped = groupArtifactsByStage([
  item("planning", "spec-tech.md"),
  item("mystery", "x.md"),
  item("shape", "spec-product.md"),
  item("research", "research-index.md"),
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

// Research keeps the recorded round files as the source of truth. Index rows
// enrich only exact paths, so a stale index row cannot create a fake artifact.
const researchGroups = groupResearchArtifacts([
  {
    n: 2,
    strategyId: "jtbd",
    label: "Jobs to be done",
    files: [{ display: "Round 2 — Jobs to be done", path: ".stelow/demo/rounds/jtbd-r2.md", absolutePath: "/workspace/.stelow/demo/rounds/jtbd-r2.md", hostId: "host_1", generatedAt: "2026-09-10T12:00:00Z" }],
  },
  {
    n: 1,
    strategyId: "evolutionary",
    label: "Evolutionary strategy",
    files: [],
  },
], [
  { path: ".stelow/demo/rounds/jtbd-r2.md", output: "Job map and outcome analysis", notes: "Interview-led" },
  { path: "stelow/demo/rounds/missing.md", output: "Must not appear", notes: "Stale row" },
]);
assert.deepEqual(researchGroups.map((group) => group.title), ["Round 2 — Jobs to be done"], "only rounds with canonical files become artifact groups");
assert.deepEqual(researchGroups[0].items[0], {
  display: "Job map and outcome analysis",
  path: ".stelow/demo/rounds/jtbd-r2.md",
  absolutePath: "/workspace/.stelow/demo/rounds/jtbd-r2.md",
  hostId: "host_1",
  generatedAt: "2026-09-10T12:00:00Z",
  kind: "document",
  note: "Interview-led",
}, "matching index metadata enriches, but does not replace, the canonical file");

console.log("artifact groups test ok: stage order plus canonical research rounds");

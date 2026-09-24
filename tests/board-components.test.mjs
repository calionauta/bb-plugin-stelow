import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildListMeta,
  exploreListMeta,
  researchListMeta,
} from "../lib/board-list-presentation.mjs";
import { normalizeBoardView, viewsForTrack } from "../lib/board-views.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(root, "app.tsx"), "utf8");
const filters = readFileSync(join(root, "components/board/board-filters.tsx"), "utf8");
const viewToggle = readFileSync(join(root, "components/board/board-view-toggle.tsx"), "utf8");
const lists = readFileSync(join(root, "components/board/track-lists.tsx"), "utf8");

assert.deepEqual(viewsForTrack("build"), ["board", "list", "hill"], "build keeps its three views");
assert.deepEqual(viewsForTrack("research"), ["board", "list"], "research excludes hill");
assert.deepEqual(viewsForTrack("explore"), ["board", "list"], "explore excludes hill");
assert.equal(normalizeBoardView("hill", "research"), "board", "a stale lightweight hill value cannot strand research");
assert.equal(normalizeBoardView("hill", "explore"), "board", "a stale lightweight hill value cannot strand explore");
assert.equal(normalizeBoardView("list", "research"), "list", "supported lightweight views still persist");
assert.equal(normalizeBoardView("bogus", "build"), "board", "corrupt values degrade to board");
assert.throws(() => viewsForTrack("unknown"), /Unknown board track/, "unknown tracks fail at the view boundary");

assert.match(
  viewToggle,
  /viewsForTrack\(track\)\.includes\(option\.value\)/,
  "the rendered toggle derives its options from the track restriction",
);
assert.match(app, /<ViewToggle[^>]*track="build"/, "build calls the shared toggle as build");
assert.match(app, /<ViewToggle[^>]*track="research"/, "research calls the shared toggle as research");
assert.match(app, /<ViewToggle[^>]*track="explore"/, "explore calls the shared toggle as explore");
assert.equal((app.match(/useBoardView\(STORAGE_KEYS\.\w+View, "\w+"\)/g) ?? []).length, 3, "all three panels bind persistence to a track");
assert.equal((app.match(/<ViewToggle/g) ?? []).length, 3, "one shared toggle call site per board");

const scopeSummary = { scopesDone: 2, scopesTotal: 5, tasksDone: 3, tasksTotal: 7 };
assert.equal(
  buildListMeta({ status: "completed", stage: "build", scopeSummary }),
  "Completed · ✓ 2/5 scopes · 3/7 tasks",
  "completed build rows retain status and progress context",
);
assert.equal(
  buildListMeta({ status: "in-progress", stage: "plan", scopeSummary: { ...scopeSummary, scopesTotal: 0 } }),
  "plan",
  "scopeless build rows do not print empty progress",
);
assert.equal(
  researchListMeta({ researchStrategies: ["jtbd", "unknown"] }, new Map([["jtbd", "Jobs to Be Done"]])),
  "Jobs to Be Done + unknown",
  "research rows preserve known and fallback strategy labels",
);
assert.equal(researchListMeta({}, new Map()), null, "research rows without strategies omit the meta fragment");
assert.equal(
  exploreListMeta({ exploreStage: "proto" }, new Map([["proto", "Prototype"]])),
  "Prototype",
  "explore rows resolve the selected technique",
);
assert.equal(exploreListMeta({ exploreStage: "unknown" }, new Map()), "unknown", "unknown explore stages fall back to their id");
assert.equal(exploreListMeta({}, new Map()), null, "explore rows without a technique omit the meta fragment");

for (const adapter of ["BuildList", "ResearchList", "ExploreList"]) {
  assert.match(lists, new RegExp(`export function ${adapter}\\(`), `${adapter} is extracted to the board component`);
}
assert.match(lists, /export function BuildList[\s\S]*buildListMeta\(card\)/, "build list uses the tested build metadata adapter");
assert.match(lists, /export function ResearchList[\s\S]*researchListMeta\(card, strategyLabelById\)/, "research list uses strategy metadata");
assert.match(lists, /export function ExploreList[\s\S]*exploreListMeta\(card, stageLabelById\)/, "explore list uses technique metadata");
assert.equal((app.match(/function (?:BuildList|ResearchList|ExploreList)\(/g) ?? []).length, 0, "list adapters no longer live in the app shell");

assert.match(filters, /function optionalFacet\([\s\S]*!options \|\| !values \|\| !onToggle/, "a facet appears only when its complete contract exists");
assert.match(filters, /event\.key === "Escape"/, "Escape dismisses the filter popover");
assert.match(filters, /document\.addEventListener\("pointerdown"/, "outside pointer input dismisses the popover");
assert.match(filters, /type="checkbox"/, "multi-select filters use keyboard-native checkboxes");
assert.match(filters, /aria-label={`Remove \$\{facet\.label\} filter \$\{label\}`}/, "selected filter pills expose their facet and value");
assert.equal((app.match(/<FiltersBar/g) ?? []).length, 3, "all boards use the extracted filter bar");
assert.equal((app.match(/function FiltersBar\(/g) ?? []).length, 0, "the filter bar no longer lives in the app shell");

console.log("board components test ok: view restrictions, metadata, and shared controls");

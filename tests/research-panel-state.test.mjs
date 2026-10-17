import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  filterAndGroupResearchCards,
  researchCardListRequest,
  researchCardMatches,
  researchPresetFor,
  strategyLabelsById,
} from "../lib/research-panel-state.mjs";

/**
 * The Research track's own state rules and generic wiring.
 *
 * Explore/Research shells are deleted: both tracks mount through
 * TrackPanelForKind with per-track configs. These pins guard the
 * delegation (configs + shared renderers), not the old per-track
 * shell bodies.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");
const panelRendering = read("components/app-support/panel-rendering.tsx");
const genericPanel = read("components/panels/track-panel.tsx");
const genericState = read("components/panels/track-panel-state.ts");
const genericView = read("components/panels/track-panel-view.tsx");
const genericDialogs = read("components/panels/track-panel-dialogs.tsx");

const researchFilters = {
  columns: ["inbox", "doing", "done", "archived"],
  projectIds: [],
  attention: false,
};
const researchCard = (overrides = {}) => ({
  projectId: "project-1",
  status: "pending",
  needsAttention: false,
  updatedAt: 1,
  ...overrides,
});
assert.deepEqual(
  researchCardListRequest("project-2"),
  { projectId: "project-2", kind: "research" },
  "a project switch scopes the card request to that project and track",
);
assert.match(
  genericState,
  /RESEARCH_PANEL_CONFIG[\s\S]*catalogRpc: "researchStrategies"/,
  "Research keeps its strategy catalog behind the generic loader",
);
const researchGroups = filterAndGroupResearchCards([
  researchCard({ id: "unknown", status: "unexpected", updatedAt: 1 }),
  researchCard({ id: "archived", status: "archived", updatedAt: 2 }),
  researchCard({ id: "done", status: "completed", updatedAt: 3 }),
  researchCard({ id: "running", status: "in-progress", updatedAt: 4 }),
], researchFilters);
assert.deepEqual(Object.keys(researchGroups), ["inbox", "doing", "done", "archived"]);
assert.deepEqual(researchGroups.inbox.map((entry) => entry.id), ["unknown"]);
assert.deepEqual(researchGroups.done.map((entry) => entry.id), ["done"]);
assert.deepEqual(researchGroups.archived.map((entry) => entry.id), ["archived"]);
assert.equal(
  researchCardMatches(researchCard({ projectId: "project-2" }), {
    ...researchFilters,
    projectIds: ["project-1"],
  }),
  false,
  "project switching never leaks a card from another project",
);
assert.equal(
  researchCardMatches(researchCard(), { ...researchFilters, attention: true }),
  false,
  "attention mode never admits a card that needs no decision",
);
assert.equal(
  researchCardMatches(
    researchCard({ projectId: "project-2", needsAttention: true }),
    { ...researchFilters, projectIds: ["project-1"], attention: true },
  ),
  false,
  "project and attention filters both apply",
);
// The move policy is gone, and this pin guards its absence. A card used to be dragged
// between columns; the workflow is the agent's to drive, and a person who wants a card
// elsewhere asks the agent in the conversation. Re-adding a drop target is the
// regression — it makes the board read as a manual tool.
assert.doesNotMatch(
  genericPanel,
  /onMoveCard|moveResearchCard/,
  "no manual card-move control survives in the Research track",
);
assert.match(
  panelRendering,
  /TrackPanelForKind[\s\S]*RESEARCH_PANEL_CONFIG[\s\S]*RESEARCH_VIEW_CONFIG[\s\S]*RESEARCH_DIALOGS_CONFIG/,
  "research mounts through the generic track panel with its configs",
);
assert.match(
  genericView,
  /RESEARCH_VIEW_CONFIG/,
  "Research view config lives on the generic track view",
);
assert.match(
  genericView,
  /TrackListForKind/,
  "Research lists render through the shared kind-driven list",
);
assert.match(
  genericView,
  /renderTrackCardForKind/,
  "Research tiles render through the shared kind-driven card",
);
assert.match(
  genericDialogs,
  /RESEARCH_DIALOGS_CONFIG/,
  "Research dialogs delegate to the generic track dialogs with their config",
);
const strategyLabels = strategyLabelsById([
  { id: "strategy-a", label: "Jobs to be Done" },
  { id: "strategy-b", label: "Opportunity Mapping" },
]);
assert.equal(strategyLabels.get("strategy-a"), "Jobs to be Done");
assert.equal(strategyLabels.get("strategy-b"), "Opportunity Mapping");
const researchPresets = [
  { id: "default", isDefault: true },
  { id: "research", isDefault: false },
];
assert.deepEqual(
  researchPresetFor(researchPresets, [{ band: "research", presetId: "research" }]),
  { preset: researchPresets[1], hasBandPreset: true },
  "the research band assignment reaches the creation dialog",
);
assert.deepEqual(
  researchPresetFor(researchPresets, []),
  { preset: researchPresets[0], hasBandPreset: false },
  "an unset research band truthfully falls back to the board default",
);
assert.deepEqual(
  researchPresetFor(researchPresets, [{ band: "research", presetId: "missing" }]),
  { preset: researchPresets[0], hasBandPreset: false },
  "a stale research assignment falls back without claiming a band preset",
);
assert.deepEqual(
  researchPresetFor(researchPresets, [{ band: "explore", presetId: "research" }]),
  { preset: researchPresets[0], hasBandPreset: false },
  "another track's assignment never configures research",
);
assert.deepEqual(
  researchPresetFor([{ id: "first" }], []),
  { preset: { id: "first" }, hasBandPreset: false },
  "an unmarked preset list uses its first entry",
);
assert.deepEqual(
  researchPresetFor([], []),
  { preset: null, hasBandPreset: false },
  "an empty preset list creates no phantom assignment",
);
assert.match(
  genericView,
  /researchListMeta[\s\S]*joinStrategyLabels/,
  "board tiles and list rows receive the same strategy label map",
);
const researchCreationWiring = new RegExp([
  /<CreateTrackDialog/,
  /activeProjectId=\{props\.projectId\}/,
  /catalog=\{catalog/,
  /preset=\{props\.preset\.preset/,
  /hasBandPreset=\{props\.preset\.hasBandPreset\}/,
  /config=\{props\.config\.dialogConfig\}/,
].map((pattern) => pattern.source).join("[\\s\\S]*?"));
assert.match(
  genericDialogs,
  researchCreationWiring,
  "creation receives the active project, strategy catalog, and resolved preset",
);
assert.match(
  genericDialogs,
  /renderOnboarding\(\{[\s\S]*storageKey: props\.config\.onboardKey[\s\S]*renderPresetManager\(\{[\s\S]*presets: props\.data\.presets/,
  "research keeps onboarding and preset-manager wiring",
);
console.log("research panel state ok: filters, grouping, loader and wiring");

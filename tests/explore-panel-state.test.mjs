import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  exploreCardListRequest,
  exploreCardMatches,
  explorePresetFor,
  filterAndGroupExploreCards,
  techniqueLabelsById,
} from "../lib/explore-panel-state.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const panelState = readFileSync(
  join(root, "components/panels/explore-panel-state.ts"),
  "utf8",
);
const panel = readFileSync(
  join(root, "components/panels/explore-panel.tsx"),
  "utf8",
);
const dialogs = readFileSync(
  join(root, "components/panels/explore-panel-dialogs.tsx"),
  "utf8",
);

assert.deepEqual(
  exploreCardListRequest("project_1"),
  { projectId: "project_1", kind: "explore" },
  "explore loads only the active project's exploration cards",
);

const cards = [
  { id: "card_old", projectId: "project_1", status: "inbox", needsAttention: false, updatedAt: 1 },
  { id: "card_new", projectId: "project_1", status: "in-progress", needsAttention: true, updatedAt: 2 },
  { id: "card_other", projectId: "project_2", status: "inbox", needsAttention: true, updatedAt: 3 },
];
const filters = { columns: ["inbox", "doing", "done", "archived"], projectIds: ["project_1"], attention: true };
assert.equal(exploreCardMatches(cards[0], filters), false, "attention filter excludes ordinary cards");
assert.deepEqual(filterAndGroupExploreCards(cards, filters), {
  inbox: [],
  doing: [cards[1]],
  done: [],
  archived: [],
}, "filtered groups keep the lightweight columns and newest ordering");

assert.deepEqual(
  [...techniqueLabelsById([{ id: "map", label: "Map the terrain" }])],
  [["map", "Map the terrain"]],
  "technique labels preserve the catalog ids",
);
assert.deepEqual(
  explorePresetFor(
    [{ id: "default", isDefault: true }, { id: "explore" }],
    [{ band: "explore", presetId: "explore" }],
  ),
  { preset: { id: "explore" }, hasBandPreset: true },
  "an explore assignment wins over the board default",
);
assert.deepEqual(
  explorePresetFor([{ id: "default", isDefault: true }], []),
  { preset: { id: "default", isDefault: true }, hasBandPreset: false },
  "explore falls back to the board default without an assignment",
);

// The move policy is gone with the drop target it served, and this pin guards its
// absence. See the Research panel test for the reasoning: the agent drives the workflow,
// and a person who wants a card elsewhere asks it in the conversation. Re-adding a drop
// target is the regression — it makes the board read as a manual tool.
assert.doesNotMatch(
  panel,
  /onMoveCard|moveExploreCard/,
  "no manual card-move control survives in the Explore panel",
);

const loadRpcs = new RegExp([
  /rpc\.call\("projects", \{\}\)/,
  /rpc\.call\("listCards", exploreCardListRequest\(projectId\)\)/,
  /rpc\.call\("stageCatalog", \{\}\)/,
  /rpc\.call\("listPresets", \{\}\)/,
  /rpc\.call\("listBandPresets", \{\}\)/,
].map((pattern) => pattern.source).join("[\\s\\S]*?"));
assert.match(panelState, loadRpcs, "Explore loads every dialog and board dataset");
assert.match(
  panelState,
  /realtimeChannels: \["card-state", "board-changed", "inbox-changed"\]/,
  "Explore refreshes cards, boards, and inbox-driven state changes",
);
assert.match(
  panel,
  /onNewExplore=\{controller\.openCreate\}[\s\S]*onOpenPresets=\{controller\.openPresets\}/,
  "the Explore header actions open the creation and preset dialogs",
);
// The thread router is the part that survives: drops are gone with the drop target.
assert.match(
  panel,
  /onOpenThread=\{\(threadId\) => navigate\.toThread\(threadId\)\}/,
  "Explore threads reach the host router",
);
assert.match(
  panel,
  /onChanged=\{props\.state\.load\}/,
  "preset changes refresh the active Explore panel",
);
const creationWiring = new RegExp([
  /<CreateExploreDialog/,
  /activeProjectId=\{props\.projectId\}/,
  /stages=\{props\.data\.stages\}/,
  /explorePreset=\{props\.preset\.preset\}/,
  /hasBandPreset=\{props\.preset\.hasBandPreset\}/,
].map((pattern) => pattern.source).join("[\\s\\S]*?"));
assert.match(
  dialogs,
  creationWiring,
  "creation receives the active project, technique catalog, and resolved preset",
);
const onboardingAndManagerWiring = new RegExp([
  /renderOnboarding\(\{/,
  /storageKey: STORAGE_KEYS\.onboardExplore/,
  /renderPresetManager\(\{/,
  /presets: props\.data\.presets/,
  /onChanged: props\.onChanged/,
].map((pattern) => pattern.source).join("[\\s\\S]*?"));
assert.match(
  dialogs,
  onboardingAndManagerWiring,
  "onboarding and preset management retain their refreshable wiring",
);

console.log(
  "explore panel state test ok: data, filters, labels, presets, dialogs, and moves",
);

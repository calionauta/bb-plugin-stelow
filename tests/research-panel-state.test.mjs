import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  filterAndGroupResearchCards,
  moveResearchCard,
  researchCardListRequest,
  researchCardMatches,
  researchPresetFor,
  strategyLabelsById,
} from "../lib/research-panel-state.mjs";

/**
 * The Research panel's own state rules and wiring.
 *
 * Split out of `kanban-layout.test.mjs`, which had grown to hold two unrelated concerns:
 * the shared column sizing every board uses, and this panel's filtering, grouping and
 * loader wiring. The split was forced by the repository's 400-line file budget, which is
 * the budget working — the file was over it, and the seam it exposed is real rather than
 * arbitrary.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");
// The panel sources this file's wiring pins read. Named here rather than inline so a
// renamed panel is one edit instead of six.
const researchPanel = read("components/panels/research-panel.tsx");
const researchPanelView = read("components/panels/research-panel-view.tsx");
const researchPanelDialogs = read("components/panels/research-panel-dialogs.tsx");

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
  readFileSync(join(root, "components", "panels", "research-panel-state.ts"), "utf8"),
  /loadResearchData\(rpc, projectId\)[\s\S]*\[projectId, rpc\]/,
  "the Research loader reloads when the routed project changes",
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
const moveCalls = [];
const moveErrors = [];
await moveResearchCard(
  async (cardId, status) => {
    moveCalls.push([cardId, status]);
    return { ok: true };
  },
  "card_1",
  "done",
  (message) => moveErrors.push(message),
);
await moveResearchCard(
  async (cardId, status) => {
    moveCalls.push([cardId, status]);
    return { ok: false };
  },
  "card_2",
  "doing",
  (message) => moveErrors.push(message),
);
await moveResearchCard(
  async (cardId, status) => {
    moveCalls.push([cardId, status]);
    return { ok: true };
  },
  "card_3",
  "shape",
  (message) => moveErrors.push(message),
);
assert.deepEqual(
  moveCalls,
  [["card_1", "done"], ["card_2", "doing"]],
  "valid lightweight drops move the card and reject cross-track targets",
);
assert.deepEqual(
  moveErrors,
  ["Move failed"],
  "a refused move reaches the panel's failure surface",
);
assert.match(
  researchPanel,
  /onMoveCard=\{\(cardId, target\) => void moveResearchCard\(rpc, cardId, target\)\}/,
  "the Research board delegates drops to the tested move policy",
);
assert.match(
  researchPanel,
  /onOpenThread=\{\(threadId\) => navigate\.toThread\(threadId\)\}/,
  "Research list thread actions reach the host thread router",
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
  researchPanelView,
  /<ResearchList[\s\S]*strategyLabelById=\{state\.labels\}[\s\S]*<ResearchCard[\s\S]*joinStrategyLabels\(card\.researchStrategies \?\? \[\], state\.labels\)/,
  "board tiles and list rows receive the same strategy label map",
);
const researchCreationWiring = new RegExp([
  /<CreateResearchDialog/,
  /activeProjectId=\{props\.projectId\}/,
  /strategies=\{props\.data\.strategies\}/,
  /researchPreset=\{props\.preset\.preset\}/,
  /hasBandPreset=\{props\.preset\.hasBandPreset\}/,
].map((pattern) => pattern.source).join("[\\s\\S]*?"));
assert.match(
  researchPanelDialogs,
  researchCreationWiring,
  "creation receives the active project, strategy catalog, and resolved preset",
);
assert.match(
  researchPanelDialogs,
  /renderOnboarding\(\{[\s\S]*storageKey: STORAGE_KEYS\.onboardResearch[\s\S]*renderPresetManager\(\{[\s\S]*presets: props\.data\.presets/,
  "research keeps onboarding and preset-manager wiring",
);console.log("research panel state ok: filters, grouping, loader and wiring");

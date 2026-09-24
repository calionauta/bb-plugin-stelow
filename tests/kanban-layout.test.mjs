import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { KANBAN_COLUMN_WIDTHS, kanbanGridColumns, toggleFilterValue, matchesFilterValue } from "../lib/kanban-layout.mjs";
import {
  filterAndGroupResearchCards,
  moveResearchCard,
  researchCardListRequest,
  researchCardMatches,
  researchPresetFor,
  strategyLabelsById,
} from "../lib/research-panel-state.mjs";

assert.deepEqual(KANBAN_COLUMN_WIDTHS, {
  expanded: "minmax(240px, 320px)",
  collapsed: "56px",
}, "all boards use bounded column widths");

const columns = kanbanGridColumns(["inbox", "doing", "archived"], { archived: true });
assert.equal(columns, "minmax(240px, 320px) minmax(240px, 320px) 56px", "open and collapsed columns retain their own bounds");
assert.doesNotMatch(columns, /\bfr\b/, "extra canvas space must not stretch Kanban columns");

// Bucket gallery: one button per track opens its captured pile as an
// expanded modal — the same tiles as the board, at the board's own size
// (the shared column bounds, natural height) filling left to right and
// wrapping down with vertical scroll. Hill piles reuse the same dialog
// through params, so a second modal fails here.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(root, "app.tsx"), "utf8");
const buildPanel = readFileSync(join(root, "components", "panels", "build-panel.tsx"), "utf8");
const buildPanelDialogs = readFileSync(join(root, "components", "panels", "build-panel-dialogs.tsx"), "utf8");
const buildPanelView = readFileSync(join(root, "components", "panels", "build-panel-view.tsx"), "utf8");
const researchPanel = readFileSync(join(root, "components", "panels", "research-panel.tsx"), "utf8");
const explorePanel = readFileSync(join(root, "components", "panels", "explore-panel.tsx"), "utf8");
const researchPanelDialogs = readFileSync(join(root, "components", "panels", "research-panel-dialogs.tsx"), "utf8");
const researchPanelView = readFileSync(join(root, "components", "panels", "research-panel-view.tsx"), "utf8");
const explorePanelView = readFileSync(join(root, "components", "panels", "explore-panel-view.tsx"), "utf8");
const boardFilters = readFileSync(join(root, "components", "board", "board-filters.tsx"), "utf8");
const trackLists = readFileSync(join(root, "components", "board", "track-lists.tsx"), "utf8");
const boardCards = readFileSync(join(root, "components", "board", "board-cards.tsx"), "utf8");
const cardGallery = readFileSync(join(root, "components", "board", "card-gallery.tsx"), "utf8");
const hillBoard = readFileSync(join(root, "components", "board", "hill-board.tsx"), "utf8");
const buildDialogKanban = readFileSync(join(root, "components", "creation", "create-build-dialog.tsx"), "utf8");
const researchDialogKanban = readFileSync(join(root, "components", "creation", "create-research-dialog.tsx"), "utf8");
const exploreDialogKanban = readFileSync(join(root, "components", "creation", "create-explore-dialog.tsx"), "utf8");
assert.equal(
  (buildPanelView.match(/<BucketGalleryButton/g) ?? []).length
    + (researchPanelView.match(/<BucketGalleryButton/g) ?? []).length
    + (explorePanelView.match(/<BucketGalleryButton/g) ?? []).length,
  3,
  "build, research, and explore each offer the Bucket gallery",
);
// Rendered boards hide the Bucket column (grouping, moves, and filters
// keep the full catalog): the kanban grids and extracted list adapters
// iterate the visible lists, so no empty Bucket column renders anywhere.
assert.match(buildPanelView, /BUILD_BOARD_VISIBLE_COLUMNS\.map\(\(column\) => \(/, "build kanban iterates visible columns");
assert.match(researchPanelView, /LIGHTWEIGHT_VISIBLE_COLUMNS\.map\(\(column\) => \(/, "research kanban iterates visible columns");
assert.match(explorePanelView, /LIGHTWEIGHT_VISIBLE_COLUMNS\.map\(\(column\) => \(/, "explore kanban iterates visible columns");
assert.match(trackLists, /const BUILD_COLUMNS = BUILD_BOARD_VISIBLE_COLUMNS/, "build lists omit the Bucket column");
assert.match(trackLists, /const LIGHTWEIGHT_COLUMNS = LIGHTWEIGHT_VISIBLE_COLUMNS/, "lightweight lists omit the Bucket column");
for (const [track, source] of [
  ["build", buildPanelView],
  ["research", researchPanelView],
  ["explore", explorePanelView],
]) {
  assert.doesNotMatch(
    source,
    /{COLUMNS\.map\(\(column\) => \(|{RESEARCH_COLUMNS\.map\(\(column\) => \(/,
    `${track} renders no Bucket column`,
  );
}
assert.ok(
  buildPanelView.includes(
    "kanbanGridColumns(BUILD_BOARD_VISIBLE_COLUMNS, state.collapsedColumns)",
  ),
  "the build grid template matches its rendered columns",
);
assert.ok(
  researchPanelView.includes(
    "kanbanGridColumns(LIGHTWEIGHT_VISIBLE_COLUMNS, state.collapsedColumns)",
  ),
  "the research grid template matches its rendered columns",
);
assert.ok(
  explorePanelView.includes("kanbanGridColumns(LIGHTWEIGHT_VISIBLE_COLUMNS, state.collapsedColumns)"),
  "the explore grid template matches its rendered columns",
);
// Order is product: New, then Bucket, then Agent Presets — the pile sits
// beside creation, before configuration. A drift back fails here.
for (const [label, source] of [
  ["New issue", buildPanelView],
  ["New research", researchPanelView],
  ["New exploration", explorePanelView],
]) {
  const at = source.indexOf(label);
  assert.ok(at >= 0, `${label} button exists`);
  const window = source.slice(at, at + 900);
  assert.ok(window.includes("<BucketGalleryButton"), `${label} is followed by the Bucket gallery`);
  assert.ok(window.indexOf("<BucketGalleryButton") < window.indexOf("Agent Presets"), "Bucket precedes Agent Presets");
}
assert.match(
  buildPanelView,
  /import \{ BucketGalleryButton \} from "\.\.\/board\/card-gallery"/,
  "the Build panel mounts the extracted gallery feature",
);
assert.equal((cardGallery.match(/export function CardGalleryDialog\(/g) ?? []).length, 1, "one shared gallery dialog implementation");
assert.equal((hillBoard.match(/<CardGalleryDialog/g) ?? []).length, 1, "only the hill pile mounts the dialog outside the Bucket feature");
assert.match(cardGallery, /<CardGalleryDialog/, "the Bucket hook mounts the same dialog implementation");
assert.equal(
  (buildPanel.match(/useBucketGallery\(/g) ?? []).length
    + (researchPanel.match(/useBucketGallery\(/g) ?? []).length
    + (explorePanel.match(/useBucketGallery\(/g) ?? []).length,
  3,
  "each track owns one pile opener shared by its header and creation dialog",
);
assert.match(buildDialogKanban, /bucketGallery=\{bucketGallery\}/, "the build dialog receives its track pile opener as a prop");
assert.equal(
  (buildDialogKanban.match(/bucketGallery\.bucketGallery/g) ?? []).length
    + (buildPanelDialogs.match(/bucketGallery\.bucketGallery/g) ?? []).length
    + (researchDialogKanban.match(/bucketGallery\.bucketGallery/g) ?? []).length
    + (exploreDialogKanban.match(/bucketGallery\.bucketGallery/g) ?? []).length,
  3,
  "the Build, Research, and Explore galleries mount once inside their creation dialogs",
);
assert.match(
  buildPanelView,
  /Swipe sideways to view every stage\.[\s\S]*Use Shift \+ scroll to move across stages\./,
  "the Build board keeps its mobile and desktop scroll guidance",
);
assert.equal(((app.match(/onViewBucket=\{bucketGallery\.openBucketGallery\}/g) ?? []).length + (buildDialogKanban.match(/onViewBucket=\{bucketGallery\.openBucketGallery\}/g) ?? []).length + (researchDialogKanban.match(/onViewBucket=\{bucketGallery\.openBucketGallery\}/g) ?? []).length + (exploreDialogKanban.match(/onViewBucket=\{bucketGallery\.openBucketGallery\}/g) ?? []).length), 3, "each creation checkbox links to its pile's gallery");
assert.doesNotMatch(app, /HillClusterDialog/, "the bespoke cluster overlay is gone");
assert.doesNotMatch(
  app,
  /function CardGalleryDialog|function bucketGalleryCopy|function useBucketGallery|function BucketGalleryButton/,
  "gallery behavior has one feature owner outside app.tsx",
);
// Tiles are the board's own tiles at the board's own size. The track bound
// is derived from KANBAN_COLUMN_WIDTHS.expanded, never a stretched `1fr`,
// so a wide modal cannot inflate a narrow card; the class text stays
// literal because Tailwind only emits classes it can read in source, so
// this assertion is the join between the constant and the markup.
const [minBound, maxBound] = KANBAN_COLUMN_WIDTHS.expanded.replace(/^minmax\(|\)$/g, "").split(", ").map((value) => value.trim());
const tilesAt = cardGallery.indexOf("data-gallery-tiles");
assert.ok(tilesAt >= 0, "the gallery grid is addressable");
const galleryGrid = cardGallery.slice(tilesAt, cardGallery.indexOf(">", tilesAt));
assert.ok(galleryGrid.includes(`repeat(auto-fill,minmax(min(${minBound},100%),${maxBound}))`), "gallery tracks take the board column's own bounds");
assert.ok(galleryGrid.includes("justify-start"), "tiles begin at the left edge and fill rightwards");
assert.ok(galleryGrid.includes("items-start"), "a tile keeps the board's natural height");
assert.ok(galleryGrid.includes("content-start"), "rows pin to the top: a short pile never centers in the tall modal");
assert.doesNotMatch(galleryGrid, /\b1fr\b/, "no gallery track stretches to fill the modal");
assert.doesNotMatch(cardGallery, /auto-rows-fr/, "gallery rows are never stretched to equal heights");
assert.doesNotMatch(cardGallery, /\[&>\.stelow-board-card\]:h-full/, "gallery tiles are never stretched vertically");
assert.doesNotMatch(cardGallery, /grid-flow-col/, "gallery flow is row-major: rightwards, then down");
assert.match(cardGallery, /sm:w-\[70vw\]/, "the gallery takes seventy percent of the viewport width");
assert.match(
  cardGallery,
  /className="h-\[85dvh\] overflow-y-auto sm:w-\[70vw\]/,
  "the gallery height is fixed at 85dvh with internal scroll, never content-sized",
);
assert.match(cardGallery, /\{cards\.length === 0 \? \(/, "an empty pile reads one line, never a dead modal");
assert.match(boardCards, /export function BoardCard\(\{ card, onOpen \}/, "tiles require an open action through the extracted board card");
assert.match(boardCards, /const open = useCallback\(\(\) => onOpen\(\), \[onOpen\]\)/, "click and keyboard activation share that open action");
assert.equal(
  (buildPanelView.match(/onOpen=\{\(\) => onOpenCard\(card, card\.id\)\}/g) ?? []).length
    + (researchPanelView.match(/onOpen=\{\(\) => props\.onOpenCard\(card, card\.id\)\}/g) ?? []).length
    + (explorePanelView.match(/onOpen=\{\(\) => props\.onOpenCard\(card, card\.id\)\}/g) ?? []).length,
  3,
  "Build, Research, and Explore columns each open their card through the panel router",
);
assert.match(
  cardGallery,
  /onOpen=\{\(\) => onOpenCard\(card\)\}/,
  "gallery cards pass their own open-card action instead of a no-op",
);
assert.equal(
  (buildPanel.match(/openBuildCard\(navigate\)/g) ?? []).length
    + (researchPanel.match(/openResearchCard\(navigate\)/g) ?? []).length
    + (explorePanel.match(/openExploreCard\(navigate\)/g) ?? []).length,
  3,
  "each track has one Bucket callback owned by the panel router",
);
assert.equal(
  (explorePanel.match(/const openCard = openExploreCard\(navigate\)/g) ?? []).length,
  1,
  "explore shares one callback for its header and creation gallery",
);
assert.match(
  buildPanel,
  /const openCard = openBuildCard\(navigate\)[\s\S]*onOpenCard: openCard/,
  "the Build controller receives the panel's card-navigation callback",
);
assert.match(
  buildPanel,
  /useBucketGallery\([\s\S]*props\.onOpenCard\(card, card\.id\)/,
  "the shared creation gallery delegates through that callback",
);
assert.match(cardGallery, /useBucketGallery\(cards, onOpenCard\)/, "the Bucket hook delegates card navigation to its caller");
assert.match(cardGallery, /setOpen\(false\);[\s\S]*onOpenCard\(card\)/, "choosing a Bucket card closes before delegated navigation");
assert.doesNotMatch(
  cardGallery,
  /rememberStelowReturnFocusCardId|cardSubPath|toPluginPanel/,
  "the gallery cannot fork focus or panel-route ownership",
);
assert.match(
  cardGallery,
  /className="min-h-11 w-full cursor-pointer sm:w-auto sm:flex-none"/,
  "the Bucket gallery button has a pointer cursor and responsive target",
);
assert.match(
  readFileSync(join(root, "components", "panels", "build-panel-state.ts"), "utf8"),
  /stageOptions: STAGE_SEQUENCE/,
  "stage filter lists the canonical sequence, never just stages with cards",
);
assert.match(boardFilters, /export function FilterMultiSelect/, "facets share one checkbox list, never per-field selects");
const explorePanelState = readFileSync(
  join(root, "components", "panels", "explore-panel-state.ts"),
  "utf8",
);
assert.match(
  explorePanelState,
  /toggleFilterValue\(current, value\)/,
  "explore filters toggle through one helper",
);
assert.doesNotMatch(app, /function FilterSelect\(/, "the single-select is gone");
assert.deepEqual(toggleFilterValue([], "a"), ["a"], "empty toggles on");
assert.deepEqual(toggleFilterValue(["a", "b"], "a"), ["b"], "present toggles off, order kept");
assert.deepEqual(toggleFilterValue(null, "a"), ["a"], "junk toggles on");
assert.equal(matchesFilterValue([], "a"), true, "empty matches everything");
assert.equal(matchesFilterValue(["a"], "a"), true, "membership matches");
assert.equal(matchesFilterValue(["a"], "b"), false, "absence filters");
assert.equal(matchesFilterValue(null, "a"), true, "junk matches everything");

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
  researchCard({ id: "approved", status: "approved", updatedAt: 5 }),
], researchFilters);
assert.deepEqual(Object.keys(researchGroups), ["inbox", "doing", "done", "archived"]);
assert.deepEqual(researchGroups.inbox.map((entry) => entry.id), ["unknown"]);
assert.deepEqual(researchGroups.doing.map((entry) => entry.id), ["approved", "running"]);
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
);

console.log("kanban layout test ok: bounded columns and research panel state");

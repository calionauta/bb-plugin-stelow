import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOf } from "./helpers/source-code.mjs";
import {
  KANBAN_COLUMN_WIDTHS,
  kanbanGridColumns,
  toggleFilterValue,
  matchesFilterValue,
} from "../lib/kanban-layout.mjs";
import {
} from "../lib/research-panel-state.mjs";

assert.deepEqual(KANBAN_COLUMN_WIDTHS, {
  expanded: "minmax(240px, 320px)",
  collapsed: "56px",
  mobileExpanded: "min(85vw, 320px)",
}, "all boards use bounded column widths, with a deliberate phone track beside them");

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
const researchPanelView = readFileSync(join(root, "components", "panels", "research-panel-view.tsx"), "utf8");
const explorePanelView = readFileSync(join(root, "components", "panels", "explore-panel-view.tsx"), "utf8");
const boardFilters = readFileSync(join(root, "components", "board", "board-filters.tsx"), "utf8");
const trackLists = readFileSync(join(root, "components", "board", "track-lists.tsx"), "utf8");
const boardCards = readFileSync(join(root, "components", "board", "board-cards.tsx"), "utf8");
// Read with comments stripped: assertions below guard the ABSENCE of class names that this
// file explains in prose, and a comment naming one would satisfy a raw-source match.
const cardGallery = codeOf(readFileSync(join(root, "components", "board", "card-gallery.tsx"), "utf8"));
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
assert.match(
  buildPanelView,
  /kanbanGridColumns\(\s*BUILD_BOARD_VISIBLE_COLUMNS/,
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
// Counted across the four surfaces, one line per file so the sum is readable.
const bucketLinks = [app, buildDialogKanban, researchDialogKanban, exploreDialogKanban].map(
  (source) => (source.match(/onViewBucket=\{bucketGallery\.openBucketGallery\}/g) ?? []).length,
);
assert.equal(
  bucketLinks.reduce((total, count) => total + count, 0),
  3,
  "each creation checkbox links to its pile's gallery",
);
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
// `auto-fit`, not `auto-fill`, and the bound stays the board column's own.
//
// `auto-fill` creates phantom tracks to fill the width, so four cards in a wide modal
// reserved the empty columns as real tracks and every tile huddled left with a void beside
// them — reported from a screenshot of the Bucket. `auto-fit` collapses the empty tracks.
//
// The `maxBound` half is unchanged and load-bearing: the assertion below forbids `1fr`
// because a tile is the board's own tile at the board's own size. Fixing the void by
// stretching the cards would trade one defect for a worse one.
assert.ok(
  galleryGrid.includes(`repeat(auto-fit,minmax(min(${minBound},100%),${maxBound}))`),
  "gallery tracks collapse empty columns and keep the board column's own bounds",
);
assert.ok(galleryGrid.includes("justify-start"), "tiles begin at the left edge and fill rightwards");
assert.ok(galleryGrid.includes("items-start"), "a tile keeps the board's natural height");
assert.ok(galleryGrid.includes("content-start"), "rows pin to the top: a short pile never centers in the tall modal");
assert.doesNotMatch(galleryGrid, /\b1fr\b/, "no gallery track stretches to fill the modal");
assert.doesNotMatch(cardGallery, /auto-rows-fr/, "gallery rows are never stretched to equal heights");
assert.doesNotMatch(cardGallery, /\[&>\.stelow-board-card\]:h-full/, "gallery tiles are never stretched vertically");
assert.doesNotMatch(cardGallery, /grid-flow-col/, "gallery flow is row-major: rightwards, then down");
// The HEIGHT stays fixed with internal scroll — a short pile must not resize the modal as
// cards arrive, and a long one must not push the header off-screen. The WIDTH follows the
// content instead of a fixed share of the viewport.
//
// `sm:w-[70vw]` was chosen for a full grid and reads as a mistake for four cards: the modal
// stayed wide while the tiles huddled left, which is what the screenshot showed. The width is
// now bounded by a readable measure (`32rem`) and by the viewport, so a small bucket sits
// narrow and a large one grows. The `h-[85dvh] overflow-y-auto` pair is unchanged.
assert.match(
  cardGallery,
  /h-\[85dvh\] overflow-y-auto/,
  "the gallery height is fixed at 85dvh with internal scroll, never content-sized",
);
assert.match(
  cardGallery,
  /sm:max-w-\[min\(92vw,64rem\)\]/,
  "and its width follows the content within a readable bound, so four cards do not sit inside a wide empty modal",
);
assert.doesNotMatch(
  cardGallery,
  /sm:w-\[70vw\]/,
  "the fixed seventy-percent width is gone: it held the modal open at a size its contents did not fill",
);
assert.match(cardGallery, /\{cards\.length === 0 \? \(/, "an empty pile reads one line, never a dead modal");
assert.match(boardCards, /export function BoardCard\(\{ card, onOpen/, "tiles require an open action through the extracted board card");
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

console.log("kanban layout test ok: bounded columns and research panel state");

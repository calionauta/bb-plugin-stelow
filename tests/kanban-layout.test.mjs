import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { KANBAN_COLUMN_WIDTHS, kanbanGridColumns, toggleFilterValue, matchesFilterValue } from "../lib/kanban-layout.mjs";

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
const boardFilters = readFileSync(join(root, "components", "board", "board-filters.tsx"), "utf8");
const trackLists = readFileSync(join(root, "components", "board", "track-lists.tsx"), "utf8");
const buildDialogKanban = readFileSync(join(root, "components", "creation", "create-build-dialog.tsx"), "utf8");
const researchDialogKanban = readFileSync(join(root, "components", "creation", "create-research-dialog.tsx"), "utf8");
const exploreDialogKanban = readFileSync(join(root, "components", "creation", "create-explore-dialog.tsx"), "utf8");
assert.equal((app.match(/<BucketGalleryButton cards=\{grouped\.inbox \?\? \[\]\} \/>/g) ?? []).length, 3, "build, research, and explore each offer the Bucket gallery");
// Rendered boards hide the Bucket column (grouping, moves, and filters
// keep the full catalog): the kanban grids and extracted list adapters
// iterate the visible lists, so no empty Bucket column renders anywhere.
assert.match(app, /VISIBLE_COLUMNS\.map\(\(column\) => \(/, "build kanban iterates visible columns");
assert.match(app, /VISIBLE_RESEARCH_COLUMNS\.map\(\(column\) => \(/, "lightweight kanban iterates visible columns");
assert.match(trackLists, /const BUILD_COLUMNS = BUILD_BOARD_VISIBLE_COLUMNS/, "build lists omit the Bucket column");
assert.match(trackLists, /const LIGHTWEIGHT_COLUMNS = LIGHTWEIGHT_VISIBLE_COLUMNS/, "lightweight lists omit the Bucket column");
assert.doesNotMatch(app, /{COLUMNS\.map\(\(column\) => \(/, "the build kanban renders no Bucket column");
assert.doesNotMatch(app, /{RESEARCH_COLUMNS\.map\(\(column\) => \(/, "lightweight kanbans render no Bucket column");
assert.ok(app.includes("kanbanGridColumns(VISIBLE_COLUMNS, collapsedColumns)"), "the build grid template matches its rendered columns");
assert.ok(app.includes("kanbanGridColumns(VISIBLE_RESEARCH_COLUMNS, collapsedColumns)"), "lightweight grid templates match their rendered columns");
// Order is product: New, then Bucket, then Agent Presets — the pile sits
// beside creation, before configuration. A drift back fails here.
for (const label of ["New issue", "New research", "New exploration"]) {
  const at = app.indexOf(`/> ${label}</Button>`);
  assert.ok(at >= 0, `${label} button exists`);
  const window = app.slice(at, at + 400);
  assert.ok(window.includes("<BucketGalleryButton"), `${label} is followed by the Bucket gallery`);
  assert.ok(window.indexOf("<BucketGalleryButton") < window.indexOf("Agent Presets</Button>"), "Bucket precedes Agent Presets");
}
assert.equal((app.match(/<CardGalleryDialog/g) ?? []).length, 2, "one shared gallery dialog: the Bucket button and the hill pile");
assert.equal((app.match(/const bucketGallery = useBucketGallery\(grouped\.inbox \?\? \[\]\);/g) ?? []).length, 3, "each track owns one pile opener shared by its header and creation dialog");
assert.match(buildDialogKanban, /bucketGallery=\{bucketGallery\}/, "the build dialog receives its track pile opener as a prop");
assert.equal(((app.match(/onViewBucket=\{bucketGallery\.openBucketGallery\}/g) ?? []).length + (buildDialogKanban.match(/onViewBucket=\{bucketGallery\.openBucketGallery\}/g) ?? []).length + (researchDialogKanban.match(/onViewBucket=\{bucketGallery\.openBucketGallery\}/g) ?? []).length + (exploreDialogKanban.match(/onViewBucket=\{bucketGallery\.openBucketGallery\}/g) ?? []).length), 3, "each creation checkbox links to its pile's gallery");
assert.doesNotMatch(app, /HillClusterDialog/, "the bespoke cluster overlay is gone");
// Tiles are the board's own tiles at the board's own size. The track bound
// is derived from KANBAN_COLUMN_WIDTHS.expanded, never a stretched `1fr`,
// so a wide modal cannot inflate a narrow card; the class text stays
// literal because Tailwind only emits classes it can read in source, so
// this assertion is the join between the constant and the markup.
const [minBound, maxBound] = KANBAN_COLUMN_WIDTHS.expanded.replace(/^minmax\(|\)$/g, "").split(", ").map((value) => value.trim());
const tilesAt = app.indexOf("data-gallery-tiles");
assert.ok(tilesAt >= 0, "the gallery grid is addressable");
const galleryGrid = app.slice(tilesAt, app.indexOf(">", tilesAt));
assert.ok(galleryGrid.includes(`repeat(auto-fill,minmax(min(${minBound},100%),${maxBound}))`), "gallery tracks take the board column's own bounds");
assert.ok(galleryGrid.includes("justify-start"), "tiles begin at the left edge and fill rightwards");
assert.ok(galleryGrid.includes("items-start"), "a tile keeps the board's natural height");
assert.doesNotMatch(galleryGrid, /\b1fr\b/, "no gallery track stretches to fill the modal");
assert.doesNotMatch(app, /auto-rows-fr/, "gallery rows are never stretched to equal heights");
assert.doesNotMatch(app, /\[&>\.stelow-board-card\]:h-full/, "gallery tiles are never stretched vertically");
assert.doesNotMatch(app, /grid-flow-col/, "gallery flow is row-major: rightwards, then down");
assert.match(app, /sm:w-\[70vw\]/, "the gallery takes seventy percent of the viewport width");
assert.match(app, /className="h-\[85dvh\] overflow-y-auto sm:w-\[70vw\]/, "the gallery height is fixed at 85dvh with internal scroll, never content-sized");
assert.match(app, /\{cards\.length === 0 \? \(/, "an empty pile reads one line, never a dead modal");
assert.match(app, /function BoardCard\(\{ card, onOpen \}/, "tiles accept an open hook without changing default navigation");
assert.ok(app.includes("onOpen?.()"), "the hook is optional — every existing tile behaves exactly as before");
assert.match(app, /const stageOptions = useMemo\(\(\) => \[\.\.\.STAGE_SEQUENCE\], \[\]\)/, "stage filter lists the canonical sequence, never just stages with cards");
assert.match(boardFilters, /export function FilterMultiSelect/, "facets share one checkbox list, never per-field selects");
assert.match(app, /toggleFilterValue\(prev, value\)/, "pills and checkboxes toggle through one helper");
assert.doesNotMatch(app, /function FilterSelect\(/, "the single-select is gone");
assert.deepEqual(toggleFilterValue([], "a"), ["a"], "empty toggles on");
assert.deepEqual(toggleFilterValue(["a", "b"], "a"), ["b"], "present toggles off, order kept");
assert.deepEqual(toggleFilterValue(null, "a"), ["a"], "junk toggles on");
assert.equal(matchesFilterValue([], "a"), true, "empty matches everything");
assert.equal(matchesFilterValue(["a"], "a"), true, "membership matches");
assert.equal(matchesFilterValue(["a"], "b"), false, "absence filters");
assert.equal(matchesFilterValue(null, "a"), true, "junk matches everything");

console.log("kanban layout test ok: bounded open and collapsed columns");

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { KANBAN_COLUMN_WIDTHS, kanbanGridColumns } from "../lib/kanban-layout.mjs";

assert.deepEqual(KANBAN_COLUMN_WIDTHS, {
  expanded: "minmax(240px, 320px)",
  collapsed: "56px",
}, "all boards use bounded column widths");

const columns = kanbanGridColumns(["inbox", "doing", "archived"], { archived: true });
assert.equal(columns, "minmax(240px, 320px) minmax(240px, 320px) 56px", "open and collapsed columns retain their own bounds");
assert.doesNotMatch(columns, /\bfr\b/, "extra canvas space must not stretch Kanban columns");

// Bucket gallery: one button per track opens its captured pile as an
// expanded modal — same tiles as the board in a uniform grid (equal
// widths, equal row heights, vertical scroll). Hill piles reuse the same
// dialog through params, so a second modal fails here.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(root, "app.tsx"), "utf8");
assert.equal((app.match(/<BucketGalleryButton cards=\{grouped\.inbox \?\? \[\]\} \/>/g) ?? []).length, 3, "build, research, and explore each offer the Bucket gallery");
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
assert.equal((app.match(/const bucketGallery = useBucketGallery\(grouped\.inbox \?\? \[\]\);/g) ?? []).length, 3, "each creation dialog shares one opener for its track's pile");
assert.equal((app.match(/onViewBucket=\{bucketGallery\.openBucketGallery\}/g) ?? []).length, 3, "each creation checkbox links to its pile's gallery");
assert.doesNotMatch(app, /HillClusterDialog/, "the bespoke cluster overlay is gone");
assert.match(app, /auto-rows-fr grid-cols-1 gap-3 sm:\[grid-template-columns:repeat\(auto-fill,minmax\(240px,1fr\)\)\]/, "gallery tiles fill board-width columns, as many per row as fit, wrapping the rest");
assert.match(app, /sm:w-\[70vw\]/, "the gallery takes seventy percent of the viewport width");
assert.match(app, /className="h-\[85dvh\] overflow-y-auto sm:w-\[70vw\]/, "the gallery height is fixed at 85dvh with internal scroll, never content-sized");
assert.match(app, /\[&>\.stelow-board-card\]:h-full/, "gallery tiles stretch to equal row heights");
assert.match(app, /\{cards\.length === 0 \? \(/, "an empty pile reads one line, never a dead modal");
assert.match(app, /function BoardCard\(\{ card, onOpen \}/, "tiles accept an open hook without changing default navigation");
assert.ok(app.includes("onOpen?.()"), "the hook is optional — every existing tile behaves exactly as before");

console.log("kanban layout test ok: bounded open and collapsed columns");

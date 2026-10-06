import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOf } from "./helpers/source-code.mjs";
import {
  KANBAN_COLUMN_WIDTHS,
  kanbanGridColumns,
  kanbanMobileGridColumns,
} from "../lib/kanban-layout.mjs";

/**
 * The phone board is a second layout, not a narrower first one.
 *
 * The 2026 consensus names the horizontally-scrolling desktop grid on a phone as the
 * failure mode rather than the fallback — "columns overlap or require awkward horizontal
 * scrolling" (kanbn#414), and "horizontal scroll feels clumsy... users don't realize they
 * can swipe to see other columns" (Composio#1391). What shipped instead across Operon,
 * NexPlan and the kanban CSS-grid references is snap-scroll with viewport-sized columns
 * and the next column's edge peeking in as the "more here" affordance, so a thumb moves
 * one column at a time and the reader can see that another exists.
 *
 * This file pins that decision in both halves: the tracks, and the container that makes
 * them behave like pages rather than like a canvas.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- The tracks -------------------------------------------------------------
assert.equal(
  KANBAN_COLUMN_WIDTHS.mobileExpanded,
  "min(85vw, 320px)",
  "the phone track is viewport-relative, so it adapts to the device instead of a fixed 240px",
);

const columns = kanbanGridColumns(["inbox", "doing", "archived"], { archived: true });
const mobile = kanbanMobileGridColumns(["inbox", "doing", "archived"], { archived: true });

assert.equal(
  mobile,
  "min(85vw, 320px) min(85vw, 320px) 56px",
  "on a phone an open column is nearly full width and the next one peeks in",
);
assert.ok(
  !/minmax\(/.test(mobile.replace("56px", "")),
  "and it does not use the desktop bounded tracks, which are what overflow a 375px screen",
);
// Collapsing is how a reader hides a column they are not using, and that intent does not
// change on a smaller screen — so a collapsed column stays collapsed at its narrow track.
assert.ok(mobile.endsWith("56px"), "a collapsed column keeps its narrow track on mobile too");
assert.notEqual(
  mobile,
  columns,
  "the two layouts are genuinely different, not one aliased to the other",
);

// --- The container ----------------------------------------------------------
// Pinned as topology, and read from the CODE rather than the source: the first version of
// these assertions matched the explanatory comment above the className and stayed green
// when the class itself was removed.
const board = codeOf(readFileSync(join(root, "components", "panels", "build-panel-view.tsx"), "utf8"));
const column = codeOf(readFileSync(join(root, "components", "board", "board-column.tsx"), "utf8"));

assert.match(board, /snap-x snap-mandatory/, "the board is a snap container on a phone, so a swipe lands on a column");
assert.match(board, /md:grid md:snap-none/, "and it hands the layout back to the grid at md, so desktop keeps the bounded tracks");
assert.match(
  board,
  /overscroll-x-contain/,
  "a horizontal flick stays in the board instead of becoming a browser back-navigation",
);
assert.match(
  board,
  /kanbanGridColumns\(\s*BUILD_BOARD_VISIBLE_COLUMNS/,
  "the desktop grid template still matches its rendered columns",
);

// Each column takes its own width and is its own snap point. Without the width the flex
// rail shrinks every column to nothing; without `snap-start` a swipe lands mid-gutter,
// which is the "imprecise" complaint the shipped pattern was answering.
assert.match(column, /w-\[min\(85vw,320px\)\]/, "an open column carries the phone track width");
assert.match(column, /shrink-0 snap-start/, "and it is a snap point that does not shrink in the rail");
assert.match(column, /md:w-auto/, "while desktop hands its width back to the grid template");

console.log("kanban mobile layout ok: snap rail with viewport-sized columns and a peeking neighbour");

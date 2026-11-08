/**
 * The selection control's geometry, derived from the classes that produce it.
 *
 * A number copied into prose drifts the moment a class changes — that is not a
 * risk here, it is the recorded history: "176–256px" and "216px" and "18.5%"
 * lived in six files, none of which reproduced from the code, and one of them
 * (the "34px sets the first line" claim) was false on cards without status
 * pills. So the arithmetic lives here, reading the same source files the browser
 * compiles, and `tests/selection-metrics.test.mjs` asserts the results. If a
 * padding or a line height changes, this module reports the new number and the
 * test fails until the prose is updated with it.
 *
 * It lives in `scripts/`, not `lib/`, on purpose: `lib-stays-host-neutral`
 * (depcruise) forbids `lib/` from reaching into `components/`, and this module
 * reads component source. `scripts/source-pin-classify.mjs` — a small pure module
 * that reads the repo, unit-tested from `tests/` — is the precedent.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { KANBAN_COLUMN_WIDTHS } from "../lib/kanban-layout.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(root, relative), "utf8");

/** Tailwind's spacing scale: `p-3` is 3 × 0.25rem = 12px at the default root. */
const SPACING_UNIT_PX = 4;
/** `border` with no width class is 1px, and it is paid on both sides. */
const BORDER_PX = 1;

const COLUMN_SOURCE = "components/board/board-column.tsx";
const CARD_SOURCE = "components/board/board-cards.tsx";
const SELECT_ROW_SOURCE = "components/board/card-select-row.tsx";

function spacingPx(source, pattern, what) {
  const match = source.match(pattern);
  if (!match) {
    throw new Error(
      `selection-metrics: ${what} is no longer spelled ${pattern} — update this module `
      + "and every prose site it feeds instead of guessing a number",
    );
  }
  return Number(match[1]) * SPACING_UNIT_PX;
}

/** The column's own inset: `p-2` each side plus a 1px border each side. */
export function columnChromePx() {
  const column = read(COLUMN_SOURCE);
  const padding = spacingPx(column, /\bborder bg-muted\/30 p-(\d+(?:\.\d+)?)\b/, "the column's padding");
  if (!/\brounded-lg border bg-muted\/30\b/.test(column)) {
    throw new Error(`selection-metrics: the column's border moved out of ${COLUMN_SOURCE}`);
  }
  return 2 * (padding + BORDER_PX);
}

/** The tile's own inset: `p-3` each side plus a 1px border each side. */
export function tileChromePx() {
  const cards = read(CARD_SOURCE);
  const padding = spacingPx(cards, /\bborder bg-card p-(\d+(?:\.\d+)?)\b/, "the tile's padding");
  return 2 * (padding + BORDER_PX);
}

function trackBounds(track, viewportPx) {
  const declared = KANBAN_COLUMN_WIDTHS[track];
  if (!declared) throw new Error(`selection-metrics: unknown track "${track}"`);
  const minmax = declared.match(/minmax\((\d+)px,\s*(\d+)px\)/);
  if (minmax) return { min: Number(minmax[1]), max: Number(minmax[2]) };
  const viewport = declared.match(/min\((\d+(?:\.\d+)?)vw,\s*(\d+)px\)/);
  if (viewport && viewportPx) {
    return { min: (Number(viewport[1]) / 100) * viewportPx, max: Number(viewport[2]) };
  }
  throw new Error(
    `selection-metrics: track "${track}" does not parse — pass a viewport for a viewport-derived track`,
  );
}

/**
 * What is actually left for a tile's content in a track.
 *
 * `expanded` is the desktop grid. `mobileExpanded` is the phone rail, whose lower
 * bound is viewport-derived, so it needs `viewportPx` — the two tracks are
 * different questions and answering one with the other's numbers is how a range
 * ends up describing a surface it was never measured on.
 */
export function contentBoxPx(track = "expanded", { viewportPx } = {}) {
  const bounds = trackBounds(track, viewportPx);
  const chrome = columnChromePx() + tileChromePx();
  return { min: bounds.min - chrome, max: bounds.max - chrome };
}

/** The select line's own height: `h-5` plus `mb-1.5`. */
export function selectionLinePx() {
  const row = read(SELECT_ROW_SOURCE);
  const height = spacingPx(row, /\bh-(\d+(?:\.\d+)?)\b/, "the select line's height");
  const gap = spacingPx(row, /\bmb-(\d+(?:\.\d+)?)\b/, "the select line's margin");
  return height + gap;
}

/** The title line's height, from the heading's own `leading-5`. */
export function titleLinePx() {
  return spacingPx(read(CARD_SOURCE), /\bleading-(\d+(?:\.\d+)?)\b/, "the title's line height");
}

/**
 * The context row under the heading: `CardContextRow`, which every Build tile
 * renders unconditionally (`mt-2` plus its own 11px line).
 *
 * It is in the floor because leaving it out made the module assert a 12px growth
 * case that cannot occur: the column is never shorter than the title line plus
 * this row, so the retired 34px box never set it. Verification caught that one
 * layer down from the defect this card exists to fix, which is why the floor is
 * built from every unconditional row rather than from the one that was easiest to
 * see.
 */
export function contextRowPx() {
  const cards = read(CARD_SOURCE);
  const margin = spacingPx(cards, /\bmt-(\d+(?:\.\d+)?) flex min-w-0 items-center gap-1 text-\[11px\] /, "the context row's margin");
  return margin + META_LINE_PX;
}

/** The status row's stack when a card has pills: the header's `space-y-1.5` and the row. */
export function statusStackPx() {
  const gap = spacingPx(read(CARD_SOURCE), /\bspace-y-(\d+(?:\.\d+)?)\b/, "the heading's stack gap");
  return gap + PILL_ROW_PX;
}

/**
 * The control this replaced, as history rather than as code.
 *
 * It was `size-8` (32px) plus `mt-0.5` (2px). It no longer exists, so it cannot
 * be read from source — and that is exactly why the number lives here, once,
 * instead of in six prose sites that have to stay in agreement with a deleted
 * component.
 */
export const RETIRED_SELECT_BOX_PX = 34;
const PILL_ROW_PX = 24;
/** An 11px text line at the browser's default `leading-normal`. */
const META_LINE_PX = 17;

/**
 * The narrowest column a real Build tile can have.
 *
 * Every tile renders the title line and the context row; a tile with status pills
 * adds its stack on top. The narrowest case is what matters here, because it is
 * the one where the retired box could still have been setting the height.
 */
export function contentColumnFloorPx({ hasStatusRow = false } = {}) {
  return titleLinePx() + (hasStatusRow ? statusStackPx() : 0) + contextRowPx();
}

/**
 * How much taller a tile gets when the mode is on: the whole line, 26px.
 *
 * The retired 34px box could only have set the heading's first line on a column
 * shorter than itself, and there is no such column — the title line plus the
 * context row already exceed it, with or without status pills. So the box
 * contributed nothing to the height and the line contributes all of itself.
 *
 * An earlier version of this function offered a 12px case for "cards without
 * status pills". It was arithmetic on a floor that forgot the context row, and a
 * test asserted it green: a self-consistent pin cannot see a missing node. The
 * guard against repeating that is `floorExceedsRetiredBox()`, which fails if a
 * future tile gets short enough for the old box to matter again.
 */
export function selectionGrowthPx() {
  const retiredContribution = Math.max(0, RETIRED_SELECT_BOX_PX - contentColumnFloorPx());
  return selectionLinePx() - retiredContribution;
}

/** Is every real tile's column taller than the control it replaced? */
export function floorExceedsRetiredBox() {
  return contentColumnFloorPx() > RETIRED_SELECT_BOX_PX;
}

/**
 * A column grows by every card's growth, plus the fixed `space-y-2` gaps that do
 * not change: `n × growth`.
 */
export function columnGrowthPx(cardCount, options = {}) {
  return cardCount * selectionGrowthPx(options);
}

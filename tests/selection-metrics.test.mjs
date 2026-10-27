import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOf } from "./helpers/source-code.mjs";
import {
  columnGrowthPx,
  contentBoxPx,
  contentColumnFloorPx,
  floorExceedsRetiredBox,
  selectionGrowthPx,
  selectionLinePx,
} from "../scripts/selection-metrics.mjs";

/**
 * The selection control's measurements, asserted where they are derived.
 *
 * These used to be prose. The same range was copied into six files, two of them
 * carried numbers that never reproduced from the classes, and one claim ("its own
 * 32px of top-aligned height set the first line") was true only on cards without
 * status pills. The arithmetic now lives in `scripts/selection-metrics.mjs`,
 * which parses the very classes the browser compiles; this file asserts what it
 * returns, so a padding or line-height change fails here with the new number
 * instead of leaving a stale one in the docs.
 *
 * Split from `selection-mode.test.mjs`, which owns the mode's wiring and reached
 * its own line budget doing both jobs.
 */

const root = join(fileURLToPath(import.meta.url), "..", "..");
const read = (relative) => readFileSync(join(root, relative), "utf8");
const code = (relative) => codeOf(read(relative));

const layout = read("lib/kanban-layout.mjs");
const features = read("FEATURES.md");
const boardCards = code("components/board/board-cards.tsx");
const selectRow = code("components/board/card-select-row.tsx");
const mark = code("components/board/selection-mark.ts");
const trackLists = code("components/board/track-lists.tsx");
const toggle = code("components/board/select-mode-toggle.tsx");

test("the tile's content box and the retired control's cost derive from the classes", () => {
  // The arithmetic lives in `scripts/selection-metrics.mjs` because prose copies
  // of it drifted into six files, two of them with numbers that never reproduced.
  // Asserting the module's OUTPUT is the point: change a padding and these fail
  // with the new number instead of silently leaving a stale range in the docs.
  assert.ok(layout.includes('expanded: "minmax(240px, 320px)"'), "the track is still the bounded one");
  assert.ok(boardCards.includes("bg-card p-3"), "and the tile's own gutter is unchanged");

  const box = contentBoxPx();
  assert.deepEqual(box, { min: 196, max: 276 }, "the content box, after column padding, both borders and tile padding");

  // 40px of content width (a 32px box plus an 8px gap) as a share of each end.
  const retiredPx = 40;
  assert.equal(
    Math.round((retiredPx / box.min) * 1000) / 10,
    20.4,
    "the retired control claimed a fifth of a narrow tile's content width — in the 240px track that is what "
    + "'tirando espaco de coisas importantes' was about",
  );
  assert.equal(Math.round((retiredPx / box.max) * 1000) / 10, 14.5, "and a seventh of a wide one");
});

test("the mode's new height is the line, because the retired box never set one", () => {
  // This test used to assert TWO growth numbers — 26px with status pills and 12px
  // without — and the second could not happen. The column's floor forgot the
  // context row every tile renders, so the retired box was never tall enough to
  // set the heading, and a self-consistent pin (module output against a literal)
  // cannot see a node that is missing from both. Verification found it; this
  // asserts the single case that exists AND the precondition that makes it single,
  // so a future shorter tile turns this red instead of quietly re-opening the
  // question.
  assert.equal(selectionLinePx(), 26, "the line is `h-5` (20) plus `mb-1.5` (6)");
  assert.ok(
    contentColumnFloorPx() > 34,
    `every tile's column must be taller than the 32px box that was removed (floor: ${contentColumnFloorPx()}px) — `
    + "if it is not, the removed box was setting the heading's height and the line's growth is smaller than claimed",
  );
  assert.equal(floorExceedsRetiredBox(), true, "which is the module's own statement of that precondition");
  assert.equal(selectionGrowthPx(), 26, "so the whole line is new height, on every card");
  assert.equal(columnGrowthPx(4), 104, "and a column grows by every card's growth");
  assert.ok(
    columnGrowthPx(4) > 96,
    "which is more than the 96px the mode already reserves for its own bar — the cost this card accepts knowingly",
  );
});

test("the mark does not fight the tile for its own clicks", () => {
  // The old control needed two `stopPropagation` calls because it sat inside a
  // tile that was itself a toggle, so an unstoppered click toggled twice and
  // landed where it started. The mark has no handler at all: a click bubbles to
  // the tile's single handler and toggles exactly once. Asserting the absence of
  // a handler is what keeps the double-toggle regression from coming back
  // through a "let people click the box too" change.
  assert.ok(
    !selectRow.includes("stopPropagation"),
    "nothing in the mark's module stops propagation, because there is no second toggle to cancel",
  );
  assert.ok(
    !selectRow.includes("onClick"),
    "and the mark carries no click handler of its own",
  );
  assert.ok(
    selectRow.includes("aria-hidden"),
    "it is decorative, so assistive tech hears the tile's one control and its aria-pressed state",
  );
  assert.ok(
    !selectRow.includes("type=\"checkbox\""),
    "and it is not an input: nested interactive content is what doubled the tab stops",
  );
  assert.ok(
    !selectRow.includes("size-8"),
    "nor does it re-grow the 32px box the tile paid 40px of content width for",
  );
});


test("the list and the tile render the same mark, not two that resemble each other", () => {
  // A board and a list that disagree about what "selected" looks like is the
  // drift a shared token exists to prevent. The mark's classes live in one
  // module; each surface adds only its own alignment.
  assert.ok(
    mark.includes("export const SELECTION_MARK_CLASS"),
    "the geometry is named once, in a module of its own — not in the tile's line, so the list does not depend "
    + "on a component it never renders",
  );
  assert.ok(
    mark.includes("export function selectionMarkClass(selected: boolean)"),
    "and so is the state-to-palette mapping",
  );
  assert.ok(
    trackLists.includes('import { selectionMarkClass } from "./selection-mark"'),
    "the list imports it rather than re-spelling the six classes it used to carry",
  );
  assert.ok(
    selectRow.includes('import { selectionMarkClass } from "./selection-mark"'),
    "and the tile's line imports the same one, so the two surfaces cannot drift apart",
  );
  assert.ok(
    trackLists.includes("selectionMarkClass(selected)"),
    "and uses it for the mark it renders",
  );
  assert.ok(
    !trackLists.includes("size-4 shrink-0 rounded border transition"),
    "with no local copy left behind, which is how the two surfaces stay one shape",
  );
});

test("no prose site restates a measurement the module owns", () => {
  // The number drifted into six files, two of them with values that never
  // reproduced. The rule is now: cite the module or state no number.
  const stale = /176–256|15–18%|216px|40\/216|18\.5%|34px/;
  const sites = {
    "FEATURES.md": features,
    "hooks/use-selection-mode.ts": read("hooks/use-selection-mode.ts"),
    "components/board/select-mode-toggle.tsx": toggle,
    "components/board/card-select-row.tsx": selectRow,
    "tests/selection-mode-hook.test.mjs": read("tests/selection-mode-hook.test.mjs"),
  };
  for (const [file, source] of Object.entries(sites)) {
    assert.ok(
      !stale.test(source),
      `${file} restates a retired measurement — the numbers live in scripts/selection-metrics.mjs and the `
      + "prose cites it, because a copied range is what drifted in the first place",
    );
  }
  assert.ok(
    features.includes("scripts/selection-metrics.mjs")
    && read("hooks/use-selection-mode.ts").includes("scripts/selection-metrics.mjs"),
    "and the two places a reader actually looks cite the module by path",
  );
});

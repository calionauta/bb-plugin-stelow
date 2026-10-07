import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOf } from "./helpers/source-code.mjs";
import {
  BULK_BAR_SHELL_CLASS,
  BULK_BAR_SURFACE_CLASS,
  boardBottomPadding,
} from "../lib/bulk-bar-placement.mjs";

/**
 * The bulk bar floats, so selecting a card does not move the board.
 *
 * Reported: "no board, o botao de checkbox cria uma experiência pessima qdo é clicado: abre um
 * componente acima do board e faz o board descer. acho que a barra com os comandos da multi
 * selecao deveriam ser uma barra flutuante no centro do bottom".
 *
 * The bar rendered as a block in the board's own column, so a selection inserted a row into
 * the layout. A selection is not a layout change — the cards do not move, only the actions
 * appear — and the fix is to take the bar out of the flow entirely.
 *
 * The pins below hold the three things that make a floating bar correct rather than merely
 * detached: it is fixed to the viewport (not to a scrolling board), it clears the phone's
 * home indicator, and it does not cover the last row of cards.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bar = codeOf(readFileSync(join(root, "components/board/build-bulk-bar.tsx"), "utf8"));
const panelView = codeOf(readFileSync(join(root, "components/panels/build-panel-view.tsx"), "utf8"));

// --- 1. It is out of the board's flow. --------------------------------------
// The regression is a wrapper with margin in the same column as the board, which is what
// pushed it down. `mb-3` was that wrapper's class.
assert.doesNotMatch(
  bar,
  /className="mb-3"/,
  "the bar is not a block above the board: that wrapper was what pushed the board down",
);
assert.match(bar, /BULK_BAR_SHELL_CLASS/, "and it renders inside the floating shell");

// --- 2. Floating means fixed to the viewport, centred, and click-through. ---
assert.match(BULK_BAR_SHELL_CLASS, /\bfixed\b/, "the shell is fixed, not absolute or static");
assert.match(
  BULK_BAR_SHELL_CLASS,
  /inset-x-0/,
  "it spans the viewport horizontally, so `justify-center` centres it against the screen rather than against a scrolling board",
);
assert.match(BULK_BAR_SHELL_CLASS, /bottom-\[max\(/, "it sits at the bottom with a floor for the phone's safe area");
assert.match(
  BULK_BAR_SHELL_CLASS,
  /env\(safe-area-inset-bottom\)/,
  "and that floor is the safe-area inset, so the home indicator does not sit on the buttons",
);
assert.match(
  BULK_BAR_SHELL_CLASS,
  /pointer-events-none/,
  "the full-width shell is transparent to clicks: the strip beside the bar must not swallow taps on the board behind it",
);
assert.match(
  BULK_BAR_SURFACE_CLASS,
  /pointer-events-auto/,
  "while the bar itself takes them back, so its buttons work",
);
assert.match(BULK_BAR_SURFACE_CLASS, /z-|shadow-/, "and it reads as floating rather than as part of the board");

// --- 3. Mobile: the bar wraps instead of overflowing. ----------------------
// Four buttons carrying live counts do not fit beside each other at 375px, and a bar that
// overflows the viewport is worse than one that takes two rows.
assert.match(BULK_BAR_SURFACE_CLASS, /max-sm:w-full/, "on a phone the bar takes the full width");
assert.match(BULK_BAR_SURFACE_CLASS, /flex-wrap/, "and wraps its buttons rather than overflowing");
assert.match(BULK_BAR_SURFACE_CLASS, /max-sm:rounded-2xl/, "with a squarer corner, because a full-width pill reads as a button");

// --- 4. The board reserves the strip, and only while the bar exists. -------
// A floating bar covers whatever is under it. Reserving the space keeps the last row of
// cards reachable; reserving it always would leave a permanent gap on an unselected board.
assert.equal(boardBottomPadding(false), "pb-1", "an unselected board keeps its full height");
assert.equal(boardBottomPadding(true), "pb-24", "a selected board reserves the strip the bar floats over");
assert.notEqual(boardBottomPadding(true), boardBottomPadding(false), "the two states differ, so the reservation is real");
assert.match(
  panelView,
  /boardBottomPadding\(state\.selectedIds\.size > 0\)/,
  "the board asks for that padding from the selection, not from a constant",
);
assert.match(
  panelView,
  /<BulkBarSlot state=\{state\} \/>/,
  "and the slot still renders once, in the board view",
);

// --- 5. The bar is not a sibling the board is laid out against. ------------
// The board's own column must contain the board and nothing else: a sibling element above it
// is the shape of the original defect, however it is styled.
const boardIndex = panelView.indexOf("data-testid=\"kanban-board\"");
const slotIndex = panelView.indexOf("<BulkBarSlot");
assert.ok(slotIndex >= 0 && boardIndex > slotIndex, "the slot renders before the board in source order");
assert.doesNotMatch(
  panelView.slice(slotIndex, boardIndex),
  /className="mb-\d/,
  "and nothing between them carries a bottom margin, which would push the board down again",
);

console.log("bulk bar placement ok: floating, centred, safe-area aware, and out of the board's flow");

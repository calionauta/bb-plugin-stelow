import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOf } from "./helpers/source-code.mjs";

/**
 * A control in a column header must not change that column's height.
 *
 * Reported from the live board: "the delete all da coluna archive ta deixando os cards
 * desalinhados horizontalmente com os cards das outras colunas". Two causes, both real,
 * both invisible in a screenshot of the Archived column alone:
 *
 *   1. The delete control rendered its own `div.mb-1.flex.justify-end` BETWEEN the header
 *      and the cards, so it took a line in the flow and pushed the card stack down.
 *   2. It also could not have lived inside the header as it was, because the header WAS
 *      one `<button>` spanning the row, and a button cannot contain a button.
 *
 * Fixed by making the header a row of siblings — the collapse toggle, the count, and the
 * destructive control each with its own hit target — so the control takes the trailing
 * slot instead of a line. The remaining drift was 4px: the delete button carries the
 * repository's `min-h-11` touch-target floor and the toggle carried `min-h-10`, so a
 * header with the control stood taller than one without.
 *
 * These pins read the CODE with the repo's comment-stripping helper, not the source, so an
 * explanatory comment cannot satisfy them — which is exactly how the first version of the
 * mobile pins failed.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const column = codeOf(readFileSync(join(root, "components/board/board-column.tsx"), "utf8"));
const deleteControl = codeOf(readFileSync(join(root, "components/board/archived-column-delete.tsx"), "utf8"));

// --- 1. The control adds no line to the column's flow. ----------------------
assert.doesNotMatch(
  deleteControl,
  /className="mb-1 flex justify-end"/,
  "the delete control owns no block of its own — as a block between the header and the cards it pushed this column's stack down",
);
assert.doesNotMatch(
  deleteControl,
  /^\s*<div/m,
  "and it renders no wrapper at all: its parent is the header row, so a wrapper is either redundant or a second line in the flow",
);

// --- 2. The header is a row, not one button. --------------------------------
// A button cannot nest a button, so a header that IS a button can never hold this control
// in its trailing slot — the layout constraint that produced the block in the first place.
assert.match(
  column,
  /<div className=\{`mb-2 flex items-center gap-1/,
  "the header is a flex row, so the toggle and any column-level control are siblings",
);
assert.match(
  column,
  /<button\s+onClick=\{onToggle\}/,
  "and the collapse toggle is a button inside that row",
);
assert.match(
  column,
  /\{deleteAll && !collapsed \? <ArchivedColumnDelete/,
  "the control renders in the row's trailing slot, not below it",
);

// --- 3. Every column's header row is the same height. -----------------------
// The measured 4px: 44px where the control exists and 40px where it does not. Pinned as a
// property of the ROW rather than of each control, because a control added later with a
// taller floor would reintroduce the drift without touching this one.
assert.match(
  column,
  /flex min-h-11 flex-1 cursor-pointer items-center justify-between/,
  "the header row carries the touch-target floor itself, so a control inside it cannot make the row taller",
);
assert.match(
  deleteControl,
  /min-h-11/,
  "and the control meets the same floor, so neither is the taller one",
);

// --- 4. The whole point: the cards start at the same y in every column. -----
// The delete control must not appear anywhere between the header and the card list, which
// is the shape of the original defect and the thing a future edit would most plausibly
// reintroduce.
// The property is stated over the WHOLE span, from the column's opening `<section>` to the
// card list, and that is what makes it catch the defect at either end.
//
// Two earlier versions measured too narrowly and stayed green on a mutation that
// re-instated the reported block: one started at the header ELEMENT, so a block inserted
// BEFORE it sat outside the measured range; the other used `indexOf("<ColumnHeader")`,
// which finds the function's own definition and made an empty slice. Both were vacuous for
// a different reason and each passed the very defect the file exists for.
//
// What is true, and what a screenshot cannot tell you: the only component the column
// renders between its box and its cards is the header. Anything else is a line in the flow
// and pushes this column's stack out of line with every other column.
const sectionAt = column.lastIndexOf("<section");
const cardsAt = column.lastIndexOf("<ColumnCards");
assert.ok(
  sectionAt > 0 && cardsAt > sectionAt,
  "the column renders a <section> and then cards, so the measured span is real",
);
const beforeCards = column.slice(sectionAt, cardsAt);
const componentsBeforeCards = [...new Set([...beforeCards.matchAll(/<([A-Z][A-Za-z]*)/g)].map((m) => m[1]))];
assert.deepEqual(
  componentsBeforeCards,
  ["ColumnHeader"],
  "the only component between the column's box and its cards is the header — any other sits "
    + `in the flow and misaligns this column's cards. Found: ${componentsBeforeCards.join(", ")}`,
);

console.log("column header alignment ok: one row height, no control in the flow between header and cards");

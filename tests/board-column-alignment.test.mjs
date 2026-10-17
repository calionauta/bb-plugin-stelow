import assert from "node:assert/strict";
import {
  classesOf,
  loadComponent,
  renderTree,
  walk,
} from "./helpers/render-component.mjs";

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
 * The guard asks the rendered TREE, not the source text: a regex can be satisfied by a
 * comment or by an edit that changes what the component does. The tree is what a reader
 * gets, and a wrapper block between the header and the cards is a node in the tree.
 */

const disclosure = {
  DisclosureChevron: (props) => ({ type: "DisclosureChevron", props: props ?? {}, children: [] }),
};

// The board column is loaded without the delete control's real internals: the alignment
// property is a property of the column's flow, so a single opaque node proves the control
// occupies its slot rather than taking a line of its own.
const ArchivedColumnDeleteStub = (props) => ({ type: "ArchivedColumnDelete", props: props ?? {}, children: [] });

const BoardColumn = loadComponent("components/board/board-column.tsx", "BoardColumn", {
  "@/components/disclosure": disclosure,
  "./archived-column-delete": { ArchivedColumnDelete: ArchivedColumnDeleteStub },
});

const cards = [{ id: "c1" }, { id: "c2" }];
const renderCard = (card) => ({ type: "span", props: {}, children: [card.id] });

function boardColumn(overrides = {}) {
  return renderTree(BoardColumn({
    column: "archived",
    cards,
    collapsed: false,
    onToggleCollapsed: () => {},
    labels: { archived: "Archived" },
    renderCard,
    deleteAll: { filterLabel: "Archived", cardIds: cards.map((card) => card.id), onConfirm: async () => {} },
    ...overrides,
  }));
}

const rendered = boardColumn();
assert.equal(rendered.type, "section", "the column renders its box");

// --- 1. The control adds no line to the column's flow. ----------------------
// The section's children are the header row and the card list and NOTHING in
// between. The reported defect was a third child — the delete control's own
// block — sitting between them.
const [header, cardList] = rendered.children;
assert.equal(rendered.children.length, 2, "the column's box holds only the header and the cards");
assert.equal(rendered.children.filter((child) => child?.type === "ArchivedColumnDelete").length, 0,
  "the control is never a child of the column's box, where it would be a line in the flow");
assert.equal(header.type, "div", "the first child is the header row");
assert.equal(cardList.type, "div", "the second child is the card list");
assert.deepEqual(cardList.props.role, "list", "the card list is the one the reader scrolls");

// --- 2. The header is a row, not one button. --------------------------------
// A button cannot nest a button, so a header that IS a button can never hold this control
// in its trailing slot — the layout constraint that produced the block in the first place.
const headerClasses = classesOf(header);
for (const name of ["flex", "items-center"]) {
  assert.ok(headerClasses.includes(name), `the header row lays its controls out in a row (${name})`);
}
const toggle = header.children.find((child) => child?.type === "button");
assert.ok(toggle, "the collapse toggle is a button inside that row");
const control = header.children.find((child) => child?.type === "ArchivedColumnDelete");
assert.ok(control, "the control renders in the row's trailing slot, not below it");
for (const name of ["flex-1", "items-center", "justify-between"]) {
  assert.ok(classesOf(toggle).includes(name), `the toggle fills and spaces the row (${name})`);
}

// --- 3. Every column's header row is the same height. -----------------------
// The measured 4px: 44px where the control exists and 40px where it does not. Pinned as a
// property of the TOGGLE that spans the row, because a control added later with a taller
// floor would reintroduce the drift without touching this one.
assert.ok(classesOf(toggle).includes("min-h-11"), "the toggle carries the touch-target floor itself");
const withoutControl = boardColumn({ deleteAll: undefined });
const toggleWithout = withoutControl.children[0].children.find((child) => child?.type === "button");
assert.ok(classesOf(toggleWithout).includes("min-h-11"),
  "and the same row height holds on a column with no control");
assert.equal(withoutControl.children.some((child) => child?.type === "ArchivedColumnDelete"), false,
  "a column with no delete-all renders no control");

// --- 4. The whole point: the cards start at the same y in every column. -----
// The only component the column renders between its box and its cards is the header.
// Anything else is a line in the flow and pushes this column's stack out of line with
// every other column. Stated over the RENDERED tree, so a wrapper block inserted between
// the header and the cards is a node this refuses — the exact shape of the defect.
const componentKinds = [...new Set(rendered.children.flatMap((child) => [child.type]))];
assert.deepEqual(
  componentKinds,
  ["div"],
  "the column's box holds no component between the header and the cards — any other sits "
    + `in the flow and misaligns this column's cards. Found: ${componentKinds.join(", ")}`,
);

// --- 5. The control itself renders no wrapper block. ------------------------
// Loaded with its real internals, minus React's state hook and the host surfaces, so the
// claim is about the markup the component produces. It used to render a
// `div.mb-1.flex.justify-end` between the header and the cards.
const ArchivedColumnDelete = loadComponent(
  "components/board/archived-column-delete.tsx",
  "ArchivedColumnDelete",
  {
    react: { useState: () => [false, () => {}] },
    "@/components/ui/button": { Button: (props) => ({ type: "button", props: props ?? {}, children: props?.children ?? [] }) },
    "@/components/confirm-action-dialog": { ConfirmActionDialog: () => null },
    "@/components/ui/icon": { Icon: (props) => ({ type: "Icon", props: props ?? {}, children: [] }) },
  },
);
const controlTree = renderTree(ArchivedColumnDelete({
  count: 2,
  filterLabel: "Archived",
  cardIds: cards.map((card) => card.id),
  onConfirm: async () => {},
}));
assert.notEqual(controlTree.type, "div", "the control owns no wrapper block of its own");
let controlButton = null;
walk(controlTree, (node) => {
  if (!controlButton && node.type === "button") controlButton = node;
});
assert.ok(controlButton, "and it renders its own hit target");
assert.ok(classesOf(controlButton).includes("min-h-11"), "the control meets the same touch-target floor");
assert.ok(!classesOf(controlButton).includes("mb-1"), "and carries no block spacing that would take a line");

console.log("column header alignment ok: one row height, no control in the flow between header and cards");

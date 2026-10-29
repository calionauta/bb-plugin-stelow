import assert from "node:assert/strict";
import test from "node:test";
import {
  classesOf,
  findElementByClass,
  loadComponent,
  renderTree,
  treeText,
  walk,
} from "./helpers/render-component.mjs";

/**
 * The panel header keeps its explanation readable when the panel is narrow.
 *
 * Reported: "a tela do plugin stelow quando uso em formato mais espremido,
 * seja tablet ou mobile, não consigo usar. o texto de explicação do board fica
 * espremido e longo e tudo quebra."
 *
 * The header was one row from `sm` (640px). At that width the explanation and
 * the action grid share the row, and the explanation is the member that gives
 * up its width — so the sentence that teaches the board wrapped into a tall
 * column of text beside two columns of buttons. The breakpoint said "there is
 * room here" when what it actually marked was the first width where there
 * stopped being room.
 *
 * Asserted on the RENDERED component rather than on its source text: the
 * source-pin ratchet exists because a text pin passes on broken logic and
 * breaks on a refactor. What matters is the tree a reader gets.
 */

const cn = (...values) => values.filter(Boolean).join(" ");
const PanelHeader = loadComponent("components/panels/panel-header.tsx", "PanelHeader", {
  "../../lib/utils": { cn },
});
const BoardScrollHint = loadComponent(
  "components/panels/panel-header.tsx",
  "BoardScrollHint",
  { "../../lib/utils": { cn } },
);

/** A plain button element: the header only arranges its actions, never renders them. */
const control = (label) => ({
  type: "button",
  props: { className: "min-h-11" },
  children: [label],
});

function renderHeader(overrides = {}) {
  return renderTree(
    PanelHeader({
      title: "Build",
      blurb: "An AI agent carries each card through a structured workflow.",
      attentionCount: 3,
      onAttention: () => {},
      actions: [control("New issue"), control("Agent Presets")],
      ...overrides,
    }),
  );
}

function headerNode(tree) {
  let header = null;
  walk(tree, (node) => {
    if (!header && node.type === "header") header = node;
  });
  return header;
}

// --- 1. The header is a column below lg and a two-row grid above it. -----
test("the explanation never shares a row with the actions", () => {
  const header = headerNode(renderHeader());
  assert.ok(header, "the header renders a <header> element");
  const classes = classesOf(header);
  assert.ok(classes.includes("flex-col"), "the header is a column by default");
  assert.ok(
    classes.includes("lg:grid"),
    "at lg it becomes a two-row grid: title and actions on top, explanation beneath",
  );
  assert.ok(
    classes.includes("lg:grid-cols-[minmax(0,1fr)_auto]"),
    "the title owns the flexible track and the actions a capped one",
  );
  assert.ok(
    !classes.includes("lg:flex-row"),
    "no breakpoint puts the explanation back in the same row as the buttons",
  );
});

// --- 2. The explanation keeps a readable measure, in its own row. --------
test("the explanation spans the whole header width under the title row", () => {
  const tree = renderHeader();
  const header = headerNode(tree);
  let paragraph = null;
  walk(tree, (node) => {
    if (!paragraph && node.type === "p") paragraph = node;
  });
  assert.ok(paragraph, "the explanation renders as a paragraph");
  const classes = classesOf(paragraph);
  assert.ok(classes.includes("max-w-prose"), "the paragraph is bounded at a readable measure");
  assert.ok(classes.includes("text-pretty"), "and its last line is balanced rather than orphaned");
  assert.ok(classes.includes("lg:col-span-2"), "it spans both columns");
  assert.ok(classes.includes("lg:row-start-2"), "and sits in the second row, never beside a button");
  assert.ok(header.children.includes(paragraph), "it is a direct child of the header, not nested inside the title column");
});

// --- 3. The actions are a thumb grid and a capped row. -------------------
test("actions are a thumb grid that wraps instead of crushing the title", () => {
  const tree = renderHeader();
  const container = findElementByClass(tree, "grid-cols-2");
  assert.ok(container, "the actions are a two-column grid on a phone");
  const classes = classesOf(container);
  assert.ok(classes.includes("sm:flex"), "and a row from sm up");
  assert.ok(classes.includes("sm:flex-wrap"), "which wraps instead of shrinking a button");
  assert.ok(classes.includes("lg:max-w-[38rem]"), "the action row is capped so the title keeps a measure");
  assert.ok(classes.includes("lg:col-start-2") && classes.includes("lg:row-start-1"),
    "it shares the first row with the title, on the right");
  assert.ok(
    !classes.includes("sm:flex-col"),
    "the actions never stack beside the explanation again",
  );
});

// --- 3b. The track actions are children of the ONE layout. --------------
test("the Build actions are direct children of the shared header layout, not a second grid", () => {
  const marker = (type) => (props) => ({ type, props: props ?? {}, children: props?.children ?? [] });
  const BuildHeaderActions = loadComponent(
    "components/panels/build-header-actions.tsx",
    "BuildHeaderActions",
    {
      "../board/card-gallery": { BucketGalleryButton: marker("bucket") },
      "../ui/button": { Button: marker("button") },
      "../ui/icon": { Icon: marker("icon") },
    },
  );
  const tree = renderTree(BuildHeaderActions({
    groupedInbox: [],
    githubAutomationEnabled: true,
    onNewIssue: () => {},
    onOpenCard: () => {},
    onOpenPresets: () => {},
    onOpenGithub: () => {},
  }));
  const children = tree.children ?? [];
  assert.deepEqual(
    children.map((child) => child.type),
    ["button", "bucket", "button", "button"],
    "the four actions are siblings, direct children of the shared layout",
  );
  assert.equal(findElementByClass(tree, "grid-cols-2"), null,
    "no second grid nests the buttons and defeats the shared wrap");
});

// --- 4. The attention line still works, and only when there is one. ------
test("the attention count renders as one reachable control", () => {
  const withAttention = renderHeader();
  const button = findElementByClass(withAttention, "cursor-pointer");
  assert.ok(button, "the attention line is a button when something needs attention");
  assert.equal(
    button.props["aria-label"],
    "Show the 3 cards that need attention",
    "and its accessible name counts what needs it",
  );

  const without = renderHeader({ attentionCount: 0 });
  assert.equal(
    findElementByClass(without, "cursor-pointer"),
    null,
    "a board with nothing waiting renders no attention line at all",
  );
});

// --- 5. On a phone the order is title, explanation, actions. -------------
test("the title column is the flexible member and the phone order reads title, explanation, actions", () => {
  const tree = renderHeader();
  const titleColumn = findElementByClass(tree, "order-1");
  assert.ok(titleColumn, "the title column comes first on a phone");
  assert.ok(classesOf(titleColumn).includes("min-w-0"),
    "it is the flexible track, so a long title truncates instead of pushing a control");
  const paragraph = findElementByClass(tree, "order-2");
  assert.ok(paragraph, "the explanation comes second on a phone, before the buttons");
  const actions = findElementByClass(tree, "order-3");
  assert.ok(actions, "the action grid comes last, where the thumb already is");
});

// --- 6. The scroll hint follows the input device, not the width. ---------
test("the scroll hint names a gesture a touch reader can make", () => {
  const tree = renderTree(BoardScrollHint({}));
  const text = treeText(tree);
  assert.match(text, /Swipe sideways to view every stage\./, "touch widths get the swipe hint");
  let touchSpan = null;
  let keyboardSpan = null;
  walk(tree, (node) => {
    const classes = classesOf(node);
    if (classes.includes("lg:hidden")) touchSpan = node;
    if (classes.includes("lg:inline")) keyboardSpan = node;
  });
  assert.ok(touchSpan, "the swipe line runs below lg, where touch is the likely input");
  assert.ok(keyboardSpan, "and the keyboard line starts at lg");
  assert.match(
    treeText(keyboardSpan),
    /Shift \+ scroll/,
    "a 768px tablet is no longer told to hold Shift",
  );
});

console.log(
  "panel header responsive ok: the explanation keeps its width below lg, "
  + "the scroll hint follows touch, and the actions never squeeze the title",
);

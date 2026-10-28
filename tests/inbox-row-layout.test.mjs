import assert from "node:assert/strict";
import test from "node:test";
import {
  classesOf,
  loadComponent,
  renderTree,
  treeText,
  walk,
} from "./helpers/render-component.mjs";
import { inboxAction } from "../lib/inbox-panel-state.mjs";
import * as presentation from "../lib/inbox-event-presentation.mjs";
import { splitProseSummary } from "../lib/question-prose.mjs";

/**
 * An Inbox row must not spend its text column on its own buttons.
 *
 * Reported from a phone: "as notificações do inbox ficam quebradas. cada item
 * fica com texto estreito ocupando a tela verticalmente sem dar pra ler direito
 * por conta dos botões ao lado q tentam tomar todo espaço". Measured at a 360 px
 * viewport, that is literal: the row's content box is ≈302 px, the controls
 * claim ≈226 px plus gaps because they are `shrink-0`, and the click target was
 * `flex-1` — `flex-basis: 0` — so the browser was *allowed* to give the text
 * what was left, which was about 20 px. One character per line, and a row ten
 * times taller than it needs.
 *
 * The fix is two properties that must hold together, and this file is written so
 * that removing either one fails:
 *
 *   1. the row wraps (`flex-wrap`) AND the click target asks for a real measure
 *      (`grow basis-[16rem]`, never `flex-1`) — wrapping alone changes nothing,
 *      because a zero basis never asks for a line break;
 *   2. the actions are ONE node after the target, so there is something to move
 *      onto the second line and something a test can point at. `ItemActions`
 *      returns a fragment, which is why the wrapper exists at all.
 *
 * The claim is asked of the rendered TREE, not the source text: a regex is
 * satisfied by a comment, and by an edit that changes what the row does. Precedent
 * for the vehicle is `tests/board-column-alignment.test.mjs`; the source-pin
 * approach used by `card-mobile-layout` / `kanban-mobile-layout` cannot express
 * "these three controls live in one node".
 */

const ItemActions = loadComponent("components/panels/inbox-item-actions.tsx", "ItemActions", {});

const Button = (props) => ({
  type: "button",
  props: { ...props, "data-control": "Button" },
  children: props.children ?? [],
});

const InboxEntry = loadComponent("components/panels/inbox-row.tsx", "InboxEntry", {
  "./inbox-item-actions": { ItemActions },
  "../ui/button": { Button },
  // The real presentation/action modules, not fakes: the row's own copy and
  // state words are contracts (`tests/inbox-panel.test.mjs`), and a stub here
  // would let this file stay green while the row said something else.
  "../../lib/question-prose.mjs": { splitProseSummary },
  "../../lib/inbox-event-presentation.mjs": presentation,
  "../../lib/inbox-panel-state.mjs": { inboxAction },
});

/** A question row: the widest case, three controls plus the ask line. */
function questionEntry(overrides = {}) {
  return {
    id: "n1",
    cardId: "c1",
    cardName: "Fix the inbox row",
    projectName: "bb",
    cardKind: "build",
    kind: "question",
    summary: "asked you something",
    occurredAt: 0,
    readAt: null,
    resolvedAt: null,
    archivedAt: null,
    severity: 0,
    severityReasons: [],
    holderCardId: null,
    holderFile: null,
    questionSummary: "Should the row wrap its actions onto a second line?",
    questionCount: 1,
    questionKind: "standard",
    ...overrides,
  };
}

function row(overrides = {}, handlers = {}) {
  return renderTree(InboxEntry({
    entry: questionEntry(overrides),
    onOpen: () => {},
    onOpenAsk: () => () => {},
    onHolderChip: () => null,
    onMarkRead: () => {},
    onMarkUnread: () => {},
    onSetAside: () => {},
    onBringBack: () => {},
    ...handlers,
  }));
}

/** The click target: the one node that asks for the text measure. */
function target(rowTree) {
  const node = rowTree.children.find(
    (child) => child?.type === "button" && classesOf(child).includes("basis-[16rem]"),
  );
  assert.ok(
    node,
    "no node asks for a text measure (basis-[16rem]). Without a non-zero basis the row never wraps and the "
    + "text column collapses to the leftover width — the reported bug, restored",
  );
  return node;
}

/** The action cluster: the single node the buttons live in, after the target. */
function cluster(rowTree) {
  const nodes = [];
  walk(rowTree, (node) => {
    if (classesOf(node).includes("ml-auto")) nodes.push(node);
  });
  assert.equal(
    nodes.length,
    1,
    "exactly one action cluster expected. Zero means the cluster lost its identity and the buttons are bare "
    + "siblings competing with the text again; more than one means a second competing cluster appeared",
  );
  return nodes[0];
}

test("the row wraps only because the target asks for a measure", () => {
  const tree = row();
  const rowClasses = classesOf(tree);
  assert.ok(rowClasses.includes("flex-wrap"), "the row must be allowed to wrap; without it the cluster can only overlap the text");
  assert.ok(rowClasses.includes("items-start"), "the row keeps its top alignment, so a wrapped cluster does not stretch the row");

  const targetClasses = classesOf(target(tree));
  assert.ok(targetClasses.includes("grow"), "the target must grow into the space it is given");
  assert.ok(targetClasses.includes("min-w-0"), "min-w-0 stays: without it a long unbroken word overflows instead of wrapping");
  assert.ok(
    !targetClasses.includes("flex-1"),
    "flex-1 is `flex-basis: 0`, the permission this fix withholds. A leftover flex-1 would not be deduped (the "
    + "class list is a concatenation, not cn()) and would only lose to basis-[16rem] on stylesheet order",
  );
});

test("the actions are one node, immediately after the target", () => {
  const tree = row();
  const index = tree.children.indexOf(target(tree));
  const actions = cluster(tree);
  assert.equal(
    tree.children[index + 1],
    actions,
    "the action cluster must be the click target's next sibling — that adjacency is what lets it take a second "
    + "line as a block instead of squeezing the text character by character",
  );

  const actionClasses = classesOf(actions);
  for (const required of ["flex", "min-w-0", "flex-wrap", "ml-auto"]) {
    assert.ok(
      actionClasses.includes(required),
      `the cluster must carry ${required}: min-w-0 lets it shrink below its content so the buttons can wrap onto a `
      + "second internal line when the panel is narrower than the cluster, flex-wrap is what puts them there, and "
      + "ml-auto keeps them at the trailing edge so \"Set aside\" is not the bottom-left corner control",
    );
  }
  assert.ok(
    !actionClasses.includes("shrink-0"),
    "shrink-0 would pin the cluster at its content width at every container size, so its flex-wrap would have "
    + "nothing to wrap and the row would overflow by the difference instead — measured: 34 px of overflow at a "
    + "240 px container with shrink-0, none with min-w-0",
  );
  assert.ok(!actionClasses.includes("flex-1"), "the cluster never competes for the text's space");
  assert.ok(!actionClasses.includes("w-full"), "a full-width cluster would push the row taller for no gain at wide widths");
});

test("the ask line is clamped, and the count for a batch is not inside the clamp", () => {
  const tree = row({ questionCount: 3 });
  let clamped = null;
  walk(tree, (node) => {
    if (!clamped && classesOf(node).includes("line-clamp-2")) clamped = node;
  });
  assert.ok(clamped, "the ask line must carry line-clamp-2 — the cap is what keeps a long question from becoming a column");
  assert.ok(
    !classesOf(clamped).includes("block"),
    "`block` beside the clamp compiles to a later `display:block` at equal specificity, which is exactly how the cap "
    + "stopped working in the first place",
  );
  assert.ok(
    !treeText(clamped).includes("more"),
    "a count rendered inside the clamped node is the first thing the cap cuts: measured at 360 px the suffix sat "
    + "56 px below the clamp box and never rendered, so a row covering three questions silently showed two",
  );
  let counter = null;
  walk(tree, (node) => {
    const children = node?.children ?? [];
    if (!counter && children.includes("+") && classesOf(node).includes("text-xs")) counter = node;
  });
  assert.ok(counter, "the count itself must still render, as its own node outside the clamp");
  assert.deepEqual(
    counter.children.filter((child) => typeof child === "number"),
    [2],
    "and it must name how many more questions the row covers, not just show a word",
  );
});

test("every control a question row offers lives in that cluster", () => {
  const tree = row();
  const text = treeText(cluster(tree));
  for (const label of ["Answer", "Mark as read", "Set aside"]) {
    assert.ok(
      text.includes(label),
      `"${label}" must stay inside the cluster. A control left outside it is a control that competes with the `
      + "text for the row width, which is the defect this file guards",
    );
  }
  assert.ok(
    !treeText(target(tree)).includes("Mark as read"),
    "the reversible acts belong to the cluster, not inside the click target — a button inside a button is invalid markup",
  );
});

test("the Answer control keeps its narrow shape and still meets the touch floor", () => {
  const actions = cluster(row());
  const answer = actions.children.find((child) => treeText(child).trim() === "Answer");
  assert.ok(answer, "the narrow door must still be a named control in the cluster");
  assert.equal(
    answer.props.size,
    "sm",
    "Answer stays `sm` (h-8 px-3 text-xs): dropping the size falls back to h-9 px-4 text-sm and makes it the "
    + "widest control on the row, which is the opposite of what a width-starved row needs",
  );
  assert.ok(
    classesOf(answer).includes("min-h-11"),
    "min-h-11 is what lifts Answer to the same 44 px floor as the row target and its two neighbours; `h-8` alone "
    + "is 12 px below the repository's stated touch target",
  );
});

test("a row without a question still keeps its acts in the cluster", () => {
  const tree = row({ questionKind: null, questionSummary: null }, { onOpenAsk: () => null });
  const text = treeText(cluster(tree));
  assert.ok(text.includes("Mark as read"));
  assert.ok(text.includes("Set aside"));
  assert.ok(!text.includes("Answer"), "a row the gate refuses must not advertise the second door");
});

test("an archived row offers bring-back from the same place", () => {
  const text = treeText(cluster(row({ archivedAt: 1, readAt: 1 })));
  assert.ok(text.includes("Show again"), "read state stays reversible");
  assert.ok(text.includes("Bring back"), "set-aside stays reversible, in the same cluster so it cannot be squeezed out");
});

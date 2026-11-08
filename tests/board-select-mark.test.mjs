import assert from "node:assert/strict";
import test from "node:test";
import { loadComponent, renderTree } from "./helpers/render-component.mjs";
import * as cardAttention from "../lib/card-attention.mjs";
import * as cardMetrics from "../lib/card-metrics.mjs";
import * as detailPresentation from "../lib/detail-presentation.mjs";
import * as doingNow from "../lib/doing-now.mjs";

/**
 * The multi-select mark is a LINE above the title, and the tile is the control.
 *
 * The board used to render a real `<input type="checkbox">` inside a `<label>` at the
 * head of the card's content row. That control put a second interactive element
 * inside a tile that is itself a `role="button"`, so a column of cards doubled its
 * tab stops, and every click on the box had to `stopPropagation` to avoid toggling
 * twice. Both are gone: select mode now paints an `aria-hidden` mark on its own
 * 20px line and the tile carries `aria-pressed` and the one click.
 *
 * The claims are asked of the rendered tree, not of the source text. A regex can be
 * satisfied by a comment or by an edit that changes what the component does; the
 * tree is what a reader gets, and a checkbox that is still rendered is a node.
 */

const mark = (name) => {
  const Component = () => null;
  Component.displayName = name;
  return Component;
};

const react = {
  Children: { toArray: (value) => (value == null ? [] : Array.isArray(value) ? value.flat() : [value]) },
  useCallback: (fn) => fn,
  useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
};

// The real mark is loaded and rendered INSIDE the probe, so the "no checkbox
// anywhere" claim still covers the markup the mark actually produces; the probe
// only gives that subtree a name the tree can be searched for.
// The mark's class map is stubbed: this file asserts the tree the mark produces
// (aria-hidden, no input), not the six tailwind classes it carries — those belong
// to `scripts/selection-metrics.mjs` and to the token's own module.
const selectionMark = {
  SELECTION_MARK_CLASS: "mark",
  selectionMarkClass: (selected) => (selected ? "mark mark-on" : "mark"),
};
const RealCardSelectRow = loadComponent("components/board/card-select-row.tsx", "CardSelectRow", {
  "./selection-mark": selectionMark,
});
const CardSelectRowProbe = (props) => ({
  type: "CardSelectRow",
  props: { ...props, rendered: RealCardSelectRow(props) },
  children: [],
});

const pills = {
  ActivityPill: mark("ActivityPill"),
  BuildStatusPills: mark("BuildStatusPills"),
  DoingNowPill: mark("DoingNowPill"),
  ErrorChip: mark("ErrorChip"),
  IntegrationPendingChip: mark("IntegrationPendingChip"),
  LightweightStatusPills: mark("LightweightStatusPills"),
  PausedChip: mark("PausedChip"),
  ReviewChip: mark("ReviewChip"),
  ScopeStrip: mark("ScopeStrip"),
};

const BoardCard = loadComponent("components/board/board-cards.tsx", "BoardCard", {
  react,
  "@get-bb/plugin-sdk/app": { useBbNavigate: () => ({ toThread() {} }), useRpc: () => ({ call: async () => ({}) }) },
  sonner: { toast: { error() {}, success() {}, message() {} } },
  "@/components/detail/card-detail-route": { INTENT_LABEL: {} },
  "../dashboard/build-status-pills": pills,
  "./card-select-row": { CardSelectRow: CardSelectRowProbe },
  "./use-return-focus": { useReturnFocus: () => ({ current: null }) },
  "../../lib/detail-presentation.mjs": detailPresentation,
  "../../lib/card-attention.mjs": cardAttention,
  "../../lib/card-metrics.mjs": cardMetrics,
  "../../lib/doing-now.mjs": doingNow,

  "../ui/reason-popover": { ReasonPopover: (props) => ({ type: "span", props, children: [] }) },
});

const card = {
  id: "card_1",
  displayName: "Select mark",
  kind: "build",
  stage: "build",
  status: "in-progress",
  activity: "idle",
  workerThreadId: null,
  projectName: "stelow",
  updatedAt: 1_700_000_000_000,
  scopeSummary: { scopesDone: 0, scopesTotal: 0, tasksDone: 0, tasksTotal: 0 },
};

function renderCard(overrides = {}) {
  return renderTree(BoardCard({ card, onOpen: () => {}, ...overrides }));
}

/** A flat node list; the shared helper stops at arrays and cannot see into a probe. */
function flatten(node, out = []) {
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, out);
    return out;
  }
  if (!node || typeof node !== "object") return out;
  out.push(node);
  if (node.props?.rendered) flatten(node.props.rendered, out);
  for (const child of node.children ?? []) flatten(child, out);
  return out;
}

const ofType = (nodes, type) => nodes.filter((node) => node.type === type);
const inputs = (nodes) => ofType(nodes, "input");
const checkboxInputs = (nodes) => inputs(nodes).filter((node) => node.props?.type === "checkbox");

test("outside select mode the tile carries no mark and no input", () => {
  const nodes = flatten(renderCard());
  assert.ok(
    nodes.some((node) => node.type === "h3"),
    "the mode-off tile still renders its heading, so the two absences below are absences and not an empty tree",
  );
  assert.equal(
    ofType(nodes, "CardSelectRow").length,
    0,
    "a card rendered without the mode must reserve no line: the mark is the whole of what select mode adds "
      + "above the title, so one here is a line every ordinary tile pays for",
  );
  assert.equal(
    inputs(nodes).length,
    0,
    "no input of any kind may render inside the tile: a nested interactive control inside a role=button "
      + "is the defect this markup replaced, and it doubled a column's tab stops",
  );
});

test("in select mode exactly one mark renders and no checkbox survives it", () => {
  const nodes = flatten(renderCard({ selectMode: true, onToggleSelection: () => {} }));
  const marks = ofType(nodes, "CardSelectRow");
  assert.equal(
    marks.length,
    1,
    "select mode renders exactly one selection line per tile: the retired control rendered one <label>+<input> "
      + `pair per tile, so any count other than 1 means the old control is back or doubled. Found: ${marks.length}`,
  );
  assert.equal(
    checkboxInputs(nodes).length,
    0,
    "zero checkbox inputs anywhere in the tile: the old markup rendered exactly one per tile, which is the "
      + "control this line replaced",
  );
  const markDiv = ofType(flatten(marks[0].props.rendered), "div")[0];
  assert.equal(
    markDiv?.props["aria-hidden"],
    true,
    "the mark is aria-hidden: it duplicates the tile's aria-pressed, so announcing it too is two toggles "
      + "per card for a screen reader",
  );
});

test("one click on the tile toggles the selection exactly once", () => {
  const toggled = [];
  const tile = renderCard({ selectMode: true, onToggleSelection: (id) => toggled.push(id) });
  assert.equal(
    tile.props.role,
    "button",
    "the tile itself is the selection control: a separate control inside it is what needed stopPropagation "
      + "twice, and two handlers on one gesture is the double toggle",
  );
  assert.notEqual(
    tile.props["aria-pressed"],
    undefined,
    "the tile announces its pressed state, so the state reaches assistive tech from the one control that exists",
  );
  assert.equal(toggled.length, 0, "rendering the tile is not a toggle: only a gesture may change the selection");
  tile.props.onClick();
  assert.deepEqual(
    toggled,
    ["card_1"],
    "one click calls the toggle once, with the card's own id: the old control's stopPropagation pair existed "
      + `because a click could reach two handlers and record the toggle twice. Recorded: ${toggled.length}`,
  );
});

test("the selection line is the tile's first child, above the heading", () => {
  const tile = renderCard({ selectMode: true, onToggleSelection: () => {} });
  const [first] = tile.children;
  assert.equal(
    first?.type,
    "CardSelectRow",
    "the line comes before everything else in the tile: it is a row of its own above the title, not a control "
      + `beside it. First child was: ${first?.type}`,
  );
  const nodes = flatten(tile);
  const headingIndex = nodes.findIndex((node) => node.type === "h3");
  assert.ok(headingIndex > 0, "the heading still renders inside the tile");
  assert.ok(
    nodes.findIndex((node) => node.type === "CardSelectRow") < headingIndex,
    "the mark sits above the heading in document order, so the title is never pushed aside by it",
  );
});

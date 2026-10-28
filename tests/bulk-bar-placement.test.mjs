import assert from "node:assert/strict";
import {
  BULK_BAR_SHELL_CLASS,
  BULK_BAR_SURFACE_CLASS,
  boardBottomPadding,
} from "../lib/bulk-bar-placement.mjs";
import { loadComponent, renderTree, walk } from "./helpers/render-component.mjs";
import * as bulkEligibility from "../lib/bulk-eligibility.mjs";
import * as bulkDeleteBatch from "../lib/bulk-delete-batch.mjs";
import * as kanban from "../lib/kanban-layout.mjs";
import * as vocabulary from "../lib/workflow-vocabulary.mjs";
import { panelHeaderStub } from "./helpers/panel-header-stub.mjs";

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
 * The claims below are asked of the rendered components, not of their source text: the bar
 * is compiled and walked to a tree, and the board is rendered with a selection so the
 * reserved strip can be read off the grid itself.
 */

const hooks = {
  useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
};
const marker = (name) => {
  const fn = () => null;
  fn.displayName = name;
  return fn;
};

// --- 1. It is out of the board's flow. --------------------------------------
// The regression was a wrapper with margin in the same column as the board. The
// rendered bar must sit directly in the floating shell, with no margin element
// between the shell and the board.
const BulkBarSlot = loadComponent("components/board/build-bulk-bar.tsx", "BulkBarSlot", {
  react: hooks,
  "@/components/ui/button": { Button: marker("Button") },
  "@/components/confirm-action-dialog": { ConfirmActionDialog: marker("ConfirmActionDialog") },
  sonner: { toast: { error() {}, success() {}, message() {} } },
  "../../lib/bulk-eligibility.mjs": bulkEligibility,
  "../../lib/bulk-delete-batch.mjs": bulkDeleteBatch,
  "../../lib/bulk-bar-placement.mjs": { BULK_BAR_SHELL_CLASS, BULK_BAR_SURFACE_CLASS },
  "./bulk-action-buttons": { BulkActionButtons: marker("BulkActionButtons") },
});

// Selection is a MODE now, so the bar's presence is a function of the mode and
// not of the count. See tests/selection-mode.test.mjs for why: a bar gated on the
// count disappeared exactly when the reader needed its exit.
const selectedState = (ids) => ({
  cards: [...ids].map((id) => ({
    id, displayName: id, status: "in-progress", activity: "running", workerThreadId: null,
  })),
  grouped: { inbox: [], analysis: [...ids].map((id) => ({ id })) },
  selectMode: true,
  selectedIds: new Set(ids),
  clearSelection: () => {},
  exitSelectMode: () => {},
  toggleSelection: () => {},
  rpc: { call: async () => ({}) },
});

assert.equal(
  BulkBarSlot({ state: { ...selectedState([]), selectMode: false } }),
  null,
  "outside select mode no bar renders, even with a stale id set: that combination is what reserved 96px of nothing",
);
assert.ok(
  BulkBarSlot({ state: selectedState([]) }),
  "an armed board with nothing selected still shows the bar, because this is the only visible way out of the mode",
);
const shell = BulkBarSlot({ state: selectedState(["card_1"]) });
assert.equal(
  shell.props.className,
  BULK_BAR_SHELL_CLASS,
  "the bar's root is the floating shell itself — not a block above the board: a wrapper was what pushed the board down",
);
const barNodes = [];
walk(renderTree(shell), (node) => barNodes.push(node));
assert.ok(
  barNodes.some((node) => node.props?.className === BULK_BAR_SURFACE_CLASS),
  "and the bar surface renders inside that shell",
);
assert.ok(
  !barNodes.some((node) => typeof node.props?.className === "string" && /(^|\s)mb-\d/.test(node.props.className)),
  "nothing in the bar carries a bottom margin, which is the shape of the original defect",
);

// --- 2. The class strings themselves name the placement. --------------------
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

let slotCalls = 0;
const BuildPanelView = loadComponent("components/panels/build-panel-view.tsx", "BuildPanelView", {
  react: hooks,
  "@get-bb/plugin-sdk/app": { UrlLink: marker("UrlLink") },
  "../detail/card-detail-route": { INTENT_LABEL: {} },
  "../../lib/kanban-layout.mjs": kanban,
  "../../lib/workflow-vocabulary.mjs": vocabulary,
  "../../lib/bulk-bar-placement.mjs": { boardBottomPadding },
  "../board/board-filters": { FiltersBar: marker("FiltersBar") },
  "../board/board-view-toggle": { ViewToggle: marker("ViewToggle") },
  "../board/select-mode-toggle": { SelectModeToggle: marker("SelectModeToggle") },
  "./build-control-strip": { BuildControlStrip: marker("BuildControlStrip") },
  "../board/track-lists": { BuildList: marker("BuildList") },
  "../board/board-column": { BoardColumn: marker("BoardColumn") },
  "./panel-header": panelHeaderStub(),
  "../board/archived-delete-props": { archivedDeleteProps: () => undefined },
  "../board/use-delete-archived-cards": { useDeleteArchivedCards: () => async () => {} },
  "../board/board-cards": { BoardCard: marker("BoardCard") },
  "../board/flow-strip": { FlowStrip: marker("FlowStrip") },
  "../board/hill-board": { HillBoard: marker("HillBoard") },
  "../board/card-gallery": { BucketGalleryButton: marker("BucketGalleryButton") },
  "../board/build-bulk-bar": { BulkBarSlot: (props) => { slotCalls += 1; return { bulkBar: props.state }; } },
  "../ui/button": { Button: marker("Button") },
  "../ui/icon": { Icon: marker("Icon") },
  "../../lib/utils": { cn: (...values) => values.filter(Boolean).join(" ") },
});

const boardFor = (selectedIds, { selectMode = true, viewMode = "board" } = {}) => {
  slotCalls = 0;
  const state = {
    cards: [],
    grouped: Object.fromEntries(vocabulary.BUILD_BOARD_VISIBLE_COLUMNS.map((column) => [column, []])),
    githubAutomationEnabled: false,
    githubAuthMissing: false,
    loading: false,
    selectMode,
    viewMode,
    projectIds: [],
    stageOptions: [],
    stages: [],
    intents: [],
    statuses: [],
    activities: [],
    collapsedColumns: {},
    collapsedListGroups: {},
    selectedIds: new Set(selectedIds),
    attention: false,
    rpc: {},
    projects: [],
    setAttention() {},
    toggleProject() {},
    toggleStage() {},
    toggleIntent() {},
    toggleStatus() {},
    toggleActivity() {},
    reset() {},
    toggleColumn() {},
    toggleListGroup() {},
    setViewMode() {},
    enterSelectMode() {},
    exitSelectMode() {},
  };
  const tree = renderTree(BuildPanelView({
    state,
    dialogs: null,
    onNewIssue() {},
    onOpenPresets() {},
    onOpenGithub() {},
    onOpenCard() {},
    onOpenThread() {},
  }));
  let board = null;
  walk({ type: "root", props: {}, children: [tree] }, (node) => {
    if (!board && node.props?.["data-testid"] === "kanban-board") board = node;
  });
  return { className: board?.props?.className ?? "", slots: slotCalls };
};

const withSelection = boardFor(["card_1"]);
assert.ok(
  withSelection.className.includes(boardBottomPadding(true)),
  "the board asks for its bottom padding from the mode, not from a constant",
);
assert.ok(!withSelection.className.includes(boardBottomPadding(false)), "and only the armed state reserves the strip");
assert.equal(withSelection.slots, 1, "the bar slot still renders once, in the board view");

// The strip follows the MODE. A stale id set on a board that is not selecting is
// the exact drift that reserved space under a bar nobody had opened.
const staleIds = boardFor(["card_1"], { selectMode: false });
assert.ok(
  !staleIds.className.includes(boardBottomPadding(true)),
  "ids left over from a previous selection reserve nothing once the mode is off",
);

// An unarmed board — not "zero selected", which is a different state now.
const empty = boardFor([], { selectMode: false });
assert.ok(empty.className.includes(boardBottomPadding(false)), "a board outside select mode reserves nothing");
assert.ok(!empty.className.includes(boardBottomPadding(true)), "so the floating strip is not left as a permanent gap");

console.log("bulk bar placement ok: floating, centred, safe-area aware, and out of the board's flow");

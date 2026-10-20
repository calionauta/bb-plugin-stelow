import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOf } from "./helpers/source-code.mjs";

/**
 * Multi-select is a mode, and a card reserves nothing for it.
 *
 * Two reports drove this file, and they are the same complaint from opposite
 * ends — the cost was always being paid, and the benefit was rarely available:
 *
 *  - "o checkbox ta ocupando muito espaco nos cards. tirando espaco de coisas
 *    importantes"
 *  - "e nao sei se eles precisam estar sempre disponiveis e visiveis"
 *
 * Measured, before: the checkbox was `size-8` (32px) plus a `gap-2` (8px) inside
 * a `p-3` tile in a `minmax(240px, 320px)` track. The content box is 216px at the
 * narrow end, so the control claimed 40/216 — 18.5% — of every tile, permanently,
 * and its own 34px of top-aligned height set the first line of every short title.
 *
 * And it was not "always available": it rendered on the Build kanban only. Not on
 * the list, not on the hill, not on Research or Explore, not in the Bucket
 * gallery — five of six surfaces had no multi-select at all.
 *
 * The assertions are written as substring checks against comment-stripped source
 * on purpose. That keeps them readable next to the code they guard, and it means
 * a change either contains the expression this file names or it does not — there
 * is no regex that can pass by matching a coincidence two functions away.
 */

const root = join(fileURLToPath(import.meta.url), "..", "..");
const read = (relative) => readFileSync(join(root, relative), "utf8");
const code = (relative) => codeOf(read(relative));

const boardCards = code("components/board/board-cards.tsx");
const panelView = code("components/panels/build-panel-view.tsx");
const bulkBar = code("components/board/build-bulk-bar.tsx");
// The buttons were extracted when the bar file reached its line budget; the rule
// they carry did not move, so the pin follows the code that carries it.
const bulkButtons = code("components/board/bulk-action-buttons.tsx");
const trackLists = code("components/board/track-lists.tsx");
const strip = code("components/panels/build-control-strip.tsx");
const gallery = code("components/board/card-gallery.tsx");
const selectionHook = code("hooks/use-selection-mode.ts");
const toggle = code("components/board/select-mode-toggle.tsx");
const layout = read("lib/kanban-layout.mjs");

/** One function's own body, from its declaration to the first top-level close. */
function bodyOf(source, declaration) {
  const start = source.indexOf(declaration);
  assert.ok(start >= 0, `${declaration} must still exist for its rules to have a home`);
  const end = source.indexOf("\n}\n", start);
  assert.ok(end > start, `${declaration} must still be a closed declaration`);
  return source.slice(start, end);
}

const boardCard = bodyOf(boardCards, "export function BoardCard(");
const cardShell = bodyOf(boardCards, "function CardShell(");
const cardSelect = bodyOf(boardCards, "function BoardCardSelect(");

test("the tile's checkbox exists only in select mode", () => {
  assert.ok(
    boardCard.includes('const selecting = selectMode === true && typeof onToggleSelection === "function"'),
    "the checkbox is gated on the MODE, not merely on the callback being passed: a caller that wires a "
    + "toggle without entering the mode must still reserve no space",
  );
  assert.ok(
    boardCard.includes("{selecting ? (") && boardCard.includes("<BoardCardSelect"),
    "and the checkbox is rendered behind that gate — a checkbox outside it is the 18% this fix removed",
  );
  assert.ok(
    boardCard.includes('className={`flex min-w-0 items-start ${selecting ? "gap-2" : ""}`}'),
    "the gap beside the checkbox is conditional too: reserving the gutter without the box is the same bug "
    + "one size smaller",
  );
});

test("select mode makes the whole tile a toggle instead of a target collision", () => {
  // Before: the tile opened the card and the checkbox stopped propagation on
  // every click, so one target carried two actions and the smaller one had to
  // fight for its own hits. In select mode the tile IS the checkbox's hit area.
  assert.ok(
    cardShell.includes("const activate = selectMode ? toggleSelection : open;"),
    "one activation path, chosen by the mode — the collision is what made selecting feel like fighting the tile",
  );
  assert.ok(cardShell.includes("onClick={activate}"), "and the tile's click is that one path");
  assert.ok(
    cardShell.includes("aria-pressed={selectMode ? Boolean(selected) : undefined}"),
    "a tile that toggles announces itself as pressed; one that opens does not",
  );
  assert.ok(
    cardShell.includes('!selectMode && (event.key === "w" || event.key === "W")'),
    "W still opens the worker thread outside select mode and does nothing inside it, where it would open a "
    + "thread the reader was not looking at",
  );
  assert.ok(
    cardShell.includes("const label = selectMode"),
    "and the accessible name changes with the mode, so a screen reader is not told a toggle opens a card",
  );
});

test("a surface without a bulk action is never handed one", () => {
  // Five of six surfaces had no multi-select. Passing it to them would paint the
  // control this fix exists to remove, on surfaces with no bar to use it with.
  assert.ok(
    !gallery.includes("onToggleSelection") && !gallery.includes("selectMode"),
    "the Bucket gallery renders board tiles, and must not arm selection inside a modal",
  );
  // The list DOES get it, on purpose: it is the surface a phone reader uses, and
  // it was one of the five that never had multi-select.
  assert.ok(
    panelView.includes("selectMode: state.selectMode,"),
    "the list view gets the mode, because a mode that only works on the kanban is the availability bug "
    + "this fix is also about",
  );
});

test("the bar renders whenever the mode is on, and carries the exit", () => {
  // A bar that vanished at zero selection would strand a reader: outside select
  // mode there is no checkbox, and with no bar there is no visible exit.
  assert.ok(
    bulkBar.includes("if (!state.selectMode) return null;"),
    "the bar is gated on the MODE, not on the count — otherwise an armed board with nothing selected has no way out",
  );
  assert.ok(
    !bulkBar.includes("selectedIds.size === 0) return null"),
    "the count gate is the regression: it removed the only exit exactly when it was needed",
  );
  assert.ok(bulkBar.includes("onExit={state.exitSelectMode}"), "the slot wires the exit");
  assert.ok(bulkBar.includes("onSelectAll="), "and offers the bulk way in, which hand-picking never did");
  assert.ok(
    bulkButtons.includes("allSelected ? `All ${present}` : `Select all (${present})`"),
    "Select all names its reach: the cards the filters left on the board, which is the blast radius the "
    + "confirm dialogs state",
  );
  // The exit sits beside the verbs and is not the destructive one.
  assert.ok(
    bulkButtons.includes('label="Done"'),
    "leaving the mode is a named control on the bar, not another checkbox",
  );
});

test("the bar and its exit reach every surface the mode reaches", () => {
  // Gap found in review: the bar was rendered from inside the KANBAN, but the
  // mode also reaches the list. Selecting in list view armed the mode with no bar,
  // no `Done`, no `Select all` — the exit existed only on the view the reader had
  // just left.
  assert.ok(
    panelView.includes("<BulkBarSlot state={state} />"),
    "the bar is mounted by the view router, not by one view",
  );
  // ONE mount, above the view router — which is stronger than three: a branch
  // added later cannot forget it, because no branch renders its own.
  const boardView = panelView.slice(
    panelView.indexOf("function BuildBoardView("),
    panelView.indexOf("function BuildSurface("),
  );
  const mounts = boardView.split("<BulkBarSlot state={state} />").length - 1;
  assert.equal(
    mounts,
    1,
    "the bar mounts once, above the branch, so every view inherits the exit instead of re-declaring it",
  );
  assert.ok(
    boardView.indexOf("<BulkBarSlot") < boardView.indexOf("<BuildSurface"),
    "and it mounts BEFORE the surface, so it cannot be conditional on which one rendered",
  );
  // And it is gone from the kanban component, where it used to be the only mount.
  const kanban = panelView.slice(
    panelView.indexOf("function BuildBoardKanban("),
    panelView.indexOf("function BuildBoardColumn("),
  );
  assert.ok(
    !kanban.includes("<BulkBarSlot"),
    "the kanban no longer owns it: a bar inside one view is the bug this pins",
  );
});

test("the list reserves the strip the floating bar occupies", () => {
  // The bar floats over whatever is under it. The kanban reserved `pb-24`; the
  // list did not, so a selection made from the list had the bar covering the last
  // rows — the surface where its verbs were reachable and the cards were not.
  const listBranch = panelView.slice(
    panelView.indexOf('if (state.viewMode === "list")'),
    panelView.indexOf('if (state.viewMode === "hill")'),
  );
  assert.ok(
    listBranch.includes("boardBottomPadding(state.selectMode)"),
    "the list body reserves the bar's strip in select mode",
  );
  assert.ok(
    listBranch.includes("<BuildList"),
    "and the reservation wraps the list itself, not a sibling",
  );
});

test("W does not navigate away from a selection in progress", () => {
  // The kanban tile already refused W in select mode; the list row did not, so
  // pressing it there opened a worker thread and left the reader mid-selection on
  // a screen that no longer showed the cards.
  assert.ok(
    trackLists.includes("if (selecting) return;"),
    "the list row's keyboard handler stands down in select mode",
  );
  assert.ok(
    trackLists.includes("openWorkerThread(event, card, onOpenThread);"),
    "while still opening the thread outside it",
  );
});

test("Escape belongs to a dialog before it belongs to the mode", () => {
  // Both the confirm dialog and the mode bind the document. An Escape meant for
  // "cancel this delete" closed the dialog AND disarmed the mode, discarding the
  // selection the reader was confirming.
  assert.ok(
    selectionHook.includes('[role="dialog"]'),
    "the mode's Escape handler yields to an open dialog",
  );
  const dialogCheck = selectionHook.indexOf('[role="dialog"]');
  const exitCall = selectionHook.indexOf("exit();", dialogCheck);
  assert.ok(
    exitCall > dialogCheck,
    "and the guard runs before the exit, which is the ordering that matters",
  );
});

test("the reserved strip follows the mode, not a count that outlives it", () => {
  // The bug: select three cards, switch to list view. The bar stopped rendering,
  // `selectedIds.size` stayed 3, and `pb-24` reserved 96px of nothing under a
  // board with no bar over it.
  assert.ok(
    panelView.includes("boardBottomPadding(state.selectMode)"),
    "the board asks the mode for its bottom padding, so a reserved strip and a rendered bar cannot disagree",
  );
  assert.ok(
    !panelView.includes("boardBottomPadding(state.selectedIds.size > 0)"),
    "the count-based call is the drift this pins",
  );
});

test("selection is reachable and leavable from the header and the keyboard", () => {
  assert.ok(
    strip.includes("<SelectModeToggle") && strip.includes("active={state.selectMode}"),
    "the door is one quiet control in the header, beside the view toggle — not a checkbox on every card",
  );
  assert.ok(
    panelView.includes("<BuildControlStrip"),
    "and the panel renders that strip, so the control is on the board rather than merely defined",
  );
  assert.ok(toggle.includes("aria-pressed={active}"), "the same button leaves the mode, and says which state it is in");
  assert.ok(toggle.includes("min-h-11"), "the control is a real touch target");
  assert.ok(toggle.includes("cursor-pointer"), "and a clickable one");

  // Esc, from the hook. Asserted at the source of the binding rather than by
  // rendering a hook that owns a document listener.
  assert.ok(selectionHook.includes('document.addEventListener("keydown"'), "Esc leaves the mode");
  assert.ok(selectionHook.includes('event.key !== "Escape"'), "and it is Escape that does it");
  assert.ok(selectionHook.includes("document.removeEventListener"), "the listener is removed with the mode");
});

test("the selection cannot outlive the surface that drew it", () => {
  // Three rules, each a bug that was live while the checkbox was unconditional.
  assert.ok(
    selectionHook.includes("setMode(false)") && selectionHook.includes("setRawIds(new Set())"),
    "leaving the mode clears the selection, so no bar and no reserved strip can outlive it",
  );
  assert.ok(
    selectionHook.includes("kept.length === current.size ? current : new Set(kept)"),
    "ids are pruned against what the board renders: a card filtered away or deleted kept its id counted "
    + "while every verb stayed disabled",
  );
  assert.ok(
    selectionHook.includes("viewRef.current === viewMode"),
    "changing view leaves the mode — the same staleness one level up, on a surface that cannot render it",
  );
});

test("a tile outside select mode claims no width for a control it does not have", () => {
  // The numbers this fix is about, asserted against the classes that produce
  // them: the tile is `p-3`, the track is bounded at 240px, and the checkbox —
  // when it renders at all — is 32px plus an 8px gap.
  assert.ok(layout.includes('expanded: "minmax(240px, 320px)"'), "the track is still the bounded one");
  assert.ok(boardCards.includes("bg-card p-3"), "and the tile's own gutter is unchanged");
  assert.ok(cardSelect.includes("size-8"), "the checkbox is 32px");
  assert.ok(
    boardCard.includes('${selecting ? "gap-2" : ""}'),
    "so its 40px of cost (32 + 8) only exists while someone is selecting — in the 240px track that is 18.5% "
    + "of the content box, which is what 'tirando espaco de coisas importantes' was about",
  );
});

test("the checkbox no longer needs to fight the tile for its own clicks", () => {
  // It still stops propagation, and the reason is now different and worth
  // stating: the tile around it is itself a toggle in this mode, so an
  // unstoppered click would toggle twice and land where it started.
  const stops = cardSelect.split("event.stopPropagation()").length - 1;
  assert.equal(
    stops,
    2,
    "both the label and the input stop propagation: the tile toggles too, so an unstoppered pair would cancel itself",
  );
});

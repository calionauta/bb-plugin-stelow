import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

/**
 * The selection mode's invariants, rendered against a real DOM.
 *
 * The structural file next door (`tests/selection-mode.test.mjs`) pins that the
 * checkbox is conditional and that the surfaces are wired. This one asks the
 * only question a source pin cannot answer: when a reader uses the mode, does
 * the RESULT hold? Each case below is a bug that shipped with the unconditional
 * checkbox.
 *
 * Everything goes through real events rather than calling the hook's setters
 * directly — React only re-renders inside `act`, and calling `enter()` from the
 * test body leaves the state one render behind the assertion (`false !== true`
 * was exactly that, in the first version of this file). A probe with buttons is
 * not ceremony: it is the difference between testing the hook and testing a
 * closure over a stale render.
 */

import { useSelectionMode } from "../hooks/use-selection-mode.ts";
import { SelectModeToggle } from "../components/board/select-mode-toggle.tsx";

/** A probe that exposes the hook's own API as clickable controls. */
function Probe({ presentIds, viewMode }) {
  const selection = useSelectionMode(presentIds, viewMode);
  return h("div", null,
    h("button", { onClick: selection.enter }, "enter"),
    h("button", { onClick: selection.exit }, "exit"),
    h("button", { onClick: () => selection.toggle("card_a") }, "toggle-a"),
    h("button", { onClick: () => selection.toggle("card_b") }, "toggle-b"),
    h("button", { onClick: () => selection.toggle("card_c") }, "toggle-c"),
    h("output", { "data-testid": "mode" }, String(selection.selectMode)),
    h("output", { "data-testid": "ids" }, [...selection.selectedIds].sort().join(",")));
}

const press = (name) => fireEvent.click(screen.getByText(name));
const mode = () => screen.getByTestId("mode").textContent;
const ids = () => screen.getByTestId("ids").textContent;

// --- 1. Entering and leaving the mode costs nothing when it is off ----------
//
// The measured complaint: `size-8` + `gap-2` out of a 196–276px content box
// (`scripts/selection-metrics.mjs`). The fix is not a smaller box, it is no box in
// the content row — and the proof is that leaving the mode returns the board to a
// state with no selection at all.

render(h(Probe, { presentIds: ["card_a", "card_b", "card_c"], viewMode: "board" }));
assert.equal(mode(), "false", "the board starts in normal mode: no tile reserves a checkbox");
assert.equal(ids(), "", "and nothing is selected");

press("enter");
assert.equal(mode(), "true", "the header control arms the mode");
press("toggle-a");
press("toggle-b");
assert.equal(ids(), "card_a,card_b", "tiles toggle into the selection");
press("toggle-a");
assert.equal(ids(), "card_b", "and out of it again");
press("exit");
assert.equal(mode(), "false", "leaving the mode turns it off");
assert.equal(
  ids(),
  "",
  "and clears the selection, so no bulk bar and no reserved bottom strip can outlive the mode",
);
cleanup();

// --- 2. A selection is pruned against the cards actually on the board -------
//
// The shipped bug: a card archived, deleted or filtered away kept its id. The
// bar then read "3 selected" while every verb was disabled, because the ids no
// longer resolved against the list the board was rendering.

const { rerender } = render(h(Probe, { presentIds: ["card_a", "card_b"], viewMode: "board" }));
press("enter");
press("toggle-a");
press("toggle-b");
assert.equal(ids(), "card_a,card_b", "both are selectable while both are on the board");

// The board re-renders without card_b — filtered away, archived, deleted.
rerender(h(Probe, { presentIds: ["card_a"], viewMode: "board" }));
assert.equal(
  ids(),
  "card_a",
  "a card that left the board leaves the selection: a count the reader cannot act on is worse than no count",
);
cleanup();

// --- 3. Changing view leaves the mode --------------------------------------
//
// The same staleness one level up: the mode is armed from the board header, and
// the hill renders neither a checkbox nor the bar, so carrying it there left an
// armed mode with no gesture that showed it.

const view = render(h(Probe, { presentIds: ["card_a"], viewMode: "board" }));
press("enter");
press("toggle-a");
assert.equal(mode(), "true");
assert.equal(ids(), "card_a");
view.rerender(h(Probe, { presentIds: ["card_a"], viewMode: "hill" }));
assert.equal(mode(), "false", "switching to a view that cannot render selection disarms the mode");
assert.equal(ids(), "", "and drops the selection with it");
cleanup();

// --- 4. Esc leaves the mode ------------------------------------------------
//
// The mode has no focusable surface of its own — the tiles are the targets — so
// the binding is on the document. Asserted by dispatching the event the browser
// would, not by calling `exit`.

render(h(Probe, { presentIds: ["card_a"], viewMode: "board" }));
press("enter");
press("toggle-a");
assert.equal(mode(), "true");
act(() => {
  // `KeyboardEvent` is not one of the globals the repo's dom-setup installs
  // (it defines `Event` and `CustomEvent`), so the class is read off the window
  // the DOM actually runs in rather than added to that shared setup for one test.
  const KeyboardEventClass = globalThis.window.KeyboardEvent;
  document.dispatchEvent(new KeyboardEventClass("keydown", { key: "Escape", bubbles: true }));
});
assert.equal(mode(), "false", "Escape is the way out a reader reaches for, and it works");
assert.equal(ids(), "", "and it leaves nothing selected behind");
cleanup();

// --- 5. The header control is a real toggle -------------------------------
//
// It enters AND leaves, announces which state it is in, and carries the count
// only while there is one: a permanent `0` reads as a badge that failed to load.

let enters = 0;
let exits = 0;
render(h(SelectModeToggle, {
  active: false,
  count: 0,
  onEnter: () => { enters += 1; },
  onExit: () => { exits += 1; },
}));
const door = screen.getByRole("button");
assert.equal(door.getAttribute("aria-pressed"), "false", "an unarmed mode says so");
assert.equal(door.textContent, "", "and shows no count, because a 0 is not a count yet");
fireEvent.click(door);
assert.equal(enters, 1, "clicking it arms the mode");
assert.equal(exits, 0, "and does not also leave it");
cleanup();

render(h(SelectModeToggle, { active: true, count: 2, onEnter: () => {}, onExit: () => { exits += 1; } }));
const exitDoor = screen.getByRole("button");
assert.equal(exitDoor.getAttribute("aria-pressed"), "true", "an armed mode says so");
assert.match(exitDoor.textContent, /2/, "and carries the live count");
fireEvent.click(exitDoor);
assert.equal(exits, 1, "clicking it again leaves the mode — one control, both directions");
cleanup();

// --- 6. The mode is not persisted across mounts ---------------------------
//
// A stored armed mode would greet a reader with a board full of checkboxes and no
// memory of having asked for them — which is the unconditional checkbox again,
// one reload late.

render(h(Probe, { presentIds: ["card_a"], viewMode: "board" }));
press("enter");
assert.equal(mode(), "true");
cleanup();
render(h(Probe, { presentIds: ["card_a"], viewMode: "board" }));
assert.equal(mode(), "false", "a fresh mount is unarmed, so the mode is a gesture and not a stored preference");
cleanup();

console.log("selection mode ok: pruning, mode-scoped padding, view exit, Escape, and one control that enters and leaves");

import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { drawerClosedTransform, drawerHasGrabBar, drawerPanelClass } from "../lib/drawer-side.mjs";
import { FlowStrip } from "../components/board/flow-strip.tsx";
import { PersistentResponsiveDrawerShell } from "../components/ui/persistent-responsive-drawer-shell.tsx";
import { ResponsiveDrawerShell } from "../components/ui/responsive-drawer-shell.tsx";

/**
 * The flow detail is a side drawer, not an accordion in the board's column.
 *
 * Reported: "a barra de flow ta em um lugar ruim tambem e qdo abre ta mal apresentada".
 *
 * It expanded IN PLACE, inside the board's own column, and then clamped its lists to
 * `max-h-56` — a scroll box inside a board that is itself a scrolling surface, pushing the
 * board down to make room for the thing describing it.
 *
 * The summary line stays on the board: it is a status reading, and a reader should not have
 * to open a panel to see how many cards finished. The detail moves to a right-side drawer,
 * which is full height for the lists and leaves the board visible beside it — so a name in
 * the list can be compared against the card it came from.
 *
 * The shell is shared rather than copied. `side` is a prop on the drawer the app already
 * uses, because the portal, the focus trap, the dismiss gesture and the settle animation are
 * the same mechanism on both edges, and the focus handling is the part nobody notices
 * breaking.
 *
 * Read RENDERED, not as source text: the drawer is a DOM tree, so "the detail is in a
 * right-side drawer and the summary is on the board" is a claim about what mounts and what
 * does not. The per-edge placement rule lives in `lib/drawer-side.mjs` and is called here,
 * so a reworded class cannot fail a test about placement.
 */

const metrics = {
  summary: { count: 3, leadP50Ms: 1_000, cycleP50Ms: 500, leadP90Ms: 2_000, cycleP90Ms: 900 },
  items: [
    { cardId: "card_a", kind: "build", name: "Alpha", leadMs: 1_000, cycleMs: 500 },
    { cardId: "card_b", kind: "build", name: "Beta", leadMs: 900, cycleMs: 400 },
  ],
  attention: [],
  wait: { totalMs: 0, humanMs: 0, systemMs: 0, unattributedMs: 0 },
  coverage: { reworkLine: "", coverageLine: "" },
};

const panelOf = () => document.querySelector("[data-persistent-drawer-content]");

/** Every class the owner's rule puts on a side's panel must be on the rendered panel. */
function assertOwnerPanelClass(panel, side) {
  for (const cls of drawerPanelClass(side).split(" ")) {
    assert.ok(panel.className.includes(cls), `the panel carries the owner's ${side} class ${cls}`);
  }
}

// --- 1/2/4/7. FlowStrip: summary on the board, detail in a right drawer. -----
{
  const fired = [];
  render(h(FlowStrip, {
    rpc: { call: async () => metrics },
    projectId: "proj_1",
    onOpenCard: (kind, cardId) => fired.push(`${kind}:${cardId}`),
  }));

  const summary = await screen.findByRole("button", { name: /Flow indicators:/ });
  assert.match(summary.getAttribute("aria-label") ?? "", /3 finished/, "the summary states how many cards finished");
  assert.equal(
    screen.queryByRole("heading", { name: "Flow" }),
    null,
    "the detail is not on the board before the drawer opens: it belongs to the panel, not the column",
  );

  fireEvent.click(summary);
  const heading = await screen.findByRole("heading", { name: "Flow" });
  const panel = panelOf();
  assert.ok(panel, "the detail renders inside the shared drawer shell");
  assert.ok(heading.closest("[data-persistent-drawer-content]"), "the detail heading sits inside the drawer, not the board's column");
  assert.equal(panel.contains(summary), false, "the summary stays on the board, outside the drawer");
  assertOwnerPanelClass(panel, "right");
  assert.match(panel.className, /border-l/, "edge-to-edge on the left, so the board stays visible beside it");
  assert.match(panel.className, /overflow-y-auto/, "the drawer's own body is the scroll surface");
  assert.equal(panel.querySelector(".max-h-56"), null, "the inner lists no longer clamp: one scroll surface, not two");
  assert.ok(screen.getByText("Flow indicators"), "the drawer is labelled for assistive tech, since its title is visual");
  assert.equal(heading.textContent, "Flow", "the drawer renders a visible heading and does not repeat the window the tab already shows");
  assert.match(panel.textContent ?? "", /lead is request to done/, "the heading states what lead and cycle mean");

  fireEvent.click(screen.getByRole("button", { name: /Alpha/ }));
  assert.deepEqual(fired, ["build:card_a"], "opening a card from the drawer reports the exact card");
  await waitFor(
    () => assert.equal(panel.getAttribute("data-state"), "closed", "opening a card closes the drawer first"),
  );
  cleanup();
}

// --- 5/6/8. The shell: `side` is a prop, and the two edges differ only in
// axis. Rendered both ways and compared against the owner's rules. ----------
{
  render(h(PersistentResponsiveDrawerShell, { open: false, onOpenChange: () => {} }, h("p", null, "board body")));
  const panel = panelOf();
  assert.ok(panel, "the persistent shell renders a panel");
  assertOwnerPanelClass(panel, "bottom");
  assert.equal(panel.style.transform, drawerClosedTransform("bottom"), "the default hides from the floor like every existing caller");
  assert.equal(
    Boolean(panel.querySelector("[data-persistent-drawer-handle]")),
    drawerHasGrabBar("bottom"),
    "the bottom sheet keeps its drag handle",
  );
  cleanup();
}
{
  render(h(PersistentResponsiveDrawerShell, { open: false, onOpenChange: () => {}, side: "right" }, h("p", null, "board body")));
  const panel = panelOf();
  assertOwnerPanelClass(panel, "right");
  assert.ok(panel.className.includes("w-[min(92vw,26rem)]"), "the panel is bounded so it never fills a phone or crowds a desktop board");
  assert.equal(panel.style.transform, drawerClosedTransform("right"), "a right panel enters from the right, not from the floor");
  assert.equal(
    Boolean(panel.querySelector("[data-persistent-drawer-handle]")),
    drawerHasGrabBar("right"),
    "the right panel has no grab bar: it has no drag-to-dismiss, so a handle would promise a gesture that does nothing",
  );
  cleanup();
}
{
  // The responsive wrapper forwards `side` rather than swallowing it; `open`
  // forces the wrapper past its realize gate so the forwarded panel is mounted.
  render(h(ResponsiveDrawerShell, { open: true, onOpenChange: () => {}, side: "right" }, h("p", null, "forwarded")));
  const panel = panelOf();
  assert.ok(panel, "the responsive wrapper mounts the shared shell");
  assertOwnerPanelClass(panel, "right");
  cleanup();
}

// --- 5. The two sides differ in axis, and only in axis. --------------------
const rightPanel = drawerPanelClass("right");
assert.ok(rightPanel.includes("fixed inset-y-0 right-0"), "a right panel is anchored full height to the right edge");
assert.ok(rightPanel.includes("border-l"), "and edge-to-edge on the left, so the board stays visible beside it");
assert.equal(
  drawerClosedTransform("right"),
  "translate3d(100%, 0, 0)",
  "and it enters from the right, not from the floor",
);
assert.equal(
  drawerClosedTransform("bottom"),
  "translate3d(0, 100%, 0)",
  "while the bottom sheet still rises, so the existing behaviour is unchanged",
);
assert.equal(
  drawerHasGrabBar("right"),
  false,
  "the right panel has none: it has no drag-to-dismiss, so a handle would promise a gesture that does nothing",
);
assert.equal(drawerHasGrabBar("bottom"), true, "and the bottom sheet keeps its drag handle");

// --- 6. The drawer's width leaves the board usable. ------------------------
assert.ok(
  rightPanel.includes("w-[min(92vw,26rem)]"),
  "the panel is bounded so it never fills the viewport on a phone and never crowds a desktop board",
);

console.log("flow drawer ok: side panel for the detail, summary line still on the board, one shared shell");

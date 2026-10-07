/**
 * Where a drawer's panel sits and which way it slides, per edge.
 *
 * Extracted from `persistent-responsive-drawer-shell.tsx` when the shell crossed the
 * repository's function budget after gaining a second edge. The strings are a rule about
 * placement rather than markup, and keeping them here makes the difference between the two
 * sides readable in one place instead of as two branches inside a 198-line component.
 *
 * `bottom` is the floating sheet the app already used: visible backdrop margins on every
 * side, rounded, with a grab bar for drag-to-dismiss. `right` is a full-height side panel
 * added for the flow drawer — a bottom sheet over a board covers the cards it describes, and
 * the board is itself a scrolling surface, so the panel takes the side rather than the floor.
 */

/** The panel's own box: position, size, and the edge it is anchored to. */
export function drawerPanelClass(side) {
  if (side === "right") {
    return [
      "fixed inset-y-0 right-0 z-50 flex w-[min(92vw,26rem)] flex-col",
      "border-l bg-background shadow-xl outline-none",
    ].join(" ");
  }
  return [
    "fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 flex",
    "max-h-[92dvh] flex-col rounded-2xl border bg-background shadow-xl outline-none",
  ].join(" ");
}

/**
 * The transform that hides the panel.
 *
 * Each edge slides along its own axis, so a right panel that inherited the bottom sheet's
 * transform would rise from the floor and then sit against the wall.
 */
export function drawerClosedTransform(side) {
  return side === "right" ? "translate3d(100%, 0, 0)" : "translate3d(0, 100%, 0)";
}

/**
 * Whether the panel renders the grab bar.
 *
 * The bar advertises a drag-to-dismiss gesture, and only the bottom sheet implements one. A
 * right panel dismisses by backdrop or Escape, so a bar there would promise a gesture that
 * does nothing — and the shell's drag hook is bound to the bottom sheet's axis.
 */
export function drawerHasGrabBar(side) {
  return side !== "right";
}

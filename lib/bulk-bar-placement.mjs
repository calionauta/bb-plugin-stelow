/**
 * Where the bulk-action bar sits, and why it is not in the board's flow.
 *
 * The bar used to render as a block above the kanban, inside the same column as the board.
 * Selecting a card therefore inserted a row into the layout and pushed the whole board down
 * — reported as "abre um componente acima do board e faz o board descer". A selection is not
 * a layout change: the cards do not move, only the actions appear.
 *
 * So the bar floats. It is centred at the bottom of the viewport rather than pinned to the
 * board's box, because the board is a snap-scrolling rail on a phone and a
 * horizontally-scrolling grid on a desktop: anchoring to it would put the bar wherever the
 * scroll happens to be. Fixed to the viewport, it is in the same place at every scroll
 * position and at every breakpoint.
 *
 * Two details that a floating bar has to get right and a static one does not:
 *
 *   - `env(safe-area-inset-bottom)` clears the home indicator on a phone. The repo already
 *     uses this for its drawers, so the pattern is established rather than invented here.
 *   - The bar must not cover the last row of cards. `pb-*` on the board reserves the space
 *     the bar occupies, so the bottom of the board stays reachable while the bar floats.
 *
 * The strings live in `lib/` rather than in the component for the same reason the layout
 * tracks do: they are a rule about placement that a test can read, and the class list is
 * long enough that inlining it makes the component's own shape hard to see.
 */

/** The floating shell: centred, above the safe area, and above the board in z-order. */
export const BULK_BAR_SHELL_CLASS = [
  "fixed inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40",
  "flex justify-center px-3",
  "pointer-events-none",
].join(" ");

/** The bar's own surface. `pointer-events-auto` because the shell is transparent to clicks:
 * the strip beside the bar must not swallow taps on the board behind it. */
export const BULK_BAR_SURFACE_CLASS = [
  "pointer-events-auto flex max-w-[min(100%,42rem)] flex-wrap items-center justify-center gap-2",
  "rounded-full border bg-card/95 px-3 py-2 shadow-lg backdrop-blur",
  // On a phone the bar wraps to two rows rather than overflowing the viewport: four
  // buttons with counts do not fit beside each other at 375px.
  "max-sm:w-full max-sm:rounded-2xl",
].join(" ");

/**
 * The space the board reserves at its bottom so the floating bar never covers a card.
 *
 * Only while the bar is present — an unselected board keeps its full height, which is why
 * this is a function of the selection rather than a constant on the board.
 */
export function boardBottomPadding(hasSelection) {
  return hasSelection ? "pb-24" : "pb-1";
}

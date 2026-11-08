import { selectionMarkClass } from "./selection-mark";

/**
 * The multi-select mark, and the line it rides on.
 *
 * A tile in select mode grows one line at the top, and this is it: 20px tall
 * (`h-5`), a 16px mark at the left, 6px before the heading (`mb-1.5`). Nothing
 * is reserved beside the title any more, which is the whole point — the control
 * this replaced was a `size-8` label plus a `gap-2` in the content row, 40px out
 * of a content box that measures 196–276px in the expanded track. That is 20.4%
 * of a narrow tile and 14.5% of a wide one, and it shifted every line under it
 * to the right. `scripts/selection-metrics.mjs` derives those numbers from the
 * classes that produce them, so they cannot drift away from the code again.
 *
 * The mark is decorative, and that is a deliberate substitution rather than an
 * omission: the reader asked for a checkbox, and a checkbox is what this is not.
 * The tile is the control — it carries `role="button"`, `aria-pressed` and the
 * click — so a real `<input>` here would nest an interactive element inside
 * another one and double the tab stops in a column of cards (60 tiles became 120
 * stops that way). `aria-hidden` keeps the promise honest: a screen reader hears
 * one toggle per card, and it hears the state from the tile.
 *
 * It is also not a checkbox that does nothing. Because it lives inside the tile,
 * a click on the mark bubbles to the tile's own handler and toggles exactly once
 * — which is why there is no `stopPropagation` here. The old control needed it
 * because it sat inside a tile that was itself a toggle.
 *
 * The retired control cost no height at all: the column it sat in is floored by
 * the title line plus the context row every tile renders, which together exceed
 * the 32px box, so that box never set the heading's height and this 26px line is
 * entirely new height. `scripts/selection-metrics.mjs` derives the floor and the
 * growth — and an earlier draft of this very comment claimed a 12px case for
 * cards without status pills, which verification showed cannot occur.
 */
export function CardSelectRow({ selected }: { selected: boolean }) {
  return (
    <div
      aria-hidden
      className="mb-1.5 flex h-5 items-center"
    >
      <span className={selectionMarkClass(selected)} />
    </div>
  );
}

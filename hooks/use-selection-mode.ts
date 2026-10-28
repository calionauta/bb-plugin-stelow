import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Multi-select on the board, behind an explicit mode.
 *
 * Two reports are the reason this module exists, and they are the same complaint
 * from two directions:
 *
 *  - "o checkbox ta ocupando muito espaço nos cards. tirando espaco de coisas
 *    importantes" — the selection checkbox is `size-8` (32px) plus a `gap-2`
 *    inside a `p-3` tile whose track is `minmax(240px, 320px)`. The content box
 *    is 196–276px once the column's padding and border and the tile's border are
 *    charged, so the control claimed 20.4% of a narrow card and 14.5% of a wide
 *    one. Its 32px box set no height at all: the heading's column is floored by
 *    the title line plus the context row every tile renders, which together
 *    exceed the box — so the 26px line that replaced it is entirely new height.
 *    `scripts/selection-metrics.mjs` derives the floor, the line and the growth.
 *  - "e nao sei se eles precisam estar sempre disponiveis e visiveis" — they
 *    were not "always available" either. The checkbox rendered on the Build
 *    kanban only: not on the list, not on the hill, not on Research or Explore,
 *    and not in the Bucket gallery. A control that is permanently painted on one
 *    of six surfaces is not permanently available; it is permanently in the way
 *    of the one surface that had it working.
 *
 * So selection becomes a MODE. It is entered deliberately and left deliberately,
 * and when it is off no tile reserves a single pixel for it.
 *
 * Three rules this module owns, each of which was a real bug while the checkbox
 * was unconditional:
 *
 *  1. **Leaving the mode clears the selection.** `selectedIds` outlived the view
 *     it was drawn on, so `selectedIds.size > 0` reserved `pb-24` of empty space
 *     and armed a bulk bar that listed three cards the reader could no longer
 *     see.
 *  2. **A selection cannot outlive its cards.** Ids were never pruned; a card
 *     archived, deleted or filtered away kept its id counted by the bar's
 *     "N selected" label while every verb stayed disabled. `presentIds` is what
 *     the caller actually renders, and the visible selection is the
 *     intersection — the same rule the archived-column delete already follows
 *     ("the client sends the exact ids it was showing, so the set cannot widen
 *     between the dialog and the click").
 *  3. **Changing view leaves the mode.** The mode is a board gesture; carrying
 *     it into a surface that cannot render it would be rule 1 all over again,
 *     one level up.
 */
/** The ids a board is showing, as a Set, from the identity-stable key. */
function presentSet(presentKey: string): Set<string> {
  return new Set(presentKey === "" ? [] : presentKey.split("\u0000"));
}

/**
 * Prune the selection to what the board still renders.
 *
 * The shipped bug: a card archived, deleted or filtered away kept its id, so the
 * bar read "3 selected" while every verb stayed disabled — the ids resolved
 * against a list they were no longer in. `presentIds` is what the caller
 * actually renders, and it is a KEY (a joined string) rather than the array so
 * this effect can depend on identity: a fresh array every render would re-run
 * the prune forever.
 */
function usePrunedSelection(presentKey: string) {
  const [rawIds, setRawIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setRawIds((current) => {
      const present = presentSet(presentKey);
      const kept = [...current].filter((id) => present.has(id));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [presentKey]);
  const selectedIds = useMemo(
    () => new Set([...rawIds].filter((id) => presentSet(presentKey).has(id))),
    [presentKey, rawIds],
  );
  return { rawIds, setRawIds, selectedIds };
}

/**
 * Leave the mode when the surface that armed it goes away.
 *
 * Two ways it goes away, and both were live bugs: the reader switched view (the
 * hill renders neither a checkbox nor the bar, so an armed mode had no gesture
 * that showed it), or they pressed Escape, which is the gesture they already use
 * to leave the card detail. Bound to the document for the second, because the
 * mode has no focusable surface of its own — the tiles are the targets.
 */
function useModeExit(mode: boolean, viewMode: string | undefined, exit: () => void) {
  const viewRef = useRef(viewMode);
  useEffect(() => {
    if (viewRef.current === viewMode) return;
    viewRef.current = viewMode;
    exit();
  }, [exit, viewMode]);
  useEffect(() => {
    if (!mode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Escape belongs to whatever is on top of the mode first. A confirm
      // dialog binds its own document listener, so without this an Escape meant
      // for "cancel this delete" both closed the dialog AND disarmed the mode,
      // throwing away the selection the reader was in the middle of confirming.
      // Radix and this repo's `Dialog` mark their overlay `role="dialog"`; a
      // dialog that is open owns the key.
      if (document.querySelector('[role="dialog"]') !== null) return;
      event.preventDefault();
      exit();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [exit, mode]);
}

export function useSelectionMode(presentIds: readonly string[], viewMode?: string) {
  const [mode, setMode] = useState(false);
  const presentKey = presentIds.join("\u0000");
  const { setRawIds, selectedIds } = usePrunedSelection(presentKey);

  const exit = useCallback(() => {
    setMode(false);
    setRawIds(new Set());
  }, [setRawIds]);
  useModeExit(mode, viewMode, exit);

  const toggle = useCallback((cardId: string) => {
    setRawIds((current) => {
      const next = new Set(current);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }, [setRawIds]);

  return {
    /** Whether tiles render their selection affordance at all. */
    selectMode: mode,
    enter: useCallback(() => setMode(true), []),
    exit,
    toggle,
    /** Only the ids this surface is actually showing. */
    selectedIds,
    /** Clears the selection but keeps the mode: done after a bulk verb runs. */
    clearSelection: useCallback(() => setRawIds(new Set()), [setRawIds]),
  };
}

/**
 * The selection mark's one definition.
 *
 * Two surfaces render this mark — a Build tile's select line
 * (`card-select-row.tsx`) and a list row (`track-lists.tsx`) — and a board and a
 * list that disagree about what "selected" looks like is the drift this token
 * exists to prevent. So the geometry and the two palettes live here, and each
 * surface imports them and adds only its own alignment (`mt-1` in the list row,
 * none on the tile line, which centers).
 *
 * It is its own module rather than an export of the tile's line so the list does
 * not depend on a component it never renders: if the tile's line is ever moved
 * outside the tile's border, that change must not take the list's mark with it.
 */
export const SELECTION_MARK_CLASS = "size-4 shrink-0 rounded border transition";

export function selectionMarkClass(selected: boolean): string {
  return `${SELECTION_MARK_CLASS} ${selected ? "border-primary bg-primary" : "border-border"}`;
}

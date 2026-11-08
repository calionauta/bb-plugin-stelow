/**
 * Shared Kanban track sizing. Fixed track bounds keep a wide canvas from
 * stretching columns while horizontal overflow still exposes every column.
 *
 * `mobile` is a deliberate second layout, not a smaller version of this one, and the
 * distinction is the whole point of it. On a 375px phone the desktop tracks render
 * 240px columns three-across in a horizontally scrolling grid, which is the pattern the
 * 2026 consensus names as the failure mode rather than the fallback: "columns overlap or
 * require awkward horizontal scrolling" (kanbn#414), and "horizontal scroll feels
 * clumsy... users don't realize they can swipe to see other columns" (Composio#1391).
 *
 * What shipped instead across Operon, NexPlan and the kanban CSS-grid references is
 * snap-scroll with viewport-sized columns and the next column's edge peeking in — the
 * "more here" affordance, in the words of the commit that popularised it — so a thumb
 * moves one column at a time and the reader can see that another exists.
 */
export const KANBAN_COLUMN_WIDTHS = {
  expanded: "minmax(240px, 320px)",
  collapsed: "56px",
  /** ~85vw: wide enough to read a card, narrow enough that the next column shows. */
  mobileExpanded: "min(85vw, 320px)",
};

/**
 * Multi-select toggle for board filters. Empty means "all" — the same
 * convention every filter shares, so selected arrays never need a
 * separate "all" sentinel. Pure for unit tests; the panel only wires it.
 */
export function toggleFilterValue(selected, value) {
  const list = Array.isArray(selected) ? selected : [];
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

/** Empty selection matches everything; otherwise membership decides. */
export function matchesFilterValue(selected, value) {
  const list = Array.isArray(selected) ? selected : [];
  return list.length === 0 || list.includes(value);
}

export function kanbanGridColumns(columns, collapsedColumns) {
  return columns
    .map((column) => collapsedColumns[column] ? KANBAN_COLUMN_WIDTHS.collapsed : KANBAN_COLUMN_WIDTHS.expanded)
    .join(" ");
}

/**
 * The same tracks for a phone: one column near-full-width, the next peeking.
 *
 * Kept beside the desktop function rather than inlined as a second `gridTemplateColumns`
 * string, so the two layouts are read together and a column added to one is visible as a
 * gap in the other.
 *
 * A collapsed column stays collapsed at its narrow track: collapsing is how a reader hides
 * a column they are not using, and that intent does not change on a smaller screen.
 */
export function kanbanMobileGridColumns(columns, collapsedColumns) {
  return columns
    .map((column) => collapsedColumns[column] ? KANBAN_COLUMN_WIDTHS.collapsed : KANBAN_COLUMN_WIDTHS.mobileExpanded)
    .join(" ");
}

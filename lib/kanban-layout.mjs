/**
 * Shared Kanban track sizing. Fixed track bounds keep a wide canvas from
 * stretching columns while horizontal overflow still exposes every column.
 */
export const KANBAN_COLUMN_WIDTHS = {
  expanded: "minmax(240px, 320px)",
  collapsed: "56px",
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

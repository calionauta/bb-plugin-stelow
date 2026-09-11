/**
 * Shared Kanban track sizing. Fixed track bounds keep a wide canvas from
 * stretching columns while horizontal overflow still exposes every column.
 */
export const KANBAN_COLUMN_WIDTHS = {
  expanded: "minmax(240px, 320px)",
  collapsed: "56px",
};

export function kanbanGridColumns(columns, collapsedColumns) {
  return columns
    .map((column) => collapsedColumns[column] ? KANBAN_COLUMN_WIDTHS.collapsed : KANBAN_COLUMN_WIDTHS.expanded)
    .join(" ");
}

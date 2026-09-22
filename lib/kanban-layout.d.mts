export declare const KANBAN_COLUMN_WIDTHS: {
  expanded: "minmax(240px, 320px)";
  collapsed: "56px";
};
export declare function kanbanGridColumns(columns: readonly string[], collapsedColumns: Record<string, boolean>): string;
export declare function toggleFilterValue(selected: unknown, value: string): string[];
export declare function matchesFilterValue(selected: unknown, value: string): boolean;

/**
 * A readable name for the filter a board is currently showing.
 *
 * The Archived column's "delete all" acts on exactly what the filter resolved,
 * so the confirmation has to say which filter that was. "Delete all?" would be
 * a lie whenever a filter is on — the reader has to be able to tell an
 * intentional narrow delete from a wide one before confirming an irreversible
 * action.
 *
 * Pure and label-agnostic: the caller supplies the display names, because the
 * same filter is spelled differently per track (`BUILD_BOARD_COLUMN_LABELS` vs
 * the research and explore sets) and this function must not own those tables.
 */

/** "all cards" when nothing narrows the board; otherwise the active parts. */
export function describeBoardFilter(filters, labels = {}) {
  const parts = [];
  const name = (value, kind) => labels[value] ?? value;
  const list = (values, kind) => {
    const items = (Array.isArray(values) ? values : []).filter((value) => typeof value === "string" && value.length > 0);
    if (items.length === 0) return;
    parts.push(`${kind}: ${items.map((value) => name(value, kind)).join(", ")}`);
  };
  list(filters?.projectIds, "project");
  list(filters?.intents, "type");
  list(filters?.stages, "stage");
  list(filters?.statuses, "status");
  list(filters?.activities, "activity");
  if (filters?.attention === true) parts.push("needs attention");
  return parts.length === 0 ? "all cards" : parts.join(" · ");
}

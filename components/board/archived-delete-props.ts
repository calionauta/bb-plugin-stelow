import { describeBoardFilter } from "../../lib/board-filter-label.mjs";

/**
 * The Archived column's delete-all wiring, shared by the three boards.
 *
 * Three panels render the same column, and the property that makes the action
 * safe is the one each could get subtly wrong on its own: the blast radius must
 * be the column as filtered, and the confirmation must name that filter. Derived
 * in one place, they cannot drift — a panel that passed the unfiltered card list
 * or a hard-coded "delete all?" would be a different function, not a variation.
 *
 * Returns `undefined` for every other column, so a caller can spread it onto
 * `BoardColumn` without branching on the column name.
 */

export const ARCHIVED_COLUMN = "archived";

export type ArchivedDeleteProps = {
  cardIds: string[];
  filterLabel: string;
  onConfirm: (cardIds: string[]) => Promise<void>;
};

export function archivedDeleteProps(input: {
  column: string;
  cards: { id: string }[];
  filters: unknown;
  labels?: Record<string, string>;
  projects?: { id: string; name: string }[];
  onConfirm: (cardIds: string[]) => Promise<void>;
}): ArchivedDeleteProps | undefined {
  if (input.column !== ARCHIVED_COLUMN) return undefined;
  const projectNames = Object.fromEntries((input.projects ?? []).map((p) => [p.id, p.name]));
  return {
    cardIds: input.cards.map((card) => card.id),
    filterLabel: describeBoardFilter(input.filters, { ...projectNames, ...(input.labels ?? {}) }),
    onConfirm: input.onConfirm,
  };
}

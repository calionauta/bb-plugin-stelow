import type { ReactNode } from "react";
import { DisclosureChevron } from "@/components/disclosure";
import { ArchivedColumnDelete } from "./archived-column-delete";
import type { ArchivedDeleteProps } from "./archived-delete-props";
import type { BoardCardItem } from "./board-cards";

/**
 * One board column: a collapsible header with its count, the Archived column's
 * delete-all, and the drop target the cards live in.
 *
 * `cards` is the already-filtered grouping for this column, which is what makes
 * the delete-all's blast radius the list on screen rather than a server-side
 * re-query. The affordance is passed in rather than derived here so a board that
 * has no delete-all simply omits it, and so the ids and the filter label come
 * from the same derivation on every track.
 */

/**
 * A column's header: the collapse control, the count, and — where a column has one — the
 * destructive control that acts on the whole column.
 *
 * The header is a ROW rather than one large button, and that is the fix for a reported
 * alignment defect. As a single `<button>` spanning the header, the Archived column's
 * delete-all had nowhere to live except a block between the header and the cards, which
 * pushed that column's card stack down and left it out of line with every other column.
 * A button also cannot contain another button, so no amount of layout would have let the
 * control sit inside it. As siblings, each control owns its own hit target and the header
 * is exactly as tall with the delete control as without it.
 */
function ColumnHeader(props: {
  count: number;
  collapsed: boolean;
  label: string;
  onToggle: () => void;
  deleteAll?: ArchivedDeleteProps;
  cardCount: number;
}) {
  const { count, collapsed, label, onToggle, deleteAll, cardCount } = props;
  const toggleClass = collapsed
    ? "flex h-full w-full cursor-pointer flex-col items-center gap-2 py-2 hover:bg-foreground/5"
    // `min-h-11` on the ROW, not only on the controls inside it. The delete-all button
      // carries the repository's touch-target floor (44px), and the toggle carried 40px, so
      // a header with the control stood 4px taller than one without — every column in the
      // Archived track sat 4px below its neighbours, which is a smaller version of the same
      // misalignment this restructure fixed. One row height for every column.
    : "flex min-h-11 flex-1 cursor-pointer items-center justify-between gap-2 rounded-md px-1 py-0.5 hover:bg-foreground/5";
  const toggleLabel = collapsed ? `Expand ${label}` : `Collapse ${label}`;
  return (
    <div className={`mb-2 flex items-center gap-1 ${collapsed ? "h-full" : ""}`}>
      <button
        onClick={onToggle}
        className={`${toggleClass} text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground`}
        title={toggleLabel}
        aria-label={toggleLabel}
      >
        {collapsed ? (
          <>
            <span className="rounded-md bg-foreground/10 px-1.5 text-foreground">{count}</span>
            <span style={{ writingMode: "vertical-rl" }} className="text-[10px] tracking-widest text-foreground/80">{label}</span>
            <DisclosureChevron open={false} className="text-foreground/60" />
          </>
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              <DisclosureChevron open />
              <span>{label}</span>
            </span>
            <span className="rounded-md bg-foreground/10 px-2 text-foreground">{count}</span>
          </>
        )}
      </button>
      {deleteAll && !collapsed ? <ArchivedColumnDelete {...deleteAll} count={cardCount} /> : null}
    </div>
  );
}

/** The scrolling card list, named for assistive tech by the column's own label. */
function ColumnCards(props: {
  cards: BoardCardItem[];
  label: string;
  renderCard: (card: BoardCardItem) => ReactNode;
}) {
  const { cards, label, renderCard } = props;
  return (
    <div
      className="space-y-2 md:min-h-0 md:flex-1 md:overflow-y-auto md:overscroll-y-contain md:pr-1"
      role="list"
      aria-label={`${label} cards`}
    >
      {cards.map((card) => <div key={card.id}>{renderCard(card)}</div>)}
    </div>
  );
}

export function BoardColumn(props: {
  column: string;
  cards: BoardCardItem[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  labels: Record<string, string>;
  renderCard: (card: BoardCardItem) => ReactNode;
  deleteAll?: ArchivedDeleteProps;
}) {
  const { column, cards, collapsed, onToggleCollapsed, labels, renderCard, deleteAll } = props;
  const label = labels[column];
  // No drop handling. The column used to be a drop target with a hover highlight, which
  // is what made the board read as a drag-and-drop tool: it is not one. The workflow is
  // the agent's to drive, and a person who wants a card elsewhere asks the agent.
  return (
    <section
      className={[
        "flex min-h-40 flex-col rounded-lg border bg-muted/30 p-2 transition",
        // Below `md` the board is a snap-scrolling rail, so each column takes its width
        // from here and snaps its own leading edge — that is what makes a swipe land on a
        // column instead of mid-gutter. `md:w-auto` hands the width back to the grid
        // template above, so the desktop tracks stay the single source for desktop.
        collapsed ? "w-14 shrink-0 snap-start" : "w-[min(85vw,320px)] shrink-0 snap-start md:w-auto",
        "md:h-full md:min-h-0",
        "border-border",
        collapsed ? "items-center" : "",
      ].join(" ")}
    >
      <ColumnHeader
        count={cards.length}
        cardCount={cards.length}
        collapsed={collapsed}
        label={label}
        onToggle={onToggleCollapsed}
        deleteAll={deleteAll}
      />
      {!collapsed ? (
        <ColumnCards cards={cards} label={label} renderCard={renderCard} />
      ) : null}
    </section>
  );
}

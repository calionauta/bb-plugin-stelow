import { useState, type ReactNode } from "react";
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

function ColumnHeader(props: {
  count: number;
  collapsed: boolean;
  label: string;
  onToggle: () => void;
}) {
  const { count, collapsed, label, onToggle } = props;
  const headerClass = collapsed
    ? "flex h-full w-full cursor-pointer flex-col items-center gap-2 py-2 hover:bg-foreground/5"
    : "mb-2 flex min-h-10 cursor-pointer items-center justify-between gap-2 rounded-md px-1 py-0.5 hover:bg-foreground/5";
  return (
    <button
      onClick={onToggle}
      className={`${headerClass} text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground`}
      title={collapsed ? `Expand ${label}` : `Collapse ${label}`}
      aria-label={collapsed ? `Expand ${label}` : `Collapse ${label}`}
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
  onDrop: (cardId: string) => void;
  labels: Record<string, string>;
  renderCard: (card: BoardCardItem) => ReactNode;
  deleteAll?: ArchivedDeleteProps;
}) {
  const { column, cards, collapsed, onToggleCollapsed, onDrop, labels, renderCard, deleteAll } = props;
  const label = labels[column];
  const [over, setOver] = useState(false);
  return (
    <section
      onDragOver={(event) => { event.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const id = event.dataTransfer.getData("text/stelow-card");
        if (id) onDrop(id);
      }}
      className={[
        "flex min-h-40 flex-col rounded-lg border bg-muted/30 p-2 transition",
        // Below `md` the board is a snap-scrolling rail, so each column takes its width
        // from here and snaps its own leading edge — that is what makes a swipe land on a
        // column instead of mid-gutter. `md:w-auto` hands the width back to the grid
        // template above, so the desktop tracks stay the single source for desktop.
        collapsed ? "w-14 shrink-0 snap-start" : "w-[min(85vw,320px)] shrink-0 snap-start md:w-auto",
        "md:h-full md:min-h-0",
        over ? "border-primary bg-primary/5" : "border-border",
        collapsed ? "items-center" : "",
      ].join(" ")}
    >
      <ColumnHeader
        count={cards.length}
        collapsed={collapsed}
        label={label}
        onToggle={onToggleCollapsed}
      />
      {deleteAll ? <ArchivedColumnDelete {...deleteAll} count={cards.length} /> : null}
      {!collapsed ? (
        <ColumnCards cards={cards} label={label} renderCard={renderCard} />
      ) : null}
    </section>
  );
}

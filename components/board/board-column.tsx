import { useState, type ReactNode } from "react";
import { DisclosureChevron } from "@/components/disclosure";
import type { BoardCardItem } from "./board-cards";

export function BoardColumn({ column, cards, collapsed, onToggleCollapsed, onDrop, labels, renderCard }: {
  column: string;
  cards: BoardCardItem[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onDrop: (cardId: string) => void;
  labels: Record<string, string>;
  renderCard: (card: BoardCardItem) => ReactNode;
}) {
  const [over, setOver] = useState(false);
  const headerClass = collapsed
    ? "flex h-full w-full cursor-pointer flex-col items-center gap-2 py-2 hover:bg-foreground/5"
    : "mb-2 flex min-h-10 cursor-pointer items-center justify-between gap-2 rounded-md px-1 py-0.5 hover:bg-foreground/5";
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
        "md:h-full md:min-h-0",
        over ? "border-primary bg-primary/5" : "border-border",
        collapsed ? "items-center" : "",
      ].join(" ")}
    >
      <button
        onClick={onToggleCollapsed}
        className={`${headerClass} text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground`}
        title={collapsed ? `Expand ${labels[column]}` : `Collapse ${labels[column]}`}
        aria-label={collapsed ? `Expand ${labels[column]}` : `Collapse ${labels[column]}`}
      >
        {collapsed ? (
          <>
            <span className="rounded-md bg-foreground/10 px-1.5 text-foreground">{cards.length}</span>
            <span style={{ writingMode: "vertical-rl" }} className="text-[10px] tracking-widest text-foreground/80">{labels[column]}</span>
            <DisclosureChevron open={false} className="text-foreground/60" />
          </>
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              <DisclosureChevron open />
              <span>{labels[column]}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="rounded-md bg-foreground/10 px-2 text-foreground">{cards.length}</span>
            </span>
          </>
        )}
      </button>
      {!collapsed ? (
        <div className="space-y-2 md:min-h-0 md:flex-1 md:overflow-y-auto md:overscroll-y-contain md:pr-1" role="list" aria-label={`${labels[column]} cards`}>
          {cards.map((card) => <div key={card.id}>{renderCard(card)}</div>)}
        </div>
      ) : null}
    </section>
  );
}

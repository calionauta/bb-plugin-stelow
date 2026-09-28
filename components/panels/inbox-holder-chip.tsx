import { cn } from "../../lib/utils";

/**
 * The card holding the file, as something you can click.
 *
 * The sentence already names it — "held by card Restore archived cards to
 * board columns" — and that was the whole of it. A reader who needed to see
 * WHAT that card is doing to the file had to copy a display name and hunt it on
 * a board of dozens, which is the reader doing the join that the system had the
 * id for and threw away.
 *
 * The link comes from `holderCardId`, never from re-finding the name in the
 * summary. A link parsed out of prose is a link that eventually points at the
 * wrong card, and it would break silently: the row would still look right.
 */
// A link that looks like a control and behaves like one: 44px target, a real
// focus ring, and the same quiet weight as every other button on the card.
const HOLDER_BUTTON = [
  "inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-md border px-2",
  "text-xs font-medium text-foreground hover:bg-muted",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
].join(" ");

type Holder = { holderCardId: string | null; holderFile: string | null; cardName: string };

export function HolderChip({ entry, onOpen }: { entry: Holder; onOpen: () => void }) {
  const name = entry.cardName;
  const file = entry.holderFile;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Held by</span>
      <button
        type="button"
        onClick={(event) => {
          // The row itself is a button that opens this card's notification;
          // without this the holder link would navigate twice, and land on the
          // card the reader just left.
          event.stopPropagation();
          onOpen();
        }}
        className={HOLDER_BUTTON}
        title={`Open ${name}${file ? `, which is holding ${file}` : ""}`}
      >
        <span className="max-w-40 truncate">{name}</span>
        <span aria-hidden>↗</span>
      </button>
      {file ? <span className="truncate font-mono text-[11px] text-muted-foreground">{file}</span> : null}
    </span>
  );
}

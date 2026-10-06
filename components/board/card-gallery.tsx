import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BoardCard, type BoardCardItem } from "./board-cards";

type OpenCard = (card: BoardCardItem) => void;

type CardGalleryDialogProps = {
  open: boolean;
  title: string;
  description: string;
  cards: BoardCardItem[];
  emptyText: string;
  onOpenCard: (card: BoardCardItem) => void;
  onClose: () => void;
};

// One expanded modal serves Bucket and hill piles with the same board tiles.
//
// Its width follows the content rather than a fixed share of the viewport. `sm:w-[70vw]`
// was chosen for a full grid and reads as a mistake for four cards: the modal stayed wide
// while the tiles huddled left. The bounds below let a small bucket sit at a readable
// measure and a large one grow, without either of them centring a void.
//
// The tile grid is `auto-fit` with the board column's own bounds, never `auto-fill`.
// `auto-fill` creates phantom tracks to fill the width, so four cards in a wide modal
// reserved the empty columns as real tracks and every tile huddled left — the void in the
// screenshot. `auto-fit` collapses those empty tracks, which is the whole fix.
//
// The upper bound stays `320px` rather than becoming `1fr`: a tile is the board's own tile at
// the board's own size, and `1fr` would stretch it to fill a wide modal. That was my first
// attempt at this fix, and the existing assertion in kanban-layout.test.mjs caught it —
// `no gallery track stretches to fill the modal` is a real rule, not a formatting preference.
//
// `min(240px,100%)` keeps a card readable on a phone without overflowing it: the `100%` arm
// wins below 260px, which is what makes one column work at 375px.
export function CardGalleryDialog({
  open,
  title,
  description,
  cards,
  emptyText,
  onOpenCard,
  onClose,
}: CardGalleryDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        fullscreenOnMobile
        className="h-[85dvh] overflow-y-auto sm:w-auto sm:min-w-[min(92vw,32rem)] sm:max-w-[min(92vw,64rem)]"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {cards.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <ul
            data-gallery-tiles
            className="grid content-start items-start justify-start gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),320px))]"
          >
            {cards.map((card) => (
              <li key={card.id}>
                <BoardCard
                  card={card}
                  onOpen={() => onOpenCard(card)}
                />
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function bucketGalleryCopy(cardCount: number) {
  return {
    title: "Bucket",
    description:
      cardCount > 0
        ? `Captured, nothing running yet — ${cardCount} card${cardCount === 1 ? "" : "s"} waiting to start.`
        : "Captured, nothing running yet.",
    emptyText:
      "Bucket's empty — new cards land here until their worker starts.",
  };
}

export function useBucketGallery(cards: BoardCardItem[], onOpenCard: OpenCard) {
  const [open, setOpen] = useState(false);
  const copy = bucketGalleryCopy(cards.length);

  function openCard(card: BoardCardItem) {
    setOpen(false);
    onOpenCard(card);
  }

  const bucketGallery = (
    <CardGalleryDialog
      open={open}
      title={copy.title}
      description={copy.description}
      cards={cards}
      emptyText={copy.emptyText}
      onOpenCard={openCard}
      onClose={() => setOpen(false)}
    />
  );

  return {
    openBucketGallery: () => setOpen(true),
    bucketGallery,
  };
}

export function BucketGalleryButton({
  cards,
  onOpenCard,
}: {
  cards: BoardCardItem[];
  onOpenCard: OpenCard;
}) {
  const gallery = useBucketGallery(cards, onOpenCard);
  return (
    <>
      <Button
        className="min-h-11 w-full cursor-pointer sm:w-auto sm:flex-none"
        variant="outline"
        onClick={gallery.openBucketGallery}
        title="Open the Bucket — captured cards waiting to start"
      >
        <Icon
          name="PackageReceive"
          className="h-4 w-4"
          aria-hidden
        />
        Bucket{cards.length > 0 ? ` (${cards.length})` : ""}
      </Button>
      {gallery.bucketGallery}
    </>
  );
}

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
        className="h-[85dvh] overflow-y-auto sm:w-[70vw] sm:max-w-[70vw]"
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
            className="grid items-start justify-start gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(240px,100%),320px))]"
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

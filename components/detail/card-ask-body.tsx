import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { useDebouncedRealtime } from "../use-debounced-realtime";
import { heroFor } from "./detail-hero";
import { HERO_STYLE } from "./detail-hero";
import { PromptRead } from "./prompt-edit-control";
import { DetailQuestionSections } from "./detail-question-sections";
import { ArtifactViewerDialog } from "./artifact-viewer-dialog";
import { SECTION_SURFACE } from "../disclosure";
import { Button } from "../ui/button";
import type { ViewerFile } from "./build-detail-view";

/**
 * The narrow door onto a question: the ask itself, without the card.
 *
 * A card is nine sections, so loading all nine to answer one question is a real
 * tax. An Inbox row for a question can therefore offer a second, smaller door:
 * the status line, the request's collapsed line, the question, and its options.
 * This route is that door.
 *
 * It is deliberately NOT a second implementation. It renders the card's own
 * `PromptRead` collapsed branch and its own `DetailQuestionSections`, so the two
 * doors cannot disagree about what a question looks like or what answering one
 * means — and `openAskArtifact` is reused, so an option's document opens here
 * exactly as it does there.
 *
 * What it must not show: the receipt, stage and runs, files and diffs, the
 * comment thread, the split action. None of those is evidence for a decision.
 * The staleness advisory and the option documents DO travel with the question,
 * because a decision made without them is the decision this door exists to make
 * safe.
 */
/**
 * Load the card a question belongs to, plus the live card detail RPC payload.
 *
 * Split from the view so `CardAskBody` stays a layout function: the loading,
 * error and realtime-refresh behaviour is one concern, and the door's shape is
 * another.
 */
function useAskCard(cardId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [card, setCard] = useState<Awaited<ReturnType<typeof rpc.call<"cardDetail">>>["card"] | null>(null);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof rpc.call<"cardDetail">>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void rpc.call("cardDetail", { cardId }).then((result) => {
      if (cancelled) return;
      setDetail(result);
      setCard(result.card);
      setError(null);
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load the question.");
    });
    return () => { cancelled = true; };
  }, [cardId, rpc]);

  // The answers land here too: a batch answered on this door must clear the row
  // the reader came through, and a long-running worker can still ask a followup.
  useDebouncedRealtime(["card-state", "inbox-changed"], () => {
    void rpc.call("cardDetail", { cardId }).then((result) => {
      setDetail(result);
      setCard(result.card);
    }).catch(() => undefined);
  });

  return { card, detail, error };
}

/** What the reader sees when the ask cannot be loaded — with a way onward. */
function AskDoorFailure({ message, onOpenCard }: { message: string; onOpenCard: () => void }) {
  return (
    <div className="p-4">
      <p role="alert" className="text-sm text-destructive">{message}</p>
      <Button variant="link" className="mt-2 min-h-11 px-0" onClick={onOpenCard}>
        Open the full card instead
      </Button>
    </div>
  );
}

/** Two placeholder blocks, the shape of what is coming. */
function AskDoorSkeleton() {
  return (
    <div className="space-y-3 p-4" aria-label="Loading question" aria-busy="true">
      <div className="h-24 animate-pulse rounded-md border bg-muted/30" />
      <div className="h-24 animate-pulse rounded-md border bg-muted/30" />
    </div>
  );
}

/**
 * The document viewer this door needs, as its own state.
 *
 * An option's attached evidence is part of the decision, so it must open here —
 * refusing it would send the reader back to the nine-section card this door
 * exists to avoid. Extracted because `CardAskBody` was over its function budget
 * and this is one concern: which document is open.
 */
function useAskViewer() {
  const [file, setFile] = useState<ViewerFile>(null);
  const close = useCallback(() => setFile(null), []);
  return { file, setViewerFile: setFile, close };
}

/** The door's own chrome: which card this is, and the way out to the whole of it. */
function AskDoorHeader({ card, onOpenCard }: { card: { displayName?: string | null; name: string; projectName: string }; onOpenCard: () => void }) {
  return (
    <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{card.displayName ?? card.name}</p>
        <p className="truncate text-xs text-muted-foreground">{card.projectName}</p>
      </div>
      <Button variant="outline" size="sm" className="min-h-11 shrink-0" onClick={onOpenCard}>
        Open full card
      </Button>
    </header>
  );
}

/** The read-only status line plus the request's collapsed line. */
function AskDoorBrief({ card, detail }: { card: { prompt: string }; detail: unknown }) {
  const hero = heroFor(card as never, detail as never);
  const heroStyle = HERO_STYLE[hero.kind];
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  // Focus the heading when the door opens. This is a different ROUTE, so nothing
  // else tells a keyboard or screen-reader user the view changed: without it the
  // next Tab starts from the top of the document and the new content is
  // discovered by luck. `tabIndex={-1}` makes the heading focusable
  // programmatically without adding a tab stop; `preventScroll` keeps the
  // reader's position in a panel that may already be scrolled.
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, []);
  return (
    <section
      aria-label="Card status"
      {...(heroStyle.alert ? { role: "alert" } : {})}
      className={`${SECTION_SURFACE} p-3 ${heroStyle.wrap}`}
    >
      <div className="flex items-start gap-2.5">
        <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${heroStyle.dot}`} />
        <div className="min-w-0 flex-1 space-y-1">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-[16px] font-semibold leading-snug tracking-tight text-foreground outline-none"
          >
            {hero.title}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">{hero.sub}</p>
          {/* The SAME collapsed description the card renders. */}
          <PromptRead prompt={card.prompt} editable={false} onEdit={() => undefined} />
        </div>
      </div>
    </section>
  );
}

export function CardAskBody({ cardId, onOpenCard }: {
  cardId: string;
  onOpenCard: () => void;
}) {
  const { card, detail, error } = useAskCard(cardId);
  // `eventId` is not read here on purpose: the row's gate already resolved
  // WHICH ask this door is for, and the decision surface renders the card's live
  // set. The route still carries the id so the door is addressable and a reload
  // lands on the same thing rather than a bare card.
  const viewer = useAskViewer();

  if (error) return <AskDoorFailure message={error} onOpenCard={onOpenCard} />;
  if (!card || !detail) return <AskDoorSkeleton />;
  return (
    <div className="flex h-full flex-col">
      <AskDoorHeader card={card} onOpenCard={onOpenCard} />
      <div className="flex-1 overflow-auto px-3 py-3 pb-24 sm:p-4 sm:pb-4">
        <div className="mx-auto w-full max-w-2xl space-y-4">
          <AskDoorBrief card={card} detail={detail} />
          {/* The question, through the card's own section — never re-implemented. */}
          <DetailQuestionSections
            card={card}
            detail={detail}
            setViewerFile={viewer.setViewerFile}
            // Answering is what this door was for, so it hands back rather than
            // sitting on a spent question. It goes to the CARD, not away: the
            // reader answered out of context, and the card is where they can
            // see what their answer changed.
            onAnswered={onOpenCard}
            openLiveArtifact
          />
        </div>
      </div>
      <ArtifactViewerDialog
        open={viewer.file !== null}
        onOpenChange={viewer.close}
        cardId={cardId}
        file={viewer.file}
        editorTarget={viewer.file?.target ?? null}
        mode={viewer.file?.mode}
        optionLabel={viewer.file?.optionLabel}
        onCommented={() => undefined}
      />
    </div>
  );
}

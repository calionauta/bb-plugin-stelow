import { Children, useCallback, useState, type MouseEvent, type ReactNode } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { INTENT_LABEL } from "@/components/detail/card-detail-route";
import { useReturnFocus } from "./use-return-focus";
import { errorActivityLabel, idleDurationLabel, liveBorderClass, pausedActivityLabel, statusTone } from "../../lib/detail-presentation.mjs";
import { cardCanResume, cardNeedsReview } from "../../lib/card-attention.mjs";
import { formatDuration } from "../../lib/card-metrics.mjs";
import { orderedDoingNow } from "../../lib/doing-now.mjs";
import {
  ActivityPill,
  BuildStatusPills,
  DoingNowPill,
  ErrorChip,
  IntegrationPendingChip,
  PausedChip,
  LightweightStatusPills,
  ReviewChip,
  ScopeStrip,
} from "../dashboard/build-status-pills";
import type { rpcContract } from "../../server";

type RpcResult = Awaited<ReturnType<ReturnType<typeof useRpc<typeof rpcContract>>["call"]>>;
export type BoardCardItem = Extract<RpcResult, { cards: unknown }>["cards"][number];

const BOARD_CARD_CLASS =
  "stelow-live-surface stelow-board-card block w-full cursor-pointer overflow-hidden "
  + "rounded-lg border bg-card p-3 text-left shadow-sm transition hover:shadow-md "
  + "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";

export function CardRetryButton({ cardId, label }: { cardId: string; label: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [retrying, setRetrying] = useState(false);
  async function retry(event: MouseEvent) {
    event.stopPropagation();
    if (retrying) return;
    setRetrying(true);
    try {
      const result = await rpc.call("retryWorker", { cardId });
      if (!result.ok) toast.error(result.error ?? "Retry failed. Open the card to restart fresh.");
      else toast.success("Worker retried.");
    } finally {
      setRetrying(false);
    }
  }
  return (
    <button
      onClick={(event) => void retry(event)}
      disabled={retrying}
      title="Retry the worker in place"
      className={
        "min-h-11 cursor-pointer rounded-md border border-primary/40 px-3 text-xs font-medium "
        + "text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
      }
    >
      {retrying ? "Resuming…" : `↻ ${label}`}
    </button>
  );
}

/**
 * The chips that say what is happening to this card, one per state.
 *
 * Extracted from `CardMetaRows` because the list of chips is the part that
 * grows: every chip costs a line of conditional and the render function was on
 * its size budget before the pause fix needed a comment in it.
 */
function CardAlertChips({ card, stopped, paused }: {
  card: BoardCardItem;
  stopped: { label: string; detail: string } | null;
  paused: { label: string; detail: string } | null;
}) {
  return (
    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
      {stopped ? <ErrorChip label={stopped.label} detail={stopped.detail} /> : null}
      {paused ? <PausedChip label={paused.label} detail={paused.detail} /> : null}
      {card.integrationPending ? (
        <IntegrationPendingChip
          label={card.integrationPending.label}
          detail={card.integrationPending.detail}
        />
      ) : null}
      {card.activity === "running" || card.activity === "awaiting-answer" ? (
        <DoingNowPill names={orderedDoingNow(card.executingScope, card.doingNow)} />
      ) : null}
      {cardNeedsReview(card) ? <ReviewChip /> : null}
    </div>
  );
}

/**
 * The project line, and how long the card has been waiting beside it.
 *
 * The wait used to be `· Idle since 10/19/2026, 3:01:31 AM` in a `shrink-0`
 * span, which is wider than the 240px column's content box: it could not
 * shrink, could not wrap, and took the project name out of the card with it.
 * Now it is a compact duration (`idleDurationLabel`) and it is the part that
 * yields — `truncate` on the wrapper, `shrink` on the span — with the exact
 * timestamp on the element's own title, where a reader who needs the instant
 * will look for it.
 */
function CardContextRow({ card }: { card: BoardCardItem }) {
  const idleFor = idleDurationLabel(card);
  const exact = Number.isFinite(card.updatedAt) ? new Date(card.updatedAt).toLocaleString() : "unknown";
  return (
    <div className="mt-2 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
      <span className="min-w-0 truncate">{card.projectName}</span>
      {idleFor ? (
        <span className="ml-auto shrink truncate" title={`Idle since ${exact}`}>{idleFor}</span>
      ) : null}
    </div>
  );
}

export function CardMetaRows({ card }: { card: BoardCardItem }) {
  const stopped = errorActivityLabel(card);
  const paused = pausedActivityLabel(card);
  // ONE chip per state. A paused card used to wear two — `Paused` from
  // `pausedActivityLabel` and `Paused. Resume it.` from an amber attention
  // chip — because both were fed by the same `cardIsStalled` predicate and
  // neither knew the other had already said it. The pause chip survives
  // because it carries the recovery sentence on hover; the amber channel stays
  // on the border, which is the surface that still has something new to say
  // (see `liveBorderClass`).
  const showAlerts =
    stopped != null ||
    paused != null ||
    card.integrationPending != null ||
    card.activity === "running" ||
    card.activity === "awaiting-answer" ||
    cardNeedsReview(card);
  return (
    <>
      {showAlerts ? <CardAlertChips card={card} stopped={stopped} paused={paused} /> : null}
      <CardContextRow card={card} />
    </>
  );
}

export function CardHeading({ title, status }: { title: string; status: ReactNode }) {
  const statusItems = Children.toArray(status);
  return (
    <header className="min-w-0 space-y-1.5">
      <h3 className="line-clamp-3 min-w-0 break-words text-sm font-semibold leading-5 text-foreground">{title}</h3>
      {statusItems.length ? <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">{statusItems}</div> : null}
    </header>
  );
}

type BoardCardProps = {
  card: BoardCardItem;
  onOpen: () => void;
  selected?: boolean;
  /** The board is in select mode: the tile toggles instead of opening. */
  selectMode?: boolean;
  onToggleSelection?: (cardId: string) => void;
};

/**
 * One tile surface, in one of two modes.
 *
 * In select mode the card is a checkbox with a title: the whole tile toggles the
 * selection and nothing opens. That is deliberately different from the normal
 * mode, where the tile opens the card — the two actions used to share one
 * target, which is why the checkbox had to `stopPropagation` on every click and
 * why selecting a card felt like fighting the tile.
 *
 * `onToggleSelection` being present IS the mode: a surface that offers selection
 * always offers the toggle with it, so a tile cannot paint a checkbox nobody
 * wired. Every caller that does not pass it (the Bucket and hill galleries, the
 * list and hill views, Research and Explore) reserves no space for a control it
 * does not have.
 */
function CardShell({ card, ariaNoun, selected, selectMode, onToggleSelection, onOpen, children }: {
  card: BoardCardItem;
  ariaNoun: string;
  selected?: boolean;
  selectMode?: boolean;
  onToggleSelection?: (cardId: string) => void;
  onOpen: () => void;
  children: ReactNode;
}) {
  const navigate = useBbNavigate();
  const returnFocusRef = useReturnFocus<HTMLDivElement>(card.id);
  const open = useCallback(() => onOpen(), [onOpen]);
  const toggleSelection = useCallback(() => {
    onToggleSelection?.(card.id);
  }, [card.id, onToggleSelection]);
  const openThread = useCallback(() => {
    if (card.workerThreadId) navigate.toThread(card.workerThreadId);
  }, [navigate, card.workerThreadId]);
  const activate = selectMode ? toggleSelection : open;
  const label = selectMode
    ? `${selected ? "Deselect" : "Select"} ${card.displayName}.`
    : `Open ${ariaNoun} ${card.displayName}.`;
  return (
    <div
      role="button"
      tabIndex={0}
      ref={returnFocusRef}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); }
        else if (!selectMode && (event.key === "w" || event.key === "W")) { event.preventDefault(); openThread(); }
      }}
      title={selectMode
        ? "Click to add this card to the selection"
        : card.workerThreadId ? "Click to inspect · W opens the worker thread" : "Click to inspect"}
      className={`${BOARD_CARD_CLASS} ${liveBorderClass(card) || "border-border hover:border-primary/60"}${selected ? " ring-1 ring-primary" : ""}`}
      aria-label={label}
      aria-pressed={selectMode ? Boolean(selected) : undefined}
    >
      {children}
    </div>
  );
}

function CardResumeFooter({ card }: { card: BoardCardItem }) {
  const retry = cardCanResume(card) && card.activity !== "error" ? (
    <CardRetryButton cardId={card.id} label="Resume work" />
  ) : null;
  if (!retry) return null;
  return (
    <div className="mt-2 border-t border-border/70 pt-2">
      <div className="flex gap-2">{retry}</div>
    </div>
  );
}

export function BoardCard({ card, onOpen, selected, selectMode, onToggleSelection }: BoardCardProps) {
  const selecting = selectMode === true && typeof onToggleSelection === "function";
  return (
    <CardShell
      card={card}
      ariaNoun="card"
      selected={selected}
      selectMode={selecting}
      onToggleSelection={onToggleSelection}
      onOpen={onOpen}
    >
      <div className={`flex min-w-0 items-start ${selecting ? "gap-2" : ""}`}>
        {selecting ? (
          <BoardCardSelect
            cardId={card.id}
            displayName={card.displayName}
            selected={Boolean(selected)}
            onToggleSelection={onToggleSelection}
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <CardHeading
            title={card.displayName}
            status={<BuildStatusPills card={card} statusTone={statusTone} intentLabel={(intent: string) => INTENT_LABEL[intent]} />}
          />
          <BoardCardProgress card={card} />
          <CardMetaRows card={card} />
        </div>
      </div>
      <CardResumeFooter card={card} />
    </CardShell>
  );
}


/**
 * The multi-select checkbox, rendered ONLY in select mode.
 *
 * It is inline at the head of the tile's flex row — in flow, never floating. An
 * earlier version was `absolute left-2 top-2`, a 44px opaque box drawn over the
 * title's first lines, so the card's most important text read through a
 * translucent checkbox; an overlay can always drift back over content, while a
 * flex item cannot overlap by construction.
 *
 * What changed is not its size but its existence. Painted unconditionally, it
 * claimed `size-8` plus a `gap-2` out of a 176–256px content box — 15–18% of
 * every tile, every moment — and its own 34px of top-aligned height set the
 * first line of every short title. All of that to arm a bulk bar that appears
 * only after a reader has already clicked something. In a mode it costs nothing
 * in the state that is true 100% of the time.
 *
 * It still `stopPropagation`s, because the label and the input both sit inside a
 * tile that is now itself a toggle: without it, one click on the box would
 * toggle twice and land where it started.
 */
function BoardCardSelect({ cardId, displayName, selected, onToggleSelection }: {
  cardId: string;
  displayName: string;
  selected: boolean;
  onToggleSelection?: (cardId: string) => void;
}) {
  return (
    <label
      className={
        "mt-0.5 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border transition "
        + (selected
          ? "border-primary/50 bg-primary/10"
          : "border-transparent hover:border-border hover:bg-muted/60")
      }
      onClick={(event) => event.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelection?.(cardId)}
        onClick={(event) => event.stopPropagation()}
        className="size-4 cursor-pointer accent-primary"
        aria-label={`Select ${displayName}`}
      />
    </label>
  );
}

/**
 * The scope/task strip under the heading. Progress only — the numbers live
 * with the scopes, and this never duplicates them elsewhere on the tile.
 */
function BoardCardProgress({ card }: { card: BoardCardItem }) {
  if (card.scopeSummary.scopesTotal === 0) return null;
  const title =
    `${card.scopeSummary.scopesDone} of ${card.scopeSummary.scopesTotal} scopes done · `
    + `${card.scopeSummary.tasksDone} of ${card.scopeSummary.tasksTotal} tasks done`
    + (card.scopeSummary.elapsedMs != null ? ` · ${formatDuration(card.scopeSummary.elapsedMs)} elapsed` : "");
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
      <ScopeStrip done={card.scopeSummary.scopesDone} total={card.scopeSummary.scopesTotal} />
      <span className="whitespace-nowrap text-muted-foreground" title={title}>
        ✓ {card.scopeSummary.scopesDone}/{card.scopeSummary.scopesTotal} scopes · {card.scopeSummary.tasksDone}/{card.scopeSummary.tasksTotal} tasks
        {card.scopeSummary.elapsedMs != null ? ` · ${formatDuration(card.scopeSummary.elapsedMs)} elapsed` : ""}
      </span>
    </div>
  );
}

export function LightweightTrackCard({ card, kind, tagLabel, tagTitle, ariaNoun, onOpen }: {
  card: BoardCardItem;
  kind: "research" | "explore";
  tagLabel: string | null;
  tagTitle: string;
  ariaNoun: string;
  onOpen: () => void;
}) {
  return (
    <CardShell card={card} ariaNoun={ariaNoun} onOpen={onOpen}>
      <CardHeading title={card.displayName} status={<ActivityPill activity={card.activity} detail={card.lastError} />} />
      {tagLabel ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          <LightweightStatusPills card={card} statusTone={statusTone} columnLabel={null} tagLabel={tagLabel} tagTitle={tagTitle} kind={kind} />
        </div>
      ) : null}
      <CardMetaRows card={card} />
      <CardResumeFooter card={card} />
    </CardShell>
  );
}

export function ResearchCard({ card, strategyLabel, onOpen }: { card: BoardCardItem; strategyLabel: string | null; onOpen: () => void }) {
  return (
    <LightweightTrackCard
      card={card}
      kind="research"
      tagLabel={strategyLabel}
      tagTitle="Research strategy — the playbook driving this investigation."
      ariaNoun="research"
      onOpen={onOpen}
    />
  );
}

export function ExploreCard({ card, stageLabel, onOpen }: { card: BoardCardItem; stageLabel: string | null; onOpen: () => void }) {
  return (
    <LightweightTrackCard
      card={card}
      kind="explore"
      tagLabel={stageLabel ?? card.exploreStage}
      tagTitle="Technique — the focused approach this exploration runs."
      ariaNoun="exploration"
      onOpen={onOpen}
    />
  );
}

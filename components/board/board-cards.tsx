import { Children, useCallback, useState, type MouseEvent, type ReactNode } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { INTENT_LABEL } from "@/components/detail/card-detail-route";
import { CardSelectRow } from "./card-select-row";
import { useReturnFocus } from "./use-return-focus";
import { ReasonPopover } from "../ui/reason-popover";
import { errorActivityLabel, idleDurationLabel, liveBorderClass, pausedActivityLabel, statusTone } from "../../lib/detail-presentation.mjs";
import { cardCanResume, cardNeedsReview } from "../../lib/card-attention.mjs";
import { formatDuration } from "../../lib/card-metrics.mjs";
import { orderedDoingNow } from "../../lib/doing-now.mjs";
import {
  ActivityPill,
  BuildStatusPills,
  DoingNowPill,
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
/**
 * The failure sentence the card's accessible description must carry, or null.
 *
 * Both card roots are `role="button"`, and that role makes descendants
 * presentational — so a chip's own text and its `title=` are removed from the
 * accessibility tree. Hover reaches a sighted pointer user and nothing else; a
 * screen-reader user would get the chip's existence and never the reason.
 */
function cardFailureSentence(card: BoardCardItem): string | null {
  const stopped = errorActivityLabel(card) ?? card.runFailure;
  return stopped ? `${stopped.label}: ${stopped.detail}` : null;
}

function CardAlertChips({ card, stopped, paused }: {
  card: BoardCardItem;
  stopped: { label: string; detail: string } | null;
  paused: { label: string; detail: string } | null;
}) {
  return (
    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
      {stopped ? <ReasonPopover label={stopped.label} detail={stopped.detail} /> : null}
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
  // ONE failure slot, TWO SOURCES: the worker thread's failure wins, and the
  // newest failed host run is the fallback. Collapsing them here is what makes
  // two red chips structurally impossible rather than merely forbidden by a
  // precedence rule — and the run failure is what a card whose worker is fine
  // but whose run died had no way to show.
  const stopped = errorActivityLabel(card) ?? card.runFailure;
  const paused = pausedActivityLabel(card);
  // ONE chip per state. A paused card used to wear two — `Paused` from
  // `pausedActivityLabel` and `Paused. Resume it.` from an amber attention
  // chip — because both were fed by the same `cardIsStalled` predicate and
  // neither knew the other had already said it. The pause chip survives
  // because it carries the recovery sentence on hover; the amber channel stays
  // on the border, which is the surface that still has something new to say
  // (see `liveBorderClass`).
  const showAlerts =
    card.runFailure != null ||
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
 * In select mode the tile is the toggle: it announces itself with `aria-pressed`,
 * it opens nothing, and its top line says so with a decorative mark
 * (`CardSelectRow`). That is deliberately different from the normal mode, where
 * the tile opens the card — the two actions used to share one target, which is
 * why the control that used to sit inside the tile had to `stopPropagation` on
 * every click and why selecting a card felt like fighting the tile.
 *
 * There is no checkbox. A `<input>` inside a tile that is itself a button is
 * nested interactive content, and it doubled the tab stops of a column; the mark
 * is `aria-hidden` and the state reaches assistive tech through the tile.
 *
 * `selectMode` arrives here already resolved: `BoardCard` computes the predicate
 * once (`selectMode === true && typeof onToggleSelection === "function"`) and
 * passes the RESULT. A shell that re-tested the callback would be a second
 * computation of the same question, free to disagree with the activation path it
 * also chooses from that answer. Every caller that does not pass it (the Bucket
 * and hill galleries, Research and Explore) reserves no space for a line it does
 * not have.
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
  const failureSentence = cardFailureSentence(card);
  const activate = selectMode ? toggleSelection : open;
  // `role="button"` makes descendants presentational, so the chip's own text and
  // its `title=` never reach a screen reader. The failure sentence rides the
  // root's label — the only channel that does.
  const label = selectMode
    ? `${selected ? "Deselect" : "Select"} ${card.displayName}.`
    : `Open ${ariaNoun} ${card.displayName}.${failureSentence ? ` ${failureSentence}` : ""}`;
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
        ? selected ? "Click to remove this card from the selection" : "Click to add this card to the selection"
        : card.workerThreadId ? "Click to inspect · W opens the worker thread" : "Click to inspect"}
      className={`${BOARD_CARD_CLASS} ${liveBorderClass(card) || "border-border hover:border-primary/60"}${selected ? " ring-1 ring-primary" : ""}`}
      aria-label={label}
      aria-pressed={selectMode ? Boolean(selected) : undefined}
    >
      {selectMode ? <CardSelectRow selected={Boolean(selected)} /> : null}
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
      <div className="flex min-w-0 items-start">
        <div className="min-w-0 flex-1">
          <CardHeading
            title={card.displayName}
            status={<BuildStatusPills card={card} statusTone={statusTone} intentLabel={(intent: string) => INTENT_LABEL[intent]} />}
          />
          <BoardCardProgress card={card} />
          <CardMetaRows card={card} />
        </div>
      </div>
      {/* The mode's premise is one control per card, and its promise is one tab
          stop each. A stalled card's Retry is a real second button inside the
          tile, so it stands down while the reader is selecting — the exit is
          leaving the mode, and the card keeps its state either way. */}
      {selecting ? null : <CardResumeFooter card={card} />}
    </CardShell>
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

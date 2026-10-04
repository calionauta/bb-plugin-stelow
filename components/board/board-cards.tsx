import { Children, useCallback, useState, type MouseEvent, type ReactNode } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { INTENT_LABEL } from "@/components/detail/card-detail-route";
import { useReturnFocus } from "./use-return-focus";
import { EditParkedSheet } from "./edit-parked-sheet";
import { errorActivityLabel, liveBorderClass, pausedActivityLabel, statusTone } from "../../lib/detail-presentation.mjs";
import { cardCanResume, cardNeedsReview, cardShowsAttention } from "../../lib/card-attention.mjs";
import { formatDuration } from "../../lib/card-metrics.mjs";
import { orderedDoingNow } from "../../lib/doing-now.mjs";
import {
  ActivityPill,
  AttentionChip,
  BuildStatusPills,
  DoingNowPill,
  ErrorChip,
  IntegrationPendingChip,
  PausedChip,
  LightweightStatusPills,
  ReviewChip,
  ScopeStrip,
  attentionLabel,
} from "../dashboard/build-status-pills";
import type { rpcContract } from "../../server";

type RpcResult = Awaited<ReturnType<ReturnType<typeof useRpc<typeof rpcContract>>["call"]>>;
export type BoardCardItem = Extract<RpcResult, { cards: unknown }>["cards"][number];

const BOARD_CARD_CLASS =
  "stelow-live-surface stelow-board-card relative block w-full cursor-pointer overflow-hidden "
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

export function CardMetaRows({ card }: { card: BoardCardItem }) {
  const stopped = errorActivityLabel(card);
  const paused = pausedActivityLabel(card);
  return (
    <>
      <div className="mt-1 truncate text-[11px] text-muted-foreground" title={`Project: ${card.projectName}`}>
        {card.projectName}
      </div>
      {stopped ? (
        <div className="mt-2"><ErrorChip label={stopped.label} detail={stopped.detail} /></div>
      ) : null}
      {paused ? (
        <div className="mt-2"><PausedChip label={paused.label} detail={paused.detail} /></div>
      ) : null}
      {cardShowsAttention(card) ? (
        <div className="mt-2"><AttentionChip label={attentionLabel(card.activity)} /></div>
      ) : null}
      {card.integrationPending ? (
        <div className="mt-2">
          <IntegrationPendingChip
            label={card.integrationPending.label}
            detail={card.integrationPending.detail}
          />
        </div>
      ) : null}
      {card.activity === "running" || card.activity === "awaiting-answer" ? (
        <div className="mt-2 max-w-full"><DoingNowPill names={orderedDoingNow(card.executingScope, card.doingNow)} /></div>
      ) : null}
      {cardNeedsReview(card) ? (
        <div className="mt-2"><ReviewChip /></div>
      ) : null}
      {card.activity === "idle" ? (
        <div className="mt-1 text-[10px] text-muted-foreground">Idle since {new Date(card.updatedAt).toLocaleString()}</div>
      ) : null}
    </>
  );
}

export function CardHeading({ title, status, action }: { title: string; status: ReactNode; action?: ReactNode }) {
  const statusItems = Children.toArray(status);
  return (
    <header className="min-w-0 space-y-2.5">
      <h3 className="min-w-0 break-all text-sm font-semibold leading-5 text-foreground">{title}</h3>
      {statusItems.length ? <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">{statusItems}</div> : null}
      {action ? <div className="border-t border-border/70 pt-2">{action}</div> : null}
    </header>
  );
}

type BoardCardProps = {
  card: BoardCardItem;
  onOpen: () => void;
  selected?: boolean;
  onToggleSelection?: (cardId: string) => void;
};

export function BoardCard({ card, onOpen, selected, onToggleSelection }: BoardCardProps) {
  const navigate = useBbNavigate();
  const returnFocusRef = useReturnFocus<HTMLDivElement>(card.id);
  const [editing, setEditing] = useState(false);
  const open = useCallback(() => onOpen(), [onOpen]);
  const openThread = useCallback(() => {
    if (card.workerThreadId) navigate.toThread(card.workerThreadId);
  }, [navigate, card.workerThreadId]);
  const canEdit = !card.workerThreadId && (card.status === "draft" || card.status === "pending");
  const showCheckbox = typeof onToggleSelection === "function";
  return (
    <div
      role="button"
      tabIndex={0}
      ref={returnFocusRef}
      draggable
      onDragStart={(event) => { event.dataTransfer.setData("text/stelow-card", card.id); event.dataTransfer.effectAllowed = "move"; }}
      onClick={open}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); }
        else if (event.key === "w" || event.key === "W") { event.preventDefault(); openThread(); }
      }}
      title={card.workerThreadId ? "Click to inspect · W opens the worker thread" : "Click to inspect"}
      className={`${BOARD_CARD_CLASS} ${liveBorderClass(card) || "border-border hover:border-primary/60"} ${selected ? "ring-1 ring-primary" : ""}`}
      aria-label={`Open card ${card.displayName}.`}
    >
      {showCheckbox ? (
        <BoardCardSelect
          cardId={card.id}
          displayName={card.displayName}
          selected={Boolean(selected)}
          onToggleSelection={onToggleSelection}
        />
      ) : null}
      <CardHeading
        title={card.displayName}
        action={<BoardCardActions card={card} canEdit={canEdit} onEdit={() => setEditing(true)} />}
        status={<BuildStatusPills card={card} statusTone={statusTone} intentLabel={(intent: string) => INTENT_LABEL[intent]} />}
      />
      <BoardCardProgress card={card} />
      <CardMetaRows card={card} />
      <BoardCardEditSheet card={card} editing={editing} onClose={() => setEditing(false)} />
    </div>
  );
}

/**
 * The parked-edit sheet, mounted only while editing. The card mapping lives
 * here so the tile passes its card once and the sheet contract stays in one
 * place — a second mapping elsewhere would drift from this one.
 */
function BoardCardEditSheet({ card, editing, onClose }: {
  card: BoardCardItem;
  editing: boolean;
  onClose: () => void;
}) {
  if (!editing) return null;
  return (
    <EditParkedSheet
      card={{
        id: card.id,
        displayName: card.displayName,
        prompt: card.prompt,
        projectId: card.projectId,
        status: card.status,
        workerThreadId: card.workerThreadId,
      }}
      open={editing}
      onClose={onClose}
      onSaved={onClose}
    />
  );
}

/**
 * The multi-select checkbox, floating over the tile. Split out because it is
 * the bulk-selection concern on a tile that otherwise only opens the card —
 * and because the label must stop propagation so checking never opens.
 */
function BoardCardSelect({ cardId, displayName, selected, onToggleSelection }: {
  cardId: string;
  displayName: string;
  selected: boolean;
  onToggleSelection?: (cardId: string) => void;
}) {
  return (
    <label
      className="absolute left-2 top-2 flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md bg-background/90"
      onClick={(event) => event.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelection?.(cardId)}
        className="h-4 w-4 cursor-pointer"
        aria-label={`Select ${displayName}`}
      />
    </label>
  );
}

/**
 * The edit/resume row on a parked tile. Gated to draft/pending without a
 * worker — the sheet itself re-checks, so a stale tile cannot save.
 */
function BoardCardActions({ card, canEdit, onEdit }: {
  card: BoardCardItem;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const retry = cardCanResume(card) && card.activity !== "error" ? (
    <CardRetryButton cardId={card.id} label="Resume work" />
  ) : null;
  return (
    <div className="flex gap-2">
      {canEdit ? (
        <Button
          variant="outline"
          size="sm"
          onClick={(event) => { event.stopPropagation(); onEdit(); }}
          className="min-h-11 cursor-pointer"
        >
          Edit
        </Button>
      ) : null}
      {retry}
    </div>
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
  const navigate = useBbNavigate();
  const returnFocusRef = useReturnFocus<HTMLDivElement>(card.id);
  const open = useCallback(() => onOpen(), [onOpen]);
  const openThread = useCallback(() => {
    if (card.workerThreadId) navigate.toThread(card.workerThreadId);
  }, [navigate, card.workerThreadId]);
  const retry = cardCanResume(card) && card.activity !== "error" ? (
    <CardRetryButton cardId={card.id} label="Resume work" />
  ) : null;
  return (
    <div
      role="button"
      tabIndex={0}
      ref={returnFocusRef}
      draggable
      onDragStart={(event) => { event.dataTransfer.setData("text/stelow-card", card.id); event.dataTransfer.effectAllowed = "move"; }}
      onClick={open}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); }
        else if (event.key === "w" || event.key === "W") { event.preventDefault(); openThread(); }
      }}
      title={card.workerThreadId ? "Click to inspect · W opens the worker thread" : "Click to inspect"}
      className={`${BOARD_CARD_CLASS} ${liveBorderClass(card) || "border-border hover:border-primary/60"}`}
      aria-label={`Open ${ariaNoun} ${card.displayName}.`}
    >
      <CardHeading title={card.displayName} action={retry} status={<ActivityPill activity={card.activity} detail={card.lastError} />} />
      {tagLabel ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          <LightweightStatusPills card={card} statusTone={statusTone} columnLabel={null} tagLabel={tagLabel} tagTitle={tagTitle} kind={kind} />
        </div>
      ) : null}
      <CardMetaRows card={card} />
    </div>
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

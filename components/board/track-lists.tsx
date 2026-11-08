import { DisclosureChevron } from "../disclosure";
import { selectionMarkClass } from "./selection-mark";
import { formatDuration } from "../../lib/card-metrics.mjs";
import { relativeTime } from "../../lib/relative-time.mjs";
import { orderedDoingNow } from "../../lib/doing-now.mjs";
import {
  ActivityPill,
  IntegrationPendingChip,
  DoingNowPill,
  ErrorChip,
  PausedChip,
  ReviewChip,
  ScopeStrip,
} from "../dashboard/build-status-pills";
import {
  buildListMeta,
  pendingReview,
  showScopeStrip,
} from "../../lib/board-list-presentation.mjs";
import {
  BUILD_BOARD_COLUMN_LABELS,
  BUILD_BOARD_VISIBLE_COLUMNS,
} from "../../lib/workflow-vocabulary.mjs";
import {
  LIGHTWEIGHT_COLUMN_LABELS,
  LIGHTWEIGHT_VISIBLE_COLUMNS,
} from "../../lib/tracks.mjs";
import { useReturnFocus } from "./use-return-focus";
import { errorActivityLabel, idleDurationLabel, pausedActivityLabel } from "../../lib/detail-presentation.mjs";

type ScopeSummary = {
  scopesDone: number;
  scopesTotal: number;
  tasksDone: number;
  tasksTotal: number;
  elapsedMs?: number | null;
};

export type ListCard = {
  id: string;
  kind: "build" | "research" | "explore";
  displayName: string;
  projectName: string;
  status: string;
  stage: string;
  activity: string;
  needsAttention: boolean;
  hasPendingReview: boolean;
  /** What a finished card still owes its repository, or null. */
  integrationPending?: { state: string; label: string; detail: string } | null;
  workerThreadId?: string | null;
  doingNow?: string[] | null;
  executingScope?: string | null;
  scopeSummary: ScopeSummary;
  updatedAt: number;
  researchStrategies?: string[] | null;
  exploreStage?: string | null;
};

/**
 * The board's selection mode, threaded through the list view.
 *
 * Optional on purpose: Research and Explore render the same rows without it, so
 * a track that has no bulk action reserves no space for one. When it is absent
 * the row opens the card, exactly as before.
 */
type ListSelection = {
  selectMode: boolean;
  selectedIds: Set<string>;
  onToggleSelection: (cardId: string) => void;
};

type ListProps = {
  groups: Record<string, ListCard[]>;
  collapsed: Record<string, boolean>;
  onToggle: (column: string) => void;
  onOpenCard: (card: ListCard) => void;
  onOpenThread: (threadId: string) => void;
  selection?: ListSelection;
};

const BUILD_COLUMNS = BUILD_BOARD_VISIBLE_COLUMNS as readonly string[];
const BUILD_LABELS: Record<string, string> = BUILD_BOARD_COLUMN_LABELS;
const LIGHTWEIGHT_COLUMNS = LIGHTWEIGHT_VISIBLE_COLUMNS as readonly string[];
const LIGHTWEIGHT_LABELS: Record<string, string> = LIGHTWEIGHT_COLUMN_LABELS;

function openWorkerThread(
  event: React.KeyboardEvent<HTMLButtonElement>,
  card: ListCard,
  onOpenThread: (threadId: string) => void,
) {
  if (event.target !== event.currentTarget) return;
  if (event.key !== "w" && event.key !== "W") return;
  event.preventDefault();
  if (card.workerThreadId) onOpenThread(card.workerThreadId);
}

/**
 * The status chips a list row carries on its right-hand side. Split out of the
 * row so adding a chip is a change here rather than another branch inside a
 * render function that is already at its size budget.
 */
function ListRowStatus({ card }: { card: ListCard }) {
  const stopped = errorActivityLabel(card);
  const paused = pausedActivityLabel(card);
  const idleFor = idleDurationLabel(card);
  // The exact instant, on hover only. The visible stamp is relative — `3d ago`,
  // or the stall's own duration when there is one — because a locale timestamp
  // is the widest thing a row can carry and the least useful thing on it.
  const exactUpdated = Number.isFinite(card.updatedAt)
    ? new Date(card.updatedAt).toLocaleString()
    : "unknown";
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      {/* One chip per state. `ActivityPill` says `Paused` for every idle card;
          `PausedChip` says it only for a stall a person can clear. Rendering
          both, plus the amber attention chip, was the same fact three times on
          one row — and the row is where space is scarcest. */}
      {paused ? null : <ActivityPill activity={card.activity} />}
      {stopped ? <ErrorChip label={stopped.label} detail={stopped.detail} /> : null}
      {paused ? <PausedChip label={paused.label} detail={paused.detail} /> : null}
      {card.integrationPending ? (
        <IntegrationPendingChip
          label={card.integrationPending.label}
          detail={card.integrationPending.detail}
        />
      ) : null}
      {showDoingNow(card) ? <DoingNowPill names={orderedDoingNow(card.executingScope, card.doingNow)} /> : null}
      {pendingReview(card) ? <ReviewChip /> : null}
      <span className="shrink-0 whitespace-nowrap" title={exactUpdated}>
        {idleFor ?? relativeTime(card.updatedAt)}
      </span>
    </span>
  );
}

function TrackListRow({ card, meta, onOpen, onOpenThread, selection }: {
  card: ListCard;
  meta: string | null;
  onOpen: () => void;
  onOpenThread: (threadId: string) => void;
  selection?: ListSelection;
}) {
  const returnFocusRef = useReturnFocus<HTMLButtonElement>(card.id);
  const selecting = selection?.selectMode === true;
  const selected = selecting && selection.selectedIds.has(card.id);
  const activate = selecting ? () => selection.onToggleSelection(card.id) : onOpen;
  return (
    <button
      ref={returnFocusRef}
      type="button"
      onClick={activate}
      onKeyDown={(event) => {
        if (selecting) return;
        openWorkerThread(event, card, onOpenThread);
      }}
      {...rowAffordance(card, selecting, selected)}
      className={[
        "flex min-h-11 w-full cursor-pointer flex-col items-stretch gap-1.5 border-b p-3 text-left",
        "last:border-b-0 hover:bg-muted/50 focus-visible:outline focus-visible:outline-2",
        "focus-visible:outline-primary sm:flex-row sm:items-center sm:gap-3",
        selected ? "bg-primary/5" : "",
      ].join(" ")}
    >
      <span className="flex min-w-0 flex-1 items-start gap-2">
        {selecting ? (
          // The same mark the board's tile line renders, imported rather than
          // re-spelled: two surfaces describing one selection state must not be
          // able to drift apart. `mt-1` is this row's own alignment, not the
          // token's business.
          <span aria-hidden className={`${selectionMarkClass(selected)} mt-1`} />
        ) : null}
        <span className={rowTone(card)} />
        <ListRowIdentity card={card} meta={meta} />
      </span>
      <ListRowStatus card={card} />
    </button>
  );
}

/**
 * What the row says about itself in each mode.
 *
 * In select mode a row is the toggle: it names the action it will perform —
 * `Select` or `Deselect`, which are not the same sentence — and announces itself
 * as pressed. It carries no mark of its own beyond the shared one, because the
 * row IS the control here, exactly as the tile is on the board. Outside the mode a
 * row opens the card and `W` opens the worker thread; W is refused inside the
 * mode, matching the kanban tile, where it would navigate away from a selection
 * the reader is building.
 */
function rowAffordance(card: ListCard, selecting: boolean, selected: boolean) {
  return {
    title: selecting
      ? selected ? "Remove this card from the selection" : "Add this card to the selection"
      : card.workerThreadId ? "Open card · W opens the worker thread" : "Open card",
    "aria-label": selecting
      ? `${selected ? "Deselect" : "Select"} card ${card.displayName}.`
      : `Open card ${card.displayName}.`,
    "aria-pressed": selecting ? selected : undefined,
  };
}

/**
 * What the row is about: its name, then one muted context line.
 *
 * The context line carries the project, the track's own meta, and - only when the
 * card has scopes - the progress strip with its elapsed time. It is its own
 * component because the row around it keeps growing branches (selection, status
 * chips, keyboard) and this half never changes with them.
 */
function ListRowIdentity({ card, meta }: { card: ListCard; meta: string | null }) {
  return (
    <span className="min-w-0 flex-1">
      <strong className="block break-words text-sm leading-5">{card.displayName}</strong>
      <span className="mt-0.5 block break-words text-xs leading-5 text-muted-foreground">
        {card.projectName}{meta ? ` · ${meta}` : ""}
        {showScopeStrip(card) ? (
          <>
            {" · "}
            <ScopeStrip done={card.scopeSummary.scopesDone} total={card.scopeSummary.scopesTotal} />
            {card.scopeSummary.elapsedMs != null ? ` · ${formatDuration(card.scopeSummary.elapsedMs)} elapsed` : ""}
          </>
        ) : null}
      </span>
    </span>
  );
}

function rowTone(card: ListCard): string {
  // An error outranks everything, including an owed integration: a stopped
  // card and a card with work to integrate are different urgencies, and only
  // one of them is broken.
  if (card.activity === "error") return "mt-1 size-2 shrink-0 rounded-full bg-destructive";
  // An owed integration is a reason to look at this row, so it takes the
  // attention tone over a completed card's calm emerald.
  if (card.integrationPending) return "mt-1 size-2 shrink-0 rounded-full bg-amber-500";
  if (card.needsAttention) return "mt-1 size-2 shrink-0 rounded-full bg-amber-500";
  if (pendingReview(card)) return "mt-1 size-2 shrink-0 rounded-full bg-emerald-500";
  if (card.activity === "running") return "mt-1 size-2 shrink-0 rounded-full bg-primary";
  return "mt-1 size-2 shrink-0 rounded-full bg-muted-foreground/40";
}

function showDoingNow(card: ListCard): boolean {
  return (card.activity === "running" || card.activity === "awaiting-answer")
    && (card.doingNow?.length ?? 0) > 0;
}

function TrackGroupList({ groups, collapsed, onToggle, columns, labels, metaFor, onOpenCard, onOpenThread, selection }: {
  groups: Record<string, ListCard[]>;
  collapsed: Record<string, boolean>;
  onToggle: (column: string) => void;
  columns: readonly string[];
  labels: Record<string, string>;
  metaFor: (card: ListCard) => string | null;
  onOpenCard: (card: ListCard) => void;
  onOpenThread: (threadId: string) => void;
  selection?: ListSelection;
}) {
  return (
    <div className="space-y-5">
      {columns.map((column) => {
        const cards = groups[column] ?? [];
        if (cards.length === 0) return null;
        return (
          <ListGroup
            key={column}
            column={column}
            label={labels[column] ?? column}
            cards={cards}
            collapsed={collapsed[column] === true}
            metaFor={metaFor}
            onToggle={onToggle}
            onOpenCard={onOpenCard}
            onOpenThread={onOpenThread}
            selection={selection}
          />
        );
      })}
    </div>
  );
}

function ListGroup({ column, label, cards, collapsed, metaFor, onToggle, onOpenCard, onOpenThread, selection }: {
  column: string;
  label: string;
  cards: ListCard[];
  collapsed: boolean;
  metaFor: (card: ListCard) => string | null;
  onToggle: (column: string) => void;
  onOpenCard: (card: ListCard) => void;
  onOpenThread: (threadId: string) => void;
  selection?: ListSelection;
}) {
  const action = collapsed ? `Expand ${label}` : `Collapse ${label}`;
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onToggle(column)}
          aria-expanded={!collapsed}
          aria-label={action}
          title={action}
          className={[
            "flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-sm font-semibold",
            "hover:bg-foreground/5 hover:text-foreground focus-visible:outline",
            "focus-visible:outline-2 focus-visible:outline-primary",
          ].join(" ")}
        >
          <DisclosureChevron open={!collapsed} className="text-foreground/60" />
          {label}
        </button>
        <span className="text-xs text-muted-foreground">{cards.length}</span>
      </div>
      {!collapsed ? (
        <div className="overflow-hidden rounded-md border">
          {cards.map((card) => (
            <TrackListRow
              key={card.id}
              card={card}
              meta={metaFor(card)}
              onOpen={() => onOpenCard(card)}
              onOpenThread={onOpenThread}
              selection={selection}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function BuildList(props: ListProps) {
  return (
    <TrackGroupList
      {...props}
      columns={BUILD_COLUMNS}
      labels={BUILD_LABELS}
      metaFor={(card) => buildListMeta(card)}
    />
  );
}

export function TrackList({ metaFor, ...props }: ListProps & {
  metaFor: (card: ListCard) => string | null;
}) {
  const columns = (props as { columns?: readonly string[] }).columns as readonly string[] | undefined;
  const labels = (props as { labels?: Record<string, string> }).labels as Record<string, string> | undefined;
  return (
    <TrackGroupList
      groups={props.groups}
      collapsed={props.collapsed}
      onToggle={props.onToggle}
      onOpenCard={props.onOpenCard}
      onOpenThread={props.onOpenThread}
      selection={props.selection}
      columns={columns ?? LIGHTWEIGHT_COLUMNS}
      labels={labels ?? LIGHTWEIGHT_LABELS}
      metaFor={metaFor}
    />
  );
}

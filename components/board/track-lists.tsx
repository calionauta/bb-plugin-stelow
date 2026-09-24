import { DisclosureChevron } from "../disclosure";
import {
  ActivityPill,
  AttentionChip,
  DoingNowPill,
  ReviewChip,
  ScopeStrip,
  attentionLabel,
} from "../dashboard/build-status-pills";
import {
  buildListMeta,
  exploreListMeta,
  pendingReview,
  researchListMeta,
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

type ScopeSummary = {
  scopesDone: number;
  scopesTotal: number;
  tasksDone: number;
  tasksTotal: number;
};

type ListCard = {
  id: string;
  kind: "build" | "research" | "explore";
  displayName: string;
  projectName: string;
  status: string;
  stage: string;
  activity: string;
  needsAttention: boolean;
  hasPendingReview: boolean;
  workerThreadId?: string | null;
  doingNow?: string[] | null;
  scopeSummary: ScopeSummary;
  updatedAt: number;
  researchStrategies?: string[] | null;
  exploreStage?: string | null;
};

type ListProps = {
  groups: Record<string, ListCard[]>;
  collapsed: Record<string, boolean>;
  onToggle: (column: string) => void;
  onOpenCard: (card: ListCard) => void;
  onOpenThread: (threadId: string) => void;
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

function TrackListRow({ card, meta, onOpen, onOpenThread }: {
  card: ListCard;
  meta: string | null;
  onOpen: () => void;
  onOpenThread: (threadId: string) => void;
}) {
  const returnFocusRef = useReturnFocus<HTMLButtonElement>(card.id);
  return (
    <button
      ref={returnFocusRef}
      type="button"
      onClick={onOpen}
      onKeyDown={(event) => openWorkerThread(event, card, onOpenThread)}
      title={card.workerThreadId ? "Open card · W opens the worker thread" : "Open card"}
      aria-label={`Open card ${card.displayName}.`}
      className={[
        "flex min-h-11 w-full cursor-pointer flex-col items-stretch gap-1.5 border-b p-3 text-left",
        "last:border-b-0 hover:bg-muted/50 focus-visible:outline focus-visible:outline-2",
        "focus-visible:outline-primary sm:flex-row sm:items-center sm:gap-3",
      ].join(" ")}
    >
      <span className="flex min-w-0 flex-1 items-start gap-2">
        <span className={rowTone(card)} />
        <span className="min-w-0 flex-1">
          <strong className="block break-words text-sm leading-5">{card.displayName}</strong>
          <span className="mt-0.5 block break-words text-xs leading-5 text-muted-foreground">
            {card.projectName}{meta ? ` · ${meta}` : ""}
            {showScopeStrip(card) ? (
              <> · <ScopeStrip done={card.scopeSummary.scopesDone} total={card.scopeSummary.scopesTotal} /></>
            ) : null}
          </span>
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <ActivityPill activity={card.activity} />
        {showAttention(card) ? <AttentionChip label={attentionLabel(card.activity)} /> : null}
        {showDoingNow(card) ? <DoingNowPill names={card.doingNow ?? []} /> : null}
        {pendingReview(card) ? <ReviewChip /> : null}
        <span className="whitespace-nowrap">{new Date(card.updatedAt).toLocaleString()}</span>
      </span>
    </button>
  );
}

function rowTone(card: ListCard): string {
  if (card.needsAttention) return "mt-1 size-2 shrink-0 rounded-full bg-amber-500";
  if (pendingReview(card)) return "mt-1 size-2 shrink-0 rounded-full bg-emerald-500";
  if (card.activity === "running") return "mt-1 size-2 shrink-0 rounded-full bg-primary";
  return "mt-1 size-2 shrink-0 rounded-full bg-muted-foreground/40";
}

function showAttention(card: ListCard): boolean {
  return card.needsAttention && !["awaiting-answer", "error"].includes(card.activity);
}

function showDoingNow(card: ListCard): boolean {
  return (card.activity === "running" || card.activity === "awaiting-answer")
    && (card.doingNow?.length ?? 0) > 0;
}

function TrackGroupList({ groups, collapsed, onToggle, columns, labels, metaFor, onOpenCard, onOpenThread }: {
  groups: Record<string, ListCard[]>;
  collapsed: Record<string, boolean>;
  onToggle: (column: string) => void;
  columns: readonly string[];
  labels: Record<string, string>;
  metaFor: (card: ListCard) => string | null;
  onOpenCard: (card: ListCard) => void;
  onOpenThread: (threadId: string) => void;
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
          />
        );
      })}
    </div>
  );
}

function ListGroup({ column, label, cards, collapsed, metaFor, onToggle, onOpenCard, onOpenThread }: {
  column: string;
  label: string;
  cards: ListCard[];
  collapsed: boolean;
  metaFor: (card: ListCard) => string | null;
  onToggle: (column: string) => void;
  onOpenCard: (card: ListCard) => void;
  onOpenThread: (threadId: string) => void;
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

type LightweightListProps = Omit<ListProps, "groups"> & {
  groups: Record<string, ListCard[]>;
};

export function ResearchList({ strategyLabelById, ...props }: LightweightListProps & {
  strategyLabelById: ReadonlyMap<string, string>;
}) {
  return (
    <TrackGroupList
      {...props}
      columns={LIGHTWEIGHT_COLUMNS}
      labels={LIGHTWEIGHT_LABELS}
      metaFor={(card) => researchListMeta(card, strategyLabelById)}
    />
  );
}

export function ExploreList({ stageLabelById, ...props }: LightweightListProps & {
  stageLabelById: ReadonlyMap<string, string>;
}) {
  return (
    <TrackGroupList
      {...props}
      columns={LIGHTWEIGHT_COLUMNS}
      labels={LIGHTWEIGHT_LABELS}
      metaFor={(card) => exploreListMeta(card, stageLabelById)}
    />
  );
}

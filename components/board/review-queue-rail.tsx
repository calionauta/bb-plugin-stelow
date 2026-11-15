import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { TEXT_META } from "../../lib/design-tokens";
import {
  REVIEW_QUEUE_AGE_LEGEND,
  REVIEW_QUEUE_GATES,
  REVIEW_QUEUE_RAIL_STYLE,
  REVIEW_QUEUE_ROW_PX,
  queueAgeCell,
} from "../../lib/review-queue.mjs";
import type {
  ReviewQueueBadge,
  ReviewQueueRow,
} from "../../lib/review-queue.mjs";
import { Button } from "../ui/button";

type RailProps = {
  id: string;
  open: boolean;
  rows: ReviewQueueRow[];
  badge: ReviewQueueBadge;
  nowMs: number;
  checking: boolean;
  ledgerOk: boolean;
  onRetry: () => void;
  onClose: () => void;
  onOpenCard: (cardId: string) => void;
};

const ROW_CLASS = "h-auto w-full justify-start gap-2 whitespace-normal px-1 py-1 text-left font-normal";

/**
 * The rail: a fixed reading surface beside the board.
 *
 * It is a region, not a dialog. Nothing here traps focus, dims the board or
 * blocks a click, because the queue is read beside the work rather than instead
 * of it — a reader comparing a row against a column must be able to touch the
 * column.
 */
export function ReviewQueueRail(props: RailProps) {
  const { id, open, rows, badge, nowMs, checking, ledgerOk, onRetry, onClose, onOpenCard } = props;
  const roving = useRovingRows(rows, onClose, open);

  if (!open) return null;

  return (
    <aside
      id={id}
      role="region"
      aria-label="Review queue"
      tabIndex={-1}
      data-review-queue-rail
      style={REVIEW_QUEUE_RAIL_STYLE}
      className="flex flex-col gap-2 overflow-y-auto border-l border-border bg-card p-3 shadow-lg"
      onKeyDown={roving.onKeyDown}
    >
      <RailHeader rows={rows} badge={badge} onClose={onClose} />
      <AgeLegend />
      {checking ? (
        <p className={TEXT_META} data-review-queue-checking>
          Checking what is waiting…
        </p>
      ) : null}
      {checking ? null : (
        <RailRows rows={rows} nowMs={nowMs} ledgerOk={ledgerOk} roving={roving} onOpenCard={onOpenCard} />
      )}
      {checking ? null : <GateFailures ledgerOk={ledgerOk} onRetry={onRetry} />}
    </aside>
  );
}

/**
 * Roving tab index: the list is one tab stop, arrows walk it.
 *
 * Escape closes only from inside the panel. `board-filters` already owns the one
 * document-level Escape on this screen, and a second one would fight it.
 */
function useRovingRows(rows: ReviewQueueRow[], onClose: () => void, open: boolean) {
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const active = Math.min(activeIndex, Math.max(0, rows.length - 1));

  // Opening lands on the oldest row, so the arrows work without a Tab first and
  // Escape lands somewhere inside the panel. Pointer and keyboard open alike: the
  // panel appears, and the panel is where the reading happens.
  useEffect(() => {
    if (open) rowRefs.current[0]?.focus();
  }, [open, rows.length]);

  function focusRow(index: number) {
    setActiveIndex(index);
    rowRefs.current[index]?.focus();
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (rows.length === 0) return;
    const moves: Record<string, number> = {
      ArrowDown: Math.min(active + 1, rows.length - 1),
      ArrowUp: Math.max(active - 1, 0),
      Home: 0,
      End: rows.length - 1,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    focusRow(next);
  }

  return { active, rowRefs, onKeyDown };
}

type Roving = ReturnType<typeof useRovingRows>;

function RailHeader({
  rows,
  badge,
  onClose,
}: {
  rows: ReviewQueueRow[];
  badge: ReviewQueueBadge;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Review queue</h2>
        <p className={TEXT_META} data-review-queue-count>
          {rows.length === 1 ? "1 card in a gate" : `${rows.length} cards in gates`}
          {badge.oldest === null ? "" : ` · oldest ${badge.oldest}`}
        </p>
        {/* Named, not hidden and not counted: the badge says how many are the
            reader's, and this says how many are in a gate with nobody on them.
            Without it the list and the number would disagree with no reason
            given, which reads as a bug rather than as a fact about the board. */}
        {badge.unowned > 0 ? (
          <p className={TEXT_META} data-review-queue-unowned>
            {`+${badge.unowned} without an owner`}
          </p>
        ) : null}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="min-h-11 shrink-0"
        onClick={onClose}
      >
        Close
      </Button>
    </div>
  );
}

/** The three age states, in the reader's words. Visible in every state of the rail. */
function AgeLegend() {
  return (
    <dl data-review-queue-legend className={`flex flex-col gap-0.5 ${TEXT_META}`}>
      {REVIEW_QUEUE_AGE_LEGEND.map((entry) => (
        <div key={entry.cell} className="flex gap-1.5">
          <dt className="w-6 shrink-0 text-right font-mono tabular-nums">{entry.cell}</dt>
          <dd className="min-w-0">{entry.meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

type RowsProps = {
  rows: ReviewQueueRow[];
  nowMs: number;
  ledgerOk: boolean;
  roving: Roving;
  onOpenCard: (cardId: string) => void;
};

function RailRows({ rows, nowMs, ledgerOk, roving, onOpenCard }: RowsProps) {
  if (rows.length === 0 && ledgerOk) {
    return (
      <p className={TEXT_META} data-review-queue-empty>
        Nothing is waiting on you.
      </p>
    );
  }
  return (
    <ul role="list" className="flex flex-col">
      {rows.map((row, index) => (
        <li key={row.id} role="listitem">
          <Button
            ref={(element) => {
              roving.rowRefs.current[index] = element;
            }}
            type="button"
            variant="ghost"
            size="sm"
            className={ROW_CLASS}
            style={{ minHeight: REVIEW_QUEUE_ROW_PX }}
            tabIndex={index === roving.active ? 0 : -1}
            aria-label={`${row.name}, ${row.gate}, waiting ${queueAgeCell(row, nowMs)}`}
            data-review-queue-row={row.id}
            data-waiting-on={row.waitingOn}
            data-age-source={row.ageSource}
            onClick={() => onOpenCard(row.id)}
          >
            <span className="min-w-0 flex-1 truncate text-foreground">{row.name}</span>
            <span className="shrink-0 text-muted-foreground">{row.gate}</span>
            {/* `min-w-8`, not `w-8`: the cell is a number most of the time and a
                phrase (`no owner named`) the rest of it, and a fixed two rems
                wrapped the phrase into three lines. */}
            <span className="min-w-8 shrink-0 whitespace-nowrap text-right font-mono tabular-nums text-muted-foreground">
              {queueAgeCell(row, nowMs)}
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );
}

/**
 * What could not be checked, per gate, with a retry that re-issues the read.
 *
 * A failed read is never an empty queue: the rows that came from the board are
 * still here and still carry their gate ages, because the clock comes from the
 * card. What the failure took is the ownership, so that is what this line says
 * was not checked. Silence would be a lie with the shape of good news.
 */
function GateFailures({ ledgerOk, onRetry }: { ledgerOk: boolean; onRetry: () => void }) {
  if (ledgerOk) return null;
  return (
    <div className="flex flex-col gap-1">
      {REVIEW_QUEUE_GATES.map((gate) => (
        <p
          key={gate.id}
          data-review-queue-failure={gate.id}
          className={`flex items-center gap-2 ${TEXT_META}`}
        >
          <span className="min-w-0">could not check {gate.label}</span>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto min-h-11 shrink-0 p-0"
            onClick={onRetry}
          >
            Retry
          </Button>
        </p>
      ))}
    </div>
  );
}

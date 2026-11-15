import { useCallback, useRef, useState } from "react";
import {
  REVIEW_QUEUE_AGE_LEGEND,
  REVIEW_QUEUE_RAIL_STYLE,
  REVIEW_QUEUE_ROW_PX,
  queueAgeCell,
  type ReviewQueueBadge,
  type ReviewQueueGateRead,
  type ReviewQueueRow,
} from "../../lib/review-queue.mjs";

/**
 * The review queue rail: what is waiting on you, in the order you should take it.
 *
 * It is a rail rather than a drawer because it is gone in one move and it does
 * not interrupt: no backdrop, no focus trap, no `role="dialog"` — a reader can
 * keep working beside it, and the board underneath is unchanged while it is open
 * (it is `fixed` and out of flow, so no column loses a pixel and the board's own
 * horizontal scroll position survives opening and closing).
 *
 * The row is 44px and the rail 280px, both from `lib/review-queue.mjs`, because
 * the numbers are a promise about how much board this covers, not a style choice
 * to be re-tuned in a class string.
 *
 * Keyboard model: one tab stop for the list, arrows move inside it, Enter opens.
 * The alternative — every row a tab stop — makes a queue of nine cards nine
 * presses before the board's own controls. Escape is handled HERE, on the rail,
 * so it closes this and only this: the board already owns a document-level
 * Escape (the filter bar) and a second one would close both.
 */
type ReviewQueueRailProps = {
  id: string;
  open: boolean;
  rows: ReviewQueueRow[];
  gates: ReviewQueueGateRead[];
  badge: ReviewQueueBadge;
  nowMs: number;
  loading: boolean;
  ledgerOk: boolean;
  onRetry: () => void;
  onClose: () => void;
  onOpenCard: (cardId: string) => void;
};

const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";
const CLOSE_CLASS = `shrink-0 rounded border border-border px-2 py-1 text-xs hover:bg-muted/60 ${FOCUS_RING}`;
const ROW_CLASS = `flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-muted/60 ${FOCUS_RING}`;
const RETRY_CLASS = `cursor-pointer underline underline-offset-2 hover:text-foreground ${FOCUS_RING}`;

export function ReviewQueueRail(props: ReviewQueueRailProps) {
  const { id, open, rows, gates, badge, nowMs, loading, ledgerOk, onRetry, onClose, onOpenCard } = props;
  const roving = useRovingRows(rows.length, onClose);
  if (!open) return null;
  return (
    <aside
      id={id}
      role="region"
      aria-label="Review queue"
      data-review-queue-rail
      tabIndex={-1}
      onKeyDown={roving.onKeyDown}
      style={REVIEW_QUEUE_RAIL_STYLE}
      className="flex flex-col gap-2 overflow-y-auto border-l border-border bg-card p-3 shadow-lg"
    >
      <RailHeader badge={badge} ledgerOk={ledgerOk} onClose={onClose} />
      <AgeLegend />
      {ledgerOk && rows.length === 0 ? (
        <p data-review-queue-empty className="text-xs text-muted-foreground">
          Nothing is waiting on you.
        </p>
      ) : null}
      <RowList rows={rows} nowMs={nowMs} roving={roving} onOpenCard={onOpenCard} />
      {!ledgerOk && !loading ? <GateFailures gates={gates} onRetry={onRetry} /> : null}
    </aside>
  );
}

function RailHeader(props: { badge: ReviewQueueBadge; ledgerOk: boolean; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">Review queue</h2>
        <p data-review-queue-count className="text-xs text-muted-foreground">
          {props.ledgerOk
            ? `${props.badge.count} waiting on you`
            : "waiting-on could not be checked"}
        </p>
      </div>
      <button type="button" onClick={props.onClose} aria-label="Close review queue" className={CLOSE_CLASS}>
        Close
      </button>
    </div>
  );
}

/**
 * The legend is not a tooltip and not a help popover: three cells, three
 * meanings, readable without discovering anything. A reader who meets `~4d`
 * twice and guesses wrong has been told a number that means something else.
 */
function AgeLegend() {
  return (
    <dl data-review-queue-legend className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
      {REVIEW_QUEUE_AGE_LEGEND.map((entry) => (
        <div key={entry.cell} className="flex items-baseline gap-2">
          <dt className="w-8 shrink-0 font-mono tabular-nums">{entry.cell}</dt>
          <dd className="min-w-0">{entry.meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

function RowList(props: {
  rows: ReviewQueueRow[];
  nowMs: number;
  roving: RovingRows;
  onOpenCard: (cardId: string) => void;
}) {
  if (props.rows.length === 0) return null;
  return (
    <ul role="list" className="flex flex-col">
      {props.rows.map((row, index) => (
        <li key={row.id} role="listitem">
          <QueueRow
            row={row}
            nowMs={props.nowMs}
            tabStop={index === props.roving.active}
            register={(element) => {
              props.roving.refs.current[index] = element;
            }}
            onFocus={() => props.roving.setActive(index)}
            onOpen={() => props.onOpenCard(row.id)}
          />
        </li>
      ))}
    </ul>
  );
}

function QueueRow(props: {
  row: ReviewQueueRow;
  nowMs: number;
  tabStop: boolean;
  register: (element: HTMLButtonElement | null) => void;
  onFocus: () => void;
  onOpen: () => void;
}) {
  const { row, nowMs, tabStop, register, onFocus, onOpen } = props;
  const age = queueAgeCell(row, nowMs);
  return (
    <button
      ref={register}
      type="button"
      data-review-queue-row
      data-waiting-on={row.waitingOn}
      aria-label={`${row.name}, ${row.gate}, ${age}`}
      tabIndex={tabStop ? 0 : -1}
      onClick={onOpen}
      onFocus={onFocus}
      style={{ minHeight: REVIEW_QUEUE_ROW_PX }}
      className={ROW_CLASS}
    >
      <span className="min-w-0 flex-1 truncate text-xs text-foreground">{row.name}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{row.gate}</span>
      <span className="w-9 shrink-0 text-right font-mono text-xs tabular-nums">{age}</span>
    </button>
  );
}

/**
 * One line per gate that could not be read, each with its own retry.
 *
 * The four gates are read off one snapshot, so in practice they fail together —
 * and the line still names the gate, because a reader looking for the code
 * review should be told about the code review, not about "the queue". Every
 * retry re-issues that one read.
 */
function GateFailures(props: { gates: ReviewQueueGateRead[]; onRetry: () => void }) {
  const failed = props.gates.filter((gate) => gate.state === "failed");
  return (
    <div data-review-queue-failures className="flex flex-col gap-1 border-t border-border pt-2">
      {failed.map((gate) => (
        <p key={gate.id} data-review-queue-failure={gate.id} className="text-[11px] text-muted-foreground">
          could not check {gate.label}{" "}
          <button type="button" onClick={props.onRetry} className={RETRY_CLASS}>
            Retry
          </button>
        </p>
      ))}
    </div>
  );
}

type RovingRows = {
  active: number;
  setActive: (index: number) => void;
  refs: React.RefObject<Array<HTMLButtonElement | null>>;
  onKeyDown: (event: React.KeyboardEvent) => void;
};

/**
 * One tab stop, and the keys that move it.
 *
 * The focused row is the tab stop, so tabbing back into the queue lands where
 * the reader left it. `refs` is the focus mechanism: a row is a button, so
 * moving the tab stop without moving focus would leave the visible ring and the
 * operative stop in different places.
 */
function useRovingRows(total: number, onClose: () => void): RovingRows {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const active = Math.min(activeIndex, Math.max(0, total - 1));
  const focusRow = useCallback((index: number) => {
    const next = Math.max(0, Math.min(total - 1, index));
    setActiveIndex(next);
    refs.current[next]?.focus();
  }, [total]);
  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    const moves: Record<string, number> = { ArrowDown: active + 1, ArrowUp: active - 1, Home: 0, End: total - 1 };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    focusRow(target);
  }, [active, total, focusRow, onClose]);
  return { active, setActive: setActiveIndex, refs, onKeyDown };
}

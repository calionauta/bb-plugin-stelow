import type { Dispatch, SetStateAction } from "react";
import { formatDuration } from "../../lib/card-metrics.mjs";
import { AttentionRow, CoverageLines, WaitBreakdown } from "./flow-wait";
import {
  FLOW_WINDOWS,
  type FlowAttention,
  type FlowKind,
  type FlowMetrics,
  type FlowRow,
  type FlowTab,
  type FlowViewState,
  type FlowWindow,
} from "./flow-types";

/**
 * The flow drawer's contents: the timing table, the attention lists, and their tabs.
 *
 * Split out of `flow-strip.tsx` when that file crossed the repository's budget. The seam is
 * the drawer's edge: the strip renders the summary line on the board and this file renders
 * everything that lives inside the panel.
 */

const FLOW_TAB_CLASS = "min-h-9 cursor-pointer rounded-md px-2 text-xs font-medium";
const FLOW_ROW_CLASS =
  "flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs "
  + "hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";

/** A duration, or an em dash when the trail does not measure one. Never a zero: an
 * unmeasured card and a card that took no time are different readings. */
function formatOptionalDuration(value: number | null): string {
  return value === null ? "—" : formatDuration(value);
}

type FlowDetailsProps = {
  result: FlowMetrics;
  view: FlowViewState;
  rows: FlowRow[];
  stuck: FlowAttention[];
  review: FlowAttention[];
  onOpenCard: (kind: FlowKind, cardId: string) => void;
};

export function FlowDetails({
  result,
  view,
  rows,
  stuck,
  review,
  onOpenCard,
}: FlowDetailsProps) {
  return (
    <div className="mt-2 space-y-2">
      <FlowTabBar
        result={result}
        tab={view.tab}
        setTab={view.setTab}
        attention={stuck.length + review.length}
      />
      {view.tab === "timing" ? (
        <TimingDetails
          window={view.window}
          setWindow={view.setWindow}
          result={result}
          rows={rows}
          onOpenCard={onOpenCard}
        />
      ) : (
        <AttentionDetails stuck={stuck} review={review} onOpenCard={onOpenCard} />
      )}
    </div>
  );
}

function FlowTabBar({
  result,
  tab,
  setTab,
  attention,
}: {
  result: FlowMetrics;
  tab: FlowTab;
  setTab: Dispatch<SetStateAction<FlowTab>>;
  attention: number;
}) {
  return (
    <div
      className="flex items-center gap-1"
      role="group"
      aria-label="Flow view"
    >
      {(["timing", "attention"] as const).map((entry) => (
        <button
          key={entry}
          onClick={() => setTab(entry)}
          aria-pressed={tab === entry}
          className={`${FLOW_TAB_CLASS} ${tab === entry ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"}`}
        >
          {entry === "timing"
            ? "Timing"
            : `Attention${attention > 0 ? ` (${attention})` : ""}`}
        </button>
      ))}
      <span className="ml-auto text-xs tabular-nums text-muted-foreground">
        slow: lead {formatOptionalDuration(result.summary.leadP90Ms)} · cycle{" "}
        {formatOptionalDuration(result.summary.cycleP90Ms)}
      </span>
    </div>
  );
}

type TimingDetailsProps = {
  window: FlowWindow;
  setWindow: Dispatch<SetStateAction<FlowWindow>>;
  result: FlowMetrics;
  rows: FlowRow[];
  onOpenCard: (kind: FlowKind, cardId: string) => void;
};

function TimingDetails({
  window,
  setWindow,
  result,
  rows,
  onOpenCard,
}: TimingDetailsProps) {
  return (
    <div className="space-y-2">
      <p className="text-xs leading-5 text-muted-foreground">
        Typical is the median (p50); slow is p90 — 9 of 10 finish within. Lead
        runs idea to done; cycle runs first real movement to done.
      </p>
      <WaitBreakdown wait={result.wait} />
      {/* The reviewer and rework readings, over the same finished cards. The
          strings arrive rendered from the same lib owners the CLI and the card
          call, so this panel cannot word a number differently from either — it
          prints, it does not format. Both are "" unless there is something to
          report: no card reviewed twice means no rework line, and no cut
          artifact means no coverage line. A panel that always printed a row
          would be a row nobody reads. */}
      <CoverageLines coverage={result.coverage} />
      <div className="flex items-center gap-1" role="group" aria-label="Done window">
        {FLOW_WINDOWS.map((entry) => (
          <button
            key={entry.id}
            onClick={() => setWindow(entry.id)}
            aria-pressed={window === entry.id}
            className={`${FLOW_TAB_CLASS} ${window === entry.id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"}`}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <ul className="space-y-0.5">
        {rows.map((item) => (
          <li key={item.cardId}>
            <FlowRow item={item} onOpenCard={onOpenCard} />
          </li>
        ))}
      </ul>
    </div>
  );
}

type AttentionDetailsProps = {
  stuck: FlowAttention[];
  review: FlowAttention[];
  onOpenCard: (kind: FlowKind, cardId: string) => void;
};

/**
 * The two attention lists, right now rather than in the picked window.
 *
 * Reviews are sorted oldest-first: a finished card nobody has opened for a week
 * is the one a reader needs to see, and a list sorted by anything else buries it
 * under this morning's completions.
 */
function AttentionDetails({
  stuck,
  review,
  onOpenCard,
}: AttentionDetailsProps) {
  const entries = [
    ...stuck,
    ...review.slice().sort((a, b) => (b.waitMs ?? 0) - (a.waitMs ?? 0)),
  ];
  return (
    <div className="space-y-2">
      <p className="text-xs leading-5 text-muted-foreground">
        Right now — not in the selected window. Stuck means blocked status or an
        errored worker; review means finished and awaiting your read.
      </p>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          All clear — nothing stuck, nothing awaiting review.
        </p>
      ) : (
        <ul className="space-y-0.5">
          {entries.map((entry) => (
            <AttentionRow
              key={entry.cardId}
              entry={entry}
              onOpenCard={onOpenCard}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function FlowRow({
  item,
  onOpenCard,
}: {
  item: FlowRow;
  onOpenCard: (kind: FlowKind, cardId: string) => void;
}) {
  return (
    <button
      onClick={() => onOpenCard(item.kind, item.cardId)}
      className={FLOW_ROW_CLASS}
    >
      <span className="min-w-0 flex-1 truncate">{item.name}</span>
      <span className="shrink-0 tabular-nums text-muted-foreground">
        lead {formatOptionalDuration(item.leadMs)}
      </span>
      <span className="shrink-0 tabular-nums text-muted-foreground">
        cycle {formatOptionalDuration(item.cycleMs)}
      </span>
    </button>
  );
}

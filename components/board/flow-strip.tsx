import { useEffect, useState } from "react";
import { DisclosureChevron } from "../disclosure";
import { formatDuration } from "../../lib/card-metrics.mjs";
import { ResponsiveDrawerShell } from "../ui/responsive-drawer-shell";
import { FlowDetails } from "./flow-drawer-details";
import {
  FLOW_WINDOWS,
  type FlowAttention,
  type FlowKind,
  type FlowMetrics,
  type FlowRpc,
  type FlowTab,
  type FlowWindow,
} from "./flow-types";

const FLOW_BUTTON_CLASS =
  "flex min-h-11 w-full cursor-pointer flex-wrap items-center gap-2 text-xs "
  + "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";

type FlowStripProps = {
  rpc: FlowRpc;
  projectId: string | null;
  onOpenCard: (kind: FlowKind, cardId: string) => void;
};

/**
 * The flow indicators: one summary line on the board, and a side panel with the detail.
 *
 * It used to be an accordion that expanded IN PLACE, in the board's own column — so opening
 * it pushed the board down and then covered it with a `max-h-56` scroll box, on a board that
 * is itself a scrolling surface. Reported as "a barra de flow ta em um lugar ruim tambem e
 * qdo abre ta mal apresentada".
 *
 * The summary stays on the board because it is a status line — how many finished, how long
 * they took — and a reader should not have to open a panel to see it. The detail moves to a
 * right-side drawer: full height for the lists, no `max-h` clamp, and the board stays visible
 * beside it so a name in the list can be compared against the card it came from.
 */
export function FlowStrip({ rpc, projectId, onOpenCard }: FlowStripProps) {
  const [open, setOpen] = useState(false);
  const [window, setWindow] = useState<FlowWindow>("all");
  const [tab, setTab] = useState<FlowTab>("timing");
  const result = useFlowMetrics(rpc, projectId, window);
  if (!result || result.summary.count === 0) return null;
  const preset =
    FLOW_WINDOWS.find((entry) => entry.id === window) ?? FLOW_WINDOWS[0]!;
  const rows = [...result.items].sort(
    (a, b) => (b.leadMs ?? -1) - (a.leadMs ?? -1),
  );
  const stuck = result.attention.filter((entry) => entry.reason === "stuck");
  const review = result.attention.filter((entry) => entry.reason === "review");
  return (
    <>
      <div className="rounded-md border bg-muted/20 px-3 py-2">
        <FlowSummaryHeader
          open={open}
          onToggle={() => setOpen((value) => !value)}
          result={result}
          preset={preset}
          stuck={stuck}
          review={review}
        />
      </div>
      <ResponsiveDrawerShell
        open={open}
        onOpenChange={setOpen}
        side="right"
        srLabel="Flow indicators"
        contentClassName="overflow-y-auto p-4"
      >
        <FlowDetails
          result={result}
          view={{ tab, setTab, window, setWindow }}
          rows={rows}
          stuck={stuck}
          review={review}
          onOpenCard={(kind, cardId) => {
            setOpen(false);
            onOpenCard(kind, cardId);
          }}
        />
      </ResponsiveDrawerShell>
    </>
  );
}

function useFlowMetrics(
  rpc: FlowRpc,
  projectId: string | null,
  window: FlowWindow,
) {
  const [result, setResult] = useState<FlowMetrics | null>(null);
  const preset =
    FLOW_WINDOWS.find((entry) => entry.id === window) ?? FLOW_WINDOWS[0]!;
  const since =
    preset.days === null ? null : Date.now() - preset.days * 86400000;
  useEffect(() => {
    let cancelled = false;
    void rpc
      .call("flowMetrics", { projectId, since })
      .then((next) => {
        if (!cancelled) setResult(next);
      })
      .catch(() => {
        if (!cancelled) setResult(null);
      });
    return () => {
      cancelled = true;
    };
  }, [rpc, projectId, window]);
  return result;
}

type FlowSummaryHeaderProps = {
  open: boolean;
  onToggle: () => void;
  result: FlowMetrics;
  preset: (typeof FLOW_WINDOWS)[number];
  stuck: FlowAttention[];
  review: FlowAttention[];
};

/** A duration, or an em dash when the trail does not measure one — never a zero, because
 * an unmeasured card and a card that took no time are different readings. */
function formatOptionalDuration(value: number | null): string {
  return value === null ? "—" : formatDuration(value);
}

function FlowSummaryHeader({
  open,
  onToggle,
  result,
  preset,
  stuck,
  review,
}: FlowSummaryHeaderProps) {
  const leadTypical = formatOptionalDuration(result.summary.leadP50Ms);
  const cycleTypical = formatOptionalDuration(result.summary.cycleP50Ms);
  const label = `${result.summary.count} finished · ${preset.label.toLowerCase()} · lead typical ${leadTypical} · cycle typical ${cycleTypical}`;
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`Flow indicators: ${label}. Finished cards with a measured trail in this scope and window.`}
      title="Finished cards with a measured trail in this scope and window — a Done-column card without one reads here only after its trail records."
      className={FLOW_BUTTON_CLASS}
    >
      <DisclosureChevron open={open} />
      <span className="font-medium text-foreground">Flow</span>
      <span className="whitespace-nowrap text-muted-foreground">
        {result.summary.count} finished · {preset.label.toLowerCase()}
      </span>
      <span className="whitespace-nowrap text-muted-foreground">
        lead typical {leadTypical}
      </span>
      <span className="whitespace-nowrap text-muted-foreground">
        cycle typical {cycleTypical}
      </span>
      {stuck.length > 0 ? <FlowBadge tone="stuck" count={stuck.length} /> : null}
      {review.length > 0 ? <FlowBadge tone="review" count={review.length} /> : null}
    </button>
  );
}

function FlowBadge({
  tone,
  count,
}: {
  tone: "stuck" | "review";
  count: number;
}) {
  const isStuck = tone === "stuck";
  const label = isStuck ? "stuck" : "to review";
  const title = isStuck
    ? "Blocked status or errored worker — needs unblocking, right now"
    : "Finished cards awaiting your read";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium ${
        isStuck ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      }`}
      title={title}
    >
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${isStuck ? "animate-pulse bg-amber-500" : "bg-emerald-500"}`}
      />
      {count} {label}
    </span>
  );
}

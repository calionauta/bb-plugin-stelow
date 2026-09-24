import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { DisclosureChevron } from "../disclosure";
import { formatDuration } from "../../lib/card-metrics.mjs";
import type { rpcContract } from "../../server";

const FLOW_BUTTON_CLASS =
  "flex min-h-11 w-full cursor-pointer flex-wrap items-center gap-2 text-xs "
  + "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";
const FLOW_TAB_CLASS = "min-h-9 cursor-pointer rounded-md px-2 text-xs font-medium";
const FLOW_ROW_CLASS =
  "flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs "
  + "hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";

export type FlowWindow = "all" | "30d" | "90d";
export const FLOW_WINDOWS: Array<{
  id: FlowWindow;
  label: string;
  days: number | null;
}> = [
  { id: "all", label: "All time", days: null },
  { id: "30d", label: "30d", days: 30 },
  { id: "90d", label: "90d", days: 90 },
];
type FlowRpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type FlowResult = Awaited<
  ReturnType<ReturnType<typeof useRpc<typeof rpcContract>>["call"]>
>;
type FlowMetrics = Extract<
  FlowResult,
  { items: unknown; summary: unknown; attention: unknown }
>;
type FlowKind = FlowMetrics["items"][number]["kind"];
type FlowStripProps = {
  rpc: FlowRpc;
  projectId: string | null;
  onOpenCard: (kind: FlowKind, cardId: string) => void;
};
type FlowRow = FlowMetrics["items"][number];
type FlowAttention = FlowMetrics["attention"][number];

export function FlowStrip({ rpc, projectId, onOpenCard }: FlowStripProps) {
  const [open, setOpen] = useState(false);
  const [window, setWindow] = useState<FlowWindow>("all");
  const [tab, setTab] = useState<"tempo" | "atencao">("tempo");
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
  if (!result || result.summary.count === 0) return null;
  const rows = [...result.items].sort(
    (a, b) => (b.leadMs ?? -1) - (a.leadMs ?? -1),
  );
  const stuck = result.attention.filter((entry) => entry.reason === "stuck");
  const review = result.attention.filter((entry) => entry.reason === "review");
  const leadTypical =
    result.summary.leadP50Ms !== null
      ? formatDuration(result.summary.leadP50Ms)
      : "—";
  const cycleTypical =
    result.summary.cycleP50Ms !== null
      ? formatDuration(result.summary.cycleP50Ms)
      : "—";
  const label = `${result.summary.count} finished · ${preset.label.toLowerCase()} · lead typical ${leadTypical} · cycle typical ${cycleTypical}`;
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <button
        onClick={() => setOpen((value) => !value)}
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
        {stuck.length > 0 ? (
          <FlowBadge tone="stuck" count={stuck.length} />
        ) : null}
        {review.length > 0 ? (
          <FlowBadge tone="review" count={review.length} />
        ) : null}
      </button>
      {open ? (
        <FlowDetails
          result={result}
          tab={tab}
          setTab={setTab}
          window={window}
          setWindow={setWindow}
          rows={rows}
          stuck={stuck}
          review={review}
          onOpenCard={onOpenCard}
        />
      ) : null}
    </div>
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

type FlowDetailsProps = {
  result: FlowMetrics;
  tab: "tempo" | "atencao";
  setTab: (tab: "tempo" | "atencao") => void;
  window: FlowWindow;
  setWindow: (window: FlowWindow) => void;
  rows: FlowRow[];
  stuck: FlowAttention[];
  review: FlowAttention[];
  onOpenCard: (kind: FlowKind, cardId: string) => void;
};

function FlowDetails({
  result,
  tab,
  setTab,
  window,
  setWindow,
  rows,
  stuck,
  review,
  onOpenCard,
}: FlowDetailsProps) {
  const leadP90 =
    result.summary.leadP90Ms !== null
      ? formatDuration(result.summary.leadP90Ms)
      : "—";
  const cycleP90 =
    result.summary.cycleP90Ms !== null
      ? formatDuration(result.summary.cycleP90Ms)
      : "—";
  return (
    <div className="mt-2 space-y-2">
      <div
        className="flex items-center gap-1"
        role="group"
        aria-label="Flow view"
      >
        {(["tempo", "atencao"] as const).map((entry) => (
          <button
            key={entry}
            onClick={() => setTab(entry)}
            aria-pressed={tab === entry}
            className={`${FLOW_TAB_CLASS} ${tab === entry ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"}`}
          >
            {entry === "tempo"
              ? "Tempo"
              : `Atenção${stuck.length + review.length > 0 ? ` (${stuck.length + review.length})` : ""}`}
          </button>
        ))}
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          slow: lead {leadP90} · cycle {cycleP90}
        </span>
      </div>
      {tab === "tempo" ? (
        <TempoDetails
          window={window}
          setWindow={setWindow}
          rows={rows}
          onOpenCard={onOpenCard}
        />
      ) : (
        <AttentionDetails
          stuck={stuck}
          review={review}
          onOpenCard={onOpenCard}
        />
      )}
    </div>
  );
}

function TempoDetails({
  window,
  setWindow,
  rows,
  onOpenCard,
}: Omit<FlowDetailsProps, "result" | "tab" | "setTab" | "stuck" | "review">) {
  return (
    <div className="space-y-2">
      <p className="text-xs leading-5 text-muted-foreground">
        Typical is the median (p50); slow is p90 — 9 of 10 finish within. Lead
        runs idea to done; cycle runs first real movement to done.
      </p>
      <div
        className="flex items-center gap-1"
        role="group"
        aria-label="Done window"
      >
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
      <ul className="max-h-56 space-y-0.5 overflow-auto">
        {rows.map((item) => (
          <li key={item.cardId}>
            <FlowRow item={item} onOpenCard={onOpenCard} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function AttentionDetails({
  stuck,
  review,
  onOpenCard,
}: {
  stuck: FlowAttention[];
  review: FlowAttention[];
  onOpenCard: (kind: FlowKind, cardId: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs leading-5 text-muted-foreground">
        Right now — not in the selected window. Stuck means blocked status or an
        errored worker; review means finished and awaiting your read.
      </p>
      {stuck.length + review.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          All clear — nothing stuck, nothing awaiting review.
        </p>
      ) : (
        <ul className="max-h-56 space-y-0.5 overflow-auto">
          {[
            ...stuck.map((entry) => ({
              ...entry,
              tone: "text-amber-700 dark:text-amber-300",
              mark: "stuck",
            })),
            ...review.map((entry) => ({
              ...entry,
              tone: "text-emerald-700 dark:text-emerald-300",
              mark: "to review",
            })),
          ].map((entry) => (
            <li key={entry.cardId}>
              <button
                onClick={() => onOpenCard(entry.kind, entry.cardId)}
                className={FLOW_ROW_CLASS}
              >
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                <span className={`shrink-0 font-medium ${entry.tone}`}>
                  {entry.mark}
                </span>
              </button>
            </li>
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
        lead {item.leadMs !== null ? formatDuration(item.leadMs) : "—"}
      </span>
      <span className="shrink-0 tabular-nums text-muted-foreground">
        cycle {item.cycleMs !== null ? formatDuration(item.cycleMs) : "—"}
      </span>
    </button>
  );
}

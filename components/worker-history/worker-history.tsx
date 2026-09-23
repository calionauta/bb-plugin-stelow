import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { DisclosureChevron } from "../disclosure";
import { Pill } from "../dashboard/build-status-pills";
import { workerSectionPolicy } from "../../lib/worker-action-policy.mjs";
import { relativeTime } from "../../lib/relative-time.mjs";
import { formatTokenUsage, sumTokenBreakdowns, totalTokenUsage } from "../../lib/token-usage.mjs";

// Worker presence: the thread opener, the history list (archived threads
// stay readable, provider-reported token totals), and the policy-driven
// section (preset controls, stale-preset resume, write-back link slot).
// Times read the shared relative clock (lib). Every detail body renders
// the same worker truth — one home, not three track copies.

// Every "open the worker thread" affordance: one definition with the
// inspect-title everywhere (it is always an inspection). Renders nothing
// without a thread instead of a dead button that swallows clicks.
export function OpenThreadButton({ threadId }: { threadId: string | null | undefined }) {
  const navigate = useBbNavigate();
  if (!threadId) return null;
  return <Button size="sm" variant="outline" onClick={() => navigate.toThread(threadId)} title="Open the worker thread to inspect what happened.">Open thread ↗</Button>;
}

// Structural view of one worker-history row: the list only reads these
// fields, so detail bodies never import the card contract for this.
export type WorkerHistoryEntry = {
  threadId: string;
  presetName: string | null;
  startedAt: number;
  endedAt: number | null;
  endedReason: string | null;
  tokenUsage: number | null;
  tokenBreakdown: { input: number | null; output: number | null; cached: number | null; reasoning: number | null; total: number | null } | null;
  children?: Array<{
    threadId: string;
    title: string | null;
    status: string;
    providerId: string | null;
    tokenUsage: number | null;
    tokenBreakdown: { input: number | null; output: number | null; cached: number | null; reasoning: number | null; total: number | null } | null;
  }>;
};

// Structural views for the section: the policy reads activity/status,
// the section reads attention, the preset pair, and the history.
export type WorkerCardState = { activity: string; status: string };
export type WorkerDetailState = {
  workerHistory: WorkerHistoryEntry[];
  card: { needsAttention: boolean; presetProviderId: string | null; presetModelId: string | null };
};

function WorkerHistoryRow({ entry }: { entry: WorkerHistoryEntry }) {
  const navigate = useBbNavigate();
  return (
    <div>
      <div className="flex items-center gap-2 px-2 py-1.5 text-xs">
        <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${entry.endedAt === null ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          <span className="font-medium text-foreground">{entry.endedAt === null ? "Current worker" : ({ "band-swap": "Phase preset", restart: "Manual restart", reseed: "Restarted fresh", "strategy-add": "New strategy round", initial: "First worker" } as Record<string, string>)[entry.endedReason ?? ""] ?? "Replaced worker"}</span>
          {entry.presetName ? <span> · {entry.presetName}</span> : null}
          {formatTokenUsage(entry.tokenUsage) ? <span title={`${entry.tokenUsage!.toLocaleString()} provider-reported tokens`}> · {formatTokenUsage(entry.tokenUsage)} tokens</span> : null}
          <span title={new Date(entry.startedAt).toLocaleString()}> · {relativeTime(entry.startedAt)}</span>
        </span>
        <button onClick={() => navigate.toThread(entry.threadId)} title="Open this worker thread (archived threads stay readable)." className="cursor-pointer min-h-11 shrink-0 rounded-md px-2 font-medium text-primary hover:underline">Open ↗</button>
      </div>
      {entry.children?.length ? (
        <div className="space-y-1 border-t border-dashed px-2 py-1.5 pl-6 text-xs">
          {entry.children.map((child) => (
            <div key={child.threadId} className="flex items-center gap-2">
              <span aria-hidden className="size-1 shrink-0 rounded-full bg-muted-foreground/40" />
              <span className="min-w-0 flex-1 truncate text-muted-foreground" title={child.threadId}>
                <span className="font-medium text-foreground">{child.title ?? child.threadId.slice(0, 12)}</span>
                <span> · {child.status}</span>
                {child.providerId ? <span> · {child.providerId}</span> : null}
                {formatTokenUsage(child.tokenUsage) ? <span title={`${child.tokenUsage!.toLocaleString()} provider-reported tokens`}> · {formatTokenUsage(child.tokenUsage)} tokens</span> : null}
              </span>
              <button onClick={() => navigate.toThread(child.threadId)} title="Open this child thread." className="cursor-pointer min-h-11 shrink-0 rounded-md px-2 font-medium text-primary hover:underline">Open ↗</button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function WorkerHistoryList({ history, separated = false }: { history: WorkerHistoryEntry[]; separated?: boolean }) {
  if (history.length === 0) return null;
  const total = totalTokenUsage(history);
  const breakdown = sumTokenBreakdowns(history.flatMap((entry) => [entry.tokenBreakdown, ...(entry.children ?? []).map((child) => child.tokenBreakdown)]));
  const legs = breakdown ? [
    breakdown.input !== null ? `in ${formatTokenUsage(breakdown.input)}` : null,
    breakdown.output !== null ? `out ${formatTokenUsage(breakdown.output)}` : null,
    breakdown.cached !== null ? `cached ${formatTokenUsage(breakdown.cached)}` : null,
    breakdown.reasoning !== null ? `reasoning ${formatTokenUsage(breakdown.reasoning)}` : null,
  ].filter((part): part is string => part !== null) : [];
  return (
    <details className={`group${separated ? " mt-3 border-t pt-2" : ""}`}>
      <summary className="flex min-h-11 cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><DisclosureChevron />Worker history ({history.length}) — archived threads stay readable{total !== null ? <span title={`${total.toLocaleString()} provider-reported tokens across all workers`}> · {formatTokenUsage(total)} tokens total</span> : null}</summary>
      {legs.length > 0 ? <p className="mt-1 text-[11px] text-muted-foreground" title="Provider-reported split across all workers; legs without reports are omitted, never zeroed.">{legs.join(" · ")}</p> : null}
      <div className="mt-1 divide-y divide-border rounded-md border">
        {history.map((entry) => (
          <WorkerHistoryRow key={entry.threadId} entry={entry} />
        ))}
      </div>
    </details>
  );
}

export function WorkerSection({ card, detail, presetStale, restarting, onRestartWorker, onPreset, presetPill, presetNote, pillTitle, githubLink, checkoutNote }: {
  card: WorkerCardState | null;
  detail: WorkerDetailState | null;
  presetStale: boolean;
  restarting: boolean;
  onRestartWorker: () => void;
  onPreset: () => void;
  presetPill: React.ReactNode;
  presetNote: React.ReactNode;
  pillTitle?: string;
  githubLink?: React.ReactNode;
  checkoutNote?: React.ReactNode;
}) {
  const hasGithubLink = Boolean(githubLink);
  const hasHistory = Boolean(detail?.workerHistory.length);
  const actions = workerSectionPolicy(card, Boolean(detail?.card.needsAttention), { hasGithubLink, historyCount: detail?.workerHistory.length ?? 0 });
  const hasPreset = actions.showPresetControls;
  if (!actions.showSection) return null;
  return (
    <section aria-label="Worker" className="rounded-lg border p-3">
      {actions.showPresetControls ? <div className="flex flex-wrap items-center gap-2">
        <Pill tone="bg-muted text-muted-foreground" title={pillTitle}>
          {presetPill}
          {detail?.card.presetProviderId && detail?.card.presetModelId ? (
            <span className="ml-1.5 font-mono text-[10px] text-muted-foreground/80">{detail.card.presetProviderId}/{detail.card.presetModelId}</span>
          ) : null}
        </Pill>
        <Button size="sm" variant="outline" onClick={onPreset} title="Change which provider and model the next worker uses. Takes effect when a new worker starts.">Change preset…</Button>
        <span className="text-xs text-muted-foreground">{presetNote}</span>
      </div> : null}
      {actions.showPresetControls && presetStale ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2">
          <p className="min-w-40 flex-1 text-xs text-muted-foreground">The running worker predates this preset — Resume will not switch provider/model.</p>
          <Button size="sm" disabled={restarting} onClick={onRestartWorker}>{restarting ? "Restarting…" : "Restart worker…"}</Button>
        </div>
      ) : null}
      {githubLink ? <div className={hasPreset ? "mt-3 border-t pt-3" : ""}>{githubLink}</div> : null}
      {checkoutNote ? <p className="mt-2 text-xs text-muted-foreground">{checkoutNote}</p> : null}
      {detail && hasHistory ? <WorkerHistoryList history={detail.workerHistory} separated={hasPreset || hasGithubLink} /> : null}
    </section>
  );
}

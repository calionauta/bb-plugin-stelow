import { useEffect, useState, type ReactNode } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { groupCardChecks, groupState, isExecutionUntracked, isScopeTrackingMissing } from "../../lib/card-checks.mjs";
import { formatDuration } from "../../lib/card-metrics.mjs";
import { statusTone } from "../../lib/detail-presentation.mjs";
import { gapSummaryPresentation, summarizeScopeProgress } from "../../lib/build-progress-presentation.mjs";
import { isDoneStatus } from "../../lib/trackables.mjs";
import { fileLinkTarget, type HostFileTarget, type WorkspaceFileTarget } from "../artifacts/artifact-inventory";
import type { ArtifactViewerMode } from "../conversation/question-batch";
import { Pill } from "../dashboard/build-status-pills";
import { CurrentStagePill } from "../dashboard/build-status-pills";
import { DisclosureSection } from "../disclosure";
import { StageTimeline } from "./stage-timeline";
import { ScopesList } from "./scopes-list";
import type { rpcContract } from "../../server";

type RpcResult = Awaited<ReturnType<ReturnType<typeof useRpc<typeof rpcContract>>["call"]>>;
export type BuildCard = Extract<RpcResult, { cards: unknown }>["cards"][number];
export type BuildDetail = Extract<RpcResult, { card: unknown; comments: unknown; pendingQuestions: unknown }>;
type GapSummary = {
  matched: boolean; total: number; fixed: number; documented: number; escalated: number;
  items: Array<{ description: string; scopeStatus: string | null }>;
  pendingScopes: number; unscoped: number; leadMs: number | null; cycleMs: number | null; done: boolean;
};
type ViewerFile = { display: string; path: string; target: WorkspaceFileTarget | HostFileTarget | null; mode?: ArtifactViewerMode };

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft", planning: "Planning", approved: "Approved", "in-progress": "In progress",
  completed: "Completed", archived: "Archived", pending: "Pending", done: "Done",
  skipped: "Skipped", blocked: "Blocked", escalated: "Escalated", failed: "Failed",
};
const statusLabel = (status: string) => STATUS_LABELS[status] ?? status;
const statusGlyph = (status: string) => {
  if (isDoneStatus(status)) return "✓";
  if (status === "skipped") return "↷";
  if (["blocked", "failed", "escalated"].includes(status)) return status === "escalated" ? "↑" : status === "failed" ? "✗" : "⚠";
  if (["in-progress", "approved"].includes(status)) return "●";
  return status === "archived" ? "○" : "·";
};

function useGapSummary(cardId: string): GapSummary | null {
  const rpc = useRpc<typeof rpcContract>();
  const [summary, setSummary] = useState<GapSummary | null>(null);
  useEffect(() => {
    let cancelled = false;
    void rpc.call("gapSummary", { cardId }).then((result) => { if (!cancelled) setSummary(result); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [rpc, cardId]);
  return summary;
}

function ProgressBar({ percent, tone }: { percent: number; tone: string }) {
  return (
    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${percent}%` }} />
    </div>
  );
}

function ScopeProgress({ scopes, flow }: { scopes: BuildDetail["scopes"]; flow: { leadMs: number | null; cycleMs: number | null } }) {
  const progress = summarizeScopeProgress(scopes);
  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
      {flow.leadMs !== null || flow.cycleMs !== null ? <p className="text-xs text-muted-foreground" title="Lead runs idea to done; cycle runs first real movement to done. Unfinished cards show no times."><span className="font-semibold text-foreground">Lead {flow.leadMs !== null ? formatDuration(flow.leadMs) : "—"}</span><span aria-hidden> · </span><span>Cycle {flow.cycleMs !== null ? formatDuration(flow.cycleMs) : "—"}</span></p> : null}
      <div className="flex items-center gap-2 text-xs"><span className="font-semibold">✓ {progress.scopes.done}/{progress.scopes.total} scopes</span><ProgressBar percent={progress.scopes.percent} tone="bg-emerald-500" /></div>
      {progress.tasks.total > 0 ? <div className="flex items-center gap-2 text-xs"><span className="font-semibold">✓ {progress.tasks.done}/{progress.tasks.total} tasks</span><ProgressBar percent={progress.tasks.percent} tone="bg-primary" /></div> : null}
      {progress.doingCount > 0 ? <p className="text-xs"><span className="font-semibold text-primary">● Doing now: </span><span className="text-muted-foreground">{progress.doingNames.slice(0, 3).join(" · ")}{progress.doingCount > 3 ? ` +${progress.doingCount - 3} more` : ""}</span></p> : progress.allComplete ? <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">✓ All scopes complete</p> : null}
      {progress.blockedNames.length > 0 ? <p className="text-xs"><span className="font-semibold text-destructive">⚠ Blocked: </span><span className="text-muted-foreground">{progress.blockedNames.slice(0, 3).join(" · ")}</span></p> : null}
    </div>
  );
}

function CardChecks({ card, detail, gaps }: { card: BuildCard; detail: BuildDetail; gaps: GapSummary | null }) {
  const [pendingOnly, setPendingOnly] = useState(true);
  const groups = groupCardChecks({
    questions: [...detail.pendingQuestions, ...detail.expiredQuestions], scopes: detail.scopes, gaps,
    review: card.status === "completed" ? { pending: card.hasPendingReview, done: !card.hasPendingReview } : null,
  });
  if (groups.length === 0) return null;
  const visible = pendingOnly ? groups.filter((group) => groupState(group) === "pending") : groups;
  const missingTracking = isScopeTrackingMissing({ activity: card.activity, stage: card.stage, scopes: detail.scopes }) && card.status !== "completed" && card.status !== "archived";
  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
      <div className="flex items-center gap-2"><h3 className="text-xs font-semibold text-foreground">Checks</h3><label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground"><input type="checkbox" checked={pendingOnly} onChange={(event) => setPendingOnly(event.target.checked)} className="size-3.5 accent-primary" />Pending only</label></div>
      {isExecutionUntracked({ activity: card.activity, scopes: detail.scopes }) ? <p className="text-xs text-amber-700 dark:text-amber-300" role="status">Executing with no scope marked started — the worker has not marked any scope in-progress or done. Scopes may be going untracked.</p> : null}
      {missingTracking ? <p className="text-xs text-amber-700 dark:text-amber-300" role="status">No synced scopes on this card — planning likely used headings instead of machine blocks, so sync-scopes parsed nothing. Rewrite the spec with [SCOPE-N] blocks and resync before executing.</p> : null}
      {visible.length === 0 ? <p className="text-xs text-muted-foreground">All clear — nothing pending on this card.</p> : visible.map((group) => <div key={group.id} className="space-y-0.5"><p className="text-xs"><span className="font-medium text-foreground">{group.label}</span><span className="ml-2 tabular-nums text-muted-foreground">{group.open.length}/{group.total} open</span>{groupState(group) === "done" ? <span className="ml-2 text-emerald-700 dark:text-emerald-300">✓</span> : null}</p>{group.open.length > 0 ? <p className="truncate text-[11px] text-muted-foreground" title={group.open.join(" · ")}>{group.open.slice(0, 3).join(" · ")}{group.open.length > 3 ? ` +${group.open.length - 3} more` : ""}</p> : null}</div>)}
    </div>
  );
}

function GapItems({ items }: { items: GapSummary["items"] }) {
  return <ul className="space-y-1 pt-2">{items.map((item) => <li key={item.description} className="flex items-start gap-2 text-xs"><span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${item.scopeStatus && isDoneStatus(item.scopeStatus) ? "bg-emerald-500" : "bg-amber-500"}`} /><span className="flex-1">{item.description}</span>{item.scopeStatus ? <Pill tone={statusTone(item.scopeStatus)}><span className="mr-1">{statusGlyph(item.scopeStatus)}</span>{statusLabel(item.scopeStatus)}</Pill> : <span className="text-amber-700 dark:text-amber-300">no scope yet</span>}</li>)}</ul>;
}

function BuildGaps({ summary }: { summary: GapSummary | null }) {
  const view = gapSummaryPresentation(summary);
  if (!summary?.matched || !view) return null;
  const lead = formatGapMs(summary.leadMs);
  const cycle = formatGapMs(summary.cycleMs);
  return (
    <section aria-label="Gaps and rework" className="rounded-lg border p-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Gaps &amp; rework</h3>
      <p className="pt-1 text-xs text-muted-foreground" title="From the execution critique Gap Registry">{summary.total} gap{summary.total === 1 ? "" : "s"} · {summary.fixed} fixed · {summary.documented} documented · {summary.escalated} escalated{lead ? ` · lead ${lead}` : ""}{cycle ? ` · cycle ${cycle}` : ""}</p>
      {summary.escalated > 0 ? <GapItems items={summary.items} /> : null}
      {view.waitCopy ? <p className="pt-2 text-xs text-amber-700 dark:text-amber-300">{view.waitCopy}</p> : null}
      {view.resolvedCopy ? <p className="pt-2 text-xs text-muted-foreground">{view.resolvedCopy}</p> : null}
    </section>
  );
}

function formatGapMs(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return hours % 24 === 0 ? `${hours / 24}d` : `${Math.floor(hours / 24)}d ${hours % 24}h`;
  return `${Math.floor(hours / 24)}d`;
}

function ScopeSyncWarning({ card, detail }: { card: BuildCard; detail: BuildDetail }) {
  if (!detail.scopeSync || !["human-dialect", "unsynced"].includes(detail.scopeSync.state)) return null;
  const terminal = card.status === "completed" || card.status === "archived";
  const total = detail.scopeSync.humanBlocks || detail.scopeSync.machineBlocks;
  const copy = terminal
    ? `Scope sync parsed 0 of ${total} planned scopes — this card ended before tracking was established (pre-guard format). Its audit record below is the evidence of what was verified.`
    : detail.scopeSync.state === "human-dialect"
      ? `Scope sync parsed 0 of ${detail.scopeSync.humanBlocks} planned scopes — ${detail.scopeSync.specFile ?? "the spec"} uses headings instead of machine blocks. Rewrite openers as [SCOPE-N] Title, resync, then advance.`
      : `Scope sync parsed 0 of ${detail.scopeSync.machineBlocks} planned scopes — run bb stelow sync-scopes, then advance again.`;
  return <p className="text-xs text-amber-700 dark:text-amber-300" role="status">{copy}</p>;
}

function MentionedFiles({ card, detail, onViewFile }: { card: BuildCard; detail: BuildDetail; onViewFile: (file: ViewerFile) => void }) {
  if (detail.mentionedFiles.length === 0) return null;
  return <div className="space-y-1 border-t pt-3"><span className="text-xs font-medium text-muted-foreground">Files named in your request ({detail.mentionedFiles.length}):</span><p className="text-[11px] text-muted-foreground">Paths your request spells out that exist in this workspace. Nothing is inferred from a file name.</p><div className="flex flex-wrap gap-1">{detail.mentionedFiles.map((file) => <button key={file.path} onClick={() => onViewFile({ display: file.display, path: file.absolutePath, target: fileLinkTarget(card.workspaceKind === "exploratory", detail.fileEnvironmentId, file.relPath, file.hostId, file.absolutePath) })} className="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-xs text-foreground hover:bg-muted" title={`Review ${file.display}`}><span>📄</span><span>{file.display}</span></button>)}</div></div>;
}

type BuildProgressProps = {
  card: BuildCard;
  detail: BuildDetail;
  archivedPresentation: { workflow: { title: string; hint: string; emptyScopes: string } } | null;
  artifactTotal: number;
  defaultOpen: boolean;
  intentLabels: Record<string, string>;
  onOpenArtifacts: () => void;
  onPickStage: (stage: string) => void;
  onViewFile: (file: ViewerFile) => void;
};

type ProgressDisclosureProps = Pick<BuildProgressProps, "card" | "archivedPresentation" | "artifactTotal" | "defaultOpen" | "onOpenArtifacts"> & {
  progress: ReturnType<typeof summarizeScopeProgress>;
  children: ReactNode;
};

function ProgressDisclosure({ card, archivedPresentation, artifactTotal, defaultOpen, onOpenArtifacts, progress, children }: ProgressDisclosureProps) {
  const positioned = progress.scopes.total > 0 || card.status === "completed";
  const doing = progress.doingNames[0] ? ` · now: ${progress.doingNames[0]}` : "";
  const hint = progress.scopes.total > 0 ? `${progress.scopes.done}/${progress.scopes.total} scopes${doing}` : undefined;
  const action = artifactTotal > 0 ? <button type="button" onClick={onOpenArtifacts} title="Open this card's Artifacts section" className="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-md px-2 text-xs font-medium text-primary hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{artifactTotal} file{artifactTotal === 1 ? "" : "s"} ↓</button> : null;
  return <DisclosureSection title={archivedPresentation?.workflow.title ?? "Workflow progress"} subtitle={archivedPresentation ? undefined : positioned ? "where this card is" : <>where this card is · <CurrentStagePill stage={card.stage} /></>} hint={archivedPresentation?.workflow.hint ?? hint} action={action} defaultOpen={defaultOpen}>{children}</DisclosureSection>;
}

function emptyScopeCopy(card: BuildCard, archived: string | undefined): string {
  if (archived) return archived;
  if (card.status === "completed") return "Completed without scoped execution — no scope was ever tracked (pre-guard format). Verify the work through the audit record and files below; reopen an earlier stage to continue it under tracking.";
  return "No scopes broken down yet — the agent is still shaping the card.";
}

function ScopesProgress({ detail }: { detail: BuildDetail }) {
  if (detail.scopes.length === 0) return null;
  const flow = { leadMs: detail.card.leadMs ?? null, cycleMs: detail.card.cycleMs ?? null };
  return <><ScopeProgress scopes={detail.scopes} flow={flow} /><ScopesList scopes={detail.scopes} statusTone={statusTone} statusGlyph={statusGlyph} statusLabel={statusLabel} /></>;
}

function TimelineProgress({ card, detail, intentLabels, onPick }: { card: BuildCard; detail: BuildDetail; intentLabels: Record<string, string>; onPick: (stage: string) => void }) {
  const terminal = card.status === "completed" ? "completed" : card.status === "archived" ? "archived" : undefined;
  const offRoute = card.intent && card.intent !== "unknown" ? `Not in this ${intentLabels[card.intent] ?? card.intent} route` : null;
  return <div className="space-y-2 border-t pt-3"><StageTimeline currentStage={card.stage} terminal={terminal} nextStages={detail.nextStages} artifacts={detail.artifacts} onPick={onPick} skips={detail.stageSkips ?? { offRoute: [], skipped: [] }} offRouteReason={offRoute} />{card.status === "archived" ? null : <p className="text-xs text-muted-foreground">{card.status === "completed" ? "Workflow complete — choose an earlier stage to reopen it" : "The agent advances on its own · click a lit stage to override"}</p>}</div>;
}

export function BuildProgress({ card, detail, archivedPresentation, artifactTotal, defaultOpen, intentLabels, onOpenArtifacts, onPickStage, onViewFile }: BuildProgressProps) {
  const gaps = useGapSummary(card.id);
  const progress = summarizeScopeProgress(detail.scopes);
  const emptyScopes = emptyScopeCopy(card, archivedPresentation?.workflow.emptyScopes);
  return (
    <>
      <ProgressDisclosure card={card} archivedPresentation={archivedPresentation} artifactTotal={artifactTotal} defaultOpen={defaultOpen} onOpenArtifacts={onOpenArtifacts} progress={progress}>
        {card.stage === "select" && !archivedPresentation ? <p className="text-xs text-muted-foreground">Item selection: pick the item in the thread — the agent advances on its own, or advance manually below.</p> : null}
        <ScopeSyncWarning card={card} detail={detail} />
        <CardChecks card={card} detail={detail} gaps={gaps} />
        {detail.scopes.length > 0 ? <ScopesProgress detail={detail} /> : <p className="text-xs text-muted-foreground">{emptyScopes}</p>}
        <TimelineProgress card={card} detail={detail} intentLabels={intentLabels} onPick={onPickStage} />
        <MentionedFiles card={card} detail={detail} onViewFile={onViewFile} />
      </ProgressDisclosure>
      <BuildGaps summary={gaps} />
    </>
  );
}

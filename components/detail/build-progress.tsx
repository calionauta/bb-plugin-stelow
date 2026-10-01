import { useEffect, useState, type ReactNode } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { groupCardChecks, groupState, isExecutionUntracked } from "../../lib/card-checks.mjs";
import { scopeSyncNotice } from "../../lib/scope-sync-notice.mjs";
import { formatDuration } from "../../lib/card-metrics.mjs";
import { statusGlyph, statusTone } from "../../lib/detail-presentation.mjs";
import { isDoneStatus, trackableStatusLabel as statusLabel } from "../../lib/trackables.mjs";
import { gapSummaryPresentation, summarizeScopeProgress } from "../../lib/build-progress-presentation.mjs";
import { scopeEmptyState } from "../../lib/scope-xray-presentation.mjs";
import { TEXT_META } from "../../lib/design-tokens";
import { fileLinkTarget, type HostFileTarget, type WorkspaceFileTarget } from "../artifacts/artifact-inventory";
import type { ArtifactViewerMode } from "../conversation/question-batch";
import { Pill, ScopeProgressTrack } from "../dashboard/build-status-pills";
import { CurrentStagePill } from "../dashboard/build-status-pills";
import { DisclosureSection } from "../disclosure";
import { FileOccupancy } from "./file-occupancy";
import { ScopeXray } from "./scope-xray";
import { StageTimeline } from "./stage-timeline";
import { ScopesList } from "./scopes-list";
import type { rpcContract } from "../../server";

type RpcResult = Awaited<ReturnType<ReturnType<typeof useRpc<typeof rpcContract>>["call"]>>;
export type BuildCard = Extract<RpcResult, { cards: unknown }>["cards"][number];
export type BuildDetail = Extract<RpcResult, { card: unknown; comments: unknown; pendingQuestions: unknown }>;
type GapSummary = {
  matched: boolean; total: number; fixed: number; documented: number; escalated: number;
  items: Array<{ description: string; resolution: string; scopeStatus: string | null }>;
  pendingScopes: number; unscoped: number; leadMs: number | null; cycleMs: number | null; done: boolean;
};
type ViewerFile = { display: string; path: string; target: WorkspaceFileTarget | HostFileTarget | null; mode?: ArtifactViewerMode };

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
  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
      <div className="flex items-center gap-2"><h3 className="text-xs font-semibold text-foreground">Checks</h3><label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground"><input type="checkbox" checked={pendingOnly} onChange={(event) => setPendingOnly(event.target.checked)} className="size-3.5 accent-primary" />Pending only</label></div>
      {isExecutionUntracked({ activity: card.activity, scopes: detail.scopes }) ? <p className="text-xs text-amber-700 dark:text-amber-300" role="status">Executing with no scope marked started — the worker has not marked any scope in-progress or done. Scopes may be going untracked.</p> : null}
      {visible.length === 0 ? <p className="text-xs text-muted-foreground">All clear — nothing pending on this card.</p> : visible.map((group) => <div key={group.id} className="space-y-0.5"><p className="text-xs"><span className="font-medium text-foreground">{group.label}</span><span className="ml-2 tabular-nums text-muted-foreground">{group.open.length}/{group.total} open</span>{groupState(group) === "done" ? <span className="ml-2 text-emerald-700 dark:text-emerald-300">✓</span> : null}</p>{group.open.length > 0 ? <p className="truncate text-[11px] text-muted-foreground" title={group.open.join(" · ")}>{group.open.slice(0, 3).join(" · ")}{group.open.length > 3 ? ` +${group.open.length - 3} more` : ""}</p> : null}</div>)}
    </div>
  );
}

/**
 * How a gap reads once the critique is over. A disposition the registry
 * recorded is a fact about the finding, so it is the primary mark; the rework
 * scope only exists for an escalation, and is what a reader is waiting on when
 * one is still open.
 *
 * `unknown` is a real state, not a defensive branch: the registry validator
 * flags a row with a missing or unrecognised `resolution:` as a failure, but a
 * failure is a REPORT and does not stop the card from rendering it. Indexing a
 * record that lacks the key used to throw and take the whole open card down over
 * a typo in one row of a YAML file.
 */
const GAP_RESOLUTION: Record<string, { label: string; dot: string; pill: string }> = {
  fixed: { label: "Fixed", dot: "bg-emerald-500", pill: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  documented: { label: "Documented", dot: "bg-muted-foreground/60", pill: "bg-muted text-muted-foreground" },
  escalate: { label: "Escalated", dot: "bg-amber-500", pill: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  unknown: { label: "Unclassified", dot: "bg-amber-500/60", pill: "bg-muted text-muted-foreground" },
};

function GapItems({ items }: { items: GapSummary["items"] }) {
  return (
    <ul className="space-y-1 pt-2">
      {items.map((item) => {
        const resolution = GAP_RESOLUTION[item.resolution] ?? GAP_RESOLUTION.unknown;
        const scopeDone = item.scopeStatus !== null && isDoneStatus(item.scopeStatus);
        return (
          <li key={item.description} className="flex items-start gap-2 text-xs">
            <span
              aria-hidden
              className={`mt-1.5 size-2 shrink-0 rounded-full ${scopeDone ? "bg-emerald-500" : resolution.dot}`}
            />
            <span className="flex-1">{item.description}</span>
            {item.scopeStatus ? (
              <Pill tone={statusTone(item.scopeStatus)}>
                <span className="mr-1">{statusGlyph(item.scopeStatus)}</span>
                {statusLabel(item.scopeStatus)}
              </Pill>
            ) : (
              <Pill tone={resolution.pill}>{resolution.label}</Pill>
            )}
            {item.resolution === "escalate" && !item.scopeStatus ? (
              <span className="text-amber-700 dark:text-amber-300">no scope yet</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Gaps and rework: a section like any other, not a free-standing panel.
 *
 * It was `rounded-lg border p-4` with its own uppercase heading — a different
 * box on a card of identical boxes, on a card whose visual hierarchy is
 * precisely "one hero, then sections of one shape". The list of gap items is
 * history — gaps a past run recorded — so it starts closed and its tally lives
 * in the header, which is the same contract every other section on the card
 * already follows.
 *
 * The list carries every gap the registry named, not only the escalated ones.
 * Gating it on `escalated > 0` made a critique of two documented gaps render a
 * header reading "2 gaps" above an empty section: the tally counted findings,
 * the body listed rework, and a reader could not reconcile them.
 */
function BuildGaps({ summary }: { summary: GapSummary | null }) {
  const view = gapSummaryPresentation(summary);
  if (!summary?.matched || !view) return null;
  const lead = formatGapMs(summary.leadMs);
  const cycle = formatGapMs(summary.cycleMs);
  const tally = [
    `${summary.total} gap${summary.total === 1 ? "" : "s"}`,
    `${summary.fixed} fixed`,
    `${summary.escalated} escalated`,
    lead ? `lead ${lead}` : null,
    cycle ? `cycle ${cycle}` : null,
  ].filter(Boolean).join(" · ");
  return (
    <DisclosureSection
      title="Gaps and rework"
      subtitle="what the critique found"
      hint={tally}
      defaultOpen={summary.escalated > 0}
    >
      {summary.items.length > 0 ? <GapItems items={summary.items} /> : null}
      {view.waitCopy ? <p className="text-xs text-amber-700 dark:text-amber-300">{view.waitCopy}</p> : null}
      {view.resolvedCopy ? <p className="text-xs text-muted-foreground">{view.resolvedCopy}</p> : null}
    </DisclosureSection>
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
  const copy = scopeSyncNotice(detail.scopeSync, {
    terminal: card.status === "completed" || card.status === "archived",
  });
  if (!copy) return null;
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

/**
 * Why the card has no tracked scopes.
 *
 * The condition used to be `detail.scopes.length === 0`, which is not the
 * condition for "this card has no scope map". The tracker is written at
 * `execution`; the map is approved at `scope`. So a card holding an approved
 * seven-scope map and no tracker yet printed the seven scopes from the X-ray
 * and "No scopes broken down yet — the agent is still shaping the card" four
 * lines below — both true, both about the word "scopes", and together a
 * contradiction. The rule now asks the map, which is the thing the sentence
 * is actually about. See lib/scope-xray-presentation.mjs.
 */
function emptyScopeCopy(card: BuildCard, detail: BuildDetail, archived: string | undefined): string | null {
  return scopeEmptyState({
    hasMap: detail.scopeXray !== null,
    tracked: detail.scopes.length,
    cardStatus: card.status,
    archived,
  }) ?? "";
}

function ScopesProgress({ detail }: { detail: BuildDetail }) {
  if (detail.scopes.length === 0) return null;
  const flow = { leadMs: detail.card.leadMs ?? null, cycleMs: detail.card.cycleMs ?? null };
  const elapsed = detail.card.scopeSummary.elapsedMs;
  const activeScope = detail.card.executingScope;
  return (
    <>
      <ScopeProgress scopes={detail.scopes} flow={flow} />
      <ScopeProgressTrack done={detail.card.scopeSummary.scopesDone} total={detail.card.scopeSummary.scopesTotal} />
      {elapsed != null ? <p className="text-xs text-muted-foreground">Total scope time: {formatDuration(elapsed)}</p> : null}
      {activeScope ? <p className="text-xs text-primary">● Executing: {activeScope}</p> : null}
      <ScopesList
        scopes={detail.scopes}
        statusTone={statusTone}
        statusGlyph={statusGlyph}
        statusLabel={statusLabel}
      />
    </>
  );
}

function TimelineProgress({ card, detail, intentLabels, onPick }: { card: BuildCard; detail: BuildDetail; intentLabels: Record<string, string>; onPick: (stage: string) => void }) {
  const terminal = card.status === "completed" ? "completed" : card.status === "archived" ? "archived" : undefined;
  const offRoute = card.intent && card.intent !== "unknown" ? `Not in this ${intentLabels[card.intent] ?? card.intent} route` : null;
  return <div className="space-y-2 border-t pt-3"><StageTimeline currentStage={card.stage} terminal={terminal} nextStages={detail.nextStages} artifacts={detail.artifacts} onPick={onPick} skips={detail.stageSkips ?? { offRoute: [], skipped: [] }} offRouteReason={offRoute} />{card.status === "archived" ? null : <p className="text-xs text-muted-foreground">{card.status === "completed" ? "Workflow complete — choose an earlier stage to reopen it" : "The agent advances on its own · click a lit stage to override"}</p>}</div>;
}

export function BuildProgress({ card, detail, archivedPresentation, artifactTotal, defaultOpen, intentLabels, onOpenArtifacts, onPickStage, onViewFile }: BuildProgressProps) {
  const gaps = useGapSummary(card.id);
  const progress = summarizeScopeProgress(detail.scopes);
  const emptyScopes = emptyScopeCopy(card, detail, archivedPresentation?.workflow.emptyScopes);
  return (
    <>
      <ProgressDisclosure card={card} archivedPresentation={archivedPresentation} artifactTotal={artifactTotal} defaultOpen={defaultOpen} onOpenArtifacts={onOpenArtifacts} progress={progress}>
        {card.stage === "select" && !archivedPresentation ? <p className="text-xs text-muted-foreground">Item selection: pick the item in the thread — the agent advances on its own, or advance manually below.</p> : null}
        <ScopeSyncWarning card={card} detail={detail} />
        <CardChecks card={card} detail={detail} gaps={gaps} />
        {detail.fileOccupancy ? <FileOccupancy occupancy={detail.fileOccupancy} cardId={card.id} /> : null}
        {detail.scopeXray ? <ScopeXray xray={detail.scopeXray} /> : null}
        {detail.scopes.length > 0 ? <ScopesProgress detail={detail} /> : emptyScopes ? <p className={TEXT_META}>{emptyScopes}</p> : null}
        <TimelineProgress card={card} detail={detail} intentLabels={intentLabels} onPick={onPickStage} />
        <MentionedFiles card={card} detail={detail} onViewFile={onViewFile} />
      </ProgressDisclosure>
      <BuildGaps summary={gaps} />
    </>
  );
}

import { useEffect, useState, type ReactNode } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { groupCardChecks, groupState, isExecutionUntracked } from "../../lib/card-checks.mjs";
import { scopeSyncNotice } from "../../lib/scope-sync-notice.mjs";
import { formatDuration } from "../../lib/card-metrics.mjs";
import { statusGlyph, statusTone } from "../../lib/detail-presentation.mjs";
import { trackableStatusLabel as statusLabel } from "../../lib/trackables.mjs";
import { summarizeScopeProgress } from "../../lib/build-progress-presentation.mjs";
import { scopeEmptyState } from "../../lib/scope-xray-presentation.mjs";
import { TEXT_META } from "../../lib/design-tokens";
import { fileLinkTarget, type HostFileTarget, type WorkspaceFileTarget } from "../artifacts/artifact-inventory";
import type { ArtifactViewerMode } from "../conversation/question-batch";
import { ScopeProgressTrack } from "../dashboard/build-status-pills";
import { CurrentStagePill } from "../dashboard/build-status-pills";
import { DisclosureSection } from "../disclosure";
import { FileOccupancy } from "./file-occupancy";
import { BuildGaps, type GapSummary } from "./progress/build-gaps";
import { ProgressRegion } from "./progress/progress-region";
import { ScopeXray } from "./scope-xray";
import { ScopesList } from "./scopes-list";
import type { rpcContract } from "../../server";

type RpcResult = Awaited<ReturnType<ReturnType<typeof useRpc<typeof rpcContract>>["call"]>>;
export type BuildCard = Extract<RpcResult, { cards: unknown }>["cards"][number];
export type BuildDetail = Extract<RpcResult, { card: unknown; comments: unknown; pendingQuestions: unknown }>;
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
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {/* No heading of its own: the enclosing ProgressRegion is already
            called "Checks", so an h3 here repeated the label on one screen and
            put a heading inside a heading. The region owns the name; this box
            owns the content. */}
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={pendingOnly}
            onChange={(event) => setPendingOnly(event.target.checked)}
            className="size-3.5 accent-primary"
          />
          Pending only
        </label>
      </div>
      {isExecutionUntracked({ activity: card.activity, scopes: detail.scopes }) ? <p className="text-xs text-amber-700 dark:text-amber-300" role="status">Executing with no scope marked started — the worker has not marked any scope in-progress or done. Scopes may be going untracked.</p> : null}
      {visible.length === 0 ? <p className="text-xs text-muted-foreground">All clear — nothing pending on this card.</p> : visible.map((group) => <div key={group.id} className="space-y-0.5"><p className="text-xs"><span className="font-medium text-foreground">{group.label}</span><span className="ml-2 tabular-nums text-muted-foreground">{group.open.length}/{group.total} open</span>{groupState(group) === "done" ? <span className="ml-2 text-emerald-700 dark:text-emerald-300">✓</span> : null}</p>{group.open.length > 0 ? <p className="truncate text-[11px] text-muted-foreground" title={group.open.join(" · ")}>{group.open.slice(0, 3).join(" · ")}{group.open.length > 3 ? ` +${group.open.length - 3} more` : ""}</p> : null}</div>)}
    </div>
  );
}


function ScopeSyncWarning({ card, detail }: { card: BuildCard; detail: BuildDetail }) {
  const copy = scopeSyncNotice(detail.scopeSync, {
    terminal: card.status === "completed" || card.status === "archived",
  });
  if (!copy) return null;
  return <p className="text-xs text-amber-700 dark:text-amber-300" role="status">{copy}</p>;
}

function MentionedFiles({ card, detail, onViewFile }: { card: BuildCard; detail: BuildDetail; onViewFile: (file: ViewerFile) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {detail.mentionedFiles.map((file) => (
        <button
          key={file.path}
          onClick={() => onViewFile({
            display: file.display,
            path: file.absolutePath,
            target: fileLinkTarget(
              card.workspaceKind === "exploratory",
              detail.fileEnvironmentId,
              file.relPath,
              file.hostId,
              file.absolutePath,
            ),
          })}
          className="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-xs text-foreground hover:bg-muted"
          title={`Review ${file.display}`}
        >
          <span aria-hidden>📄</span>
          <span>{file.display}</span>
        </button>
      ))}
    </div>
  );
}

type BuildProgressProps = {
  card: BuildCard;
  detail: BuildDetail;
  archivedPresentation: { workflow: { title: string; hint: string; emptyScopes: string } } | null;
  artifactTotal: number;
  defaultOpen: boolean;
  onOpenArtifacts: () => void;
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
  return (
    <>
      <ScopeProgress scopes={detail.scopes} flow={flow} />
      <ScopeProgressTrack done={detail.card.scopeSummary.scopesDone} total={detail.card.scopeSummary.scopesTotal} />
      {elapsed != null ? <p className="text-xs text-muted-foreground">Total scope time: {formatDuration(elapsed)}</p> : null}
      {/* "Which scope is running" is stated once, by ScopesProgress, as
          "Doing now". This line used to say "Executing" for the same fact, and
          the section hint said "now:" — three names for one answer, so a reader
          could not tell whether they agreed. */}

      <ScopesList
        scopes={detail.scopes}
        statusTone={statusTone}
        statusGlyph={statusGlyph}
        statusLabel={statusLabel}
      />
    </>
  );
}

export function BuildProgress({ card, detail, archivedPresentation, artifactTotal, defaultOpen, onOpenArtifacts, onViewFile }: BuildProgressProps) {
  const gaps = useGapSummary(card.id);
  const progress = summarizeScopeProgress(detail.scopes);
  const emptyScopes = emptyScopeCopy(card, detail, archivedPresentation?.workflow.emptyScopes);
  return (
    <>
      <ProgressDisclosure card={card} archivedPresentation={archivedPresentation} artifactTotal={artifactTotal} defaultOpen={defaultOpen} onOpenArtifacts={onOpenArtifacts} progress={progress}>
        {card.stage === "select" && !archivedPresentation ? <p className="text-xs text-muted-foreground">Item selection: pick the item in the thread — the agent advances on its own, or advance manually below.</p> : null}
        <ScopeSyncWarning card={card} detail={detail} />
        <ProgressRegion title="Checks" hint="what this card still owes">
          <CardChecks card={card} detail={detail} gaps={gaps} />
        </ProgressRegion>
        {detail.fileOccupancy ? (
          <ProgressRegion title="File claims" hint="files this card holds, and files it waits on">
            <FileOccupancy occupancy={detail.fileOccupancy} cardId={card.id} />
          </ProgressRegion>
        ) : null}
        {detail.scopeXray ? (
          <ProgressRegion title="Approved scope map" hint="what the card agreed to do">
            <ScopeXray xray={detail.scopeXray} />
          </ProgressRegion>
        ) : null}
        {detail.scopes.length > 0 ? (
          <ProgressRegion title="Scopes" hint="each unit of work, in dependency order">
            <ScopesProgress detail={detail} />
          </ProgressRegion>
        ) : emptyScopes ? <p className={TEXT_META}>{emptyScopes}</p> : null}
        {detail.mentionedFiles.length > 0 ? (
          <ProgressRegion title="Files named in your request" hint="spelled out by you, never inferred">
            <MentionedFiles card={card} detail={detail} onViewFile={onViewFile} />
          </ProgressRegion>
        ) : null}
      </ProgressDisclosure>
      <BuildGaps summary={gaps} />
    </>
  );
}

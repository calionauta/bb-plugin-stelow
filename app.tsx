import { Children, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  definePluginApp,
  UrlLink,
  experimental_Diff as DiffView,
  experimental_PermissionModePicker as PermissionModePicker,
  experimental_ProviderModelPicker as ProviderModelPicker,
  useBbContext,
  useBbNavigate,
  useComposer,
  useRealtime,
  useRpc,
  type NewThreadRequest,
  type PluginCommandRegistration,
  type PluginMessageDirectiveProps,
  type PluginPendingInteractionProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { countsForInboxBadge } from "./lib/inbox-events.mjs";
import { DECISION_PROVIDERS } from "./lib/decision-api.mjs";
import { INBOX_EVENT_LABELS, inboxEventPresentation, inboxEventText, inboxEventTime, inboxFilterEntries, unreadInboxEntries } from "./lib/inbox-event-presentation.mjs";
import { joinStrategyLabels, liveBorderClass, statusTone } from "./lib/detail-presentation.mjs";
import { relativeTime } from "./lib/relative-time.mjs";
import { researchColumnForStatus } from "./lib/card-question-state.mjs";
import { BUILD_BOARD_COLUMNS, BUILD_BOARD_COLUMN_LABELS, BUILD_BOARD_VISIBLE_COLUMNS, STAGE_PRODUCES, STAGE_SEQUENCE, STAGE_SKILL, STAGE_TO_BAND, WORKFLOW_PHASES, buildBoardColumnFor, stageInfoUrl, stageLabel } from "./lib/workflow-vocabulary.mjs";
import { formatDuration } from "./lib/card-metrics.mjs";
import { groupCardChecks, groupState, isExecutionUntracked, isScopeTrackingMissing } from "./lib/card-checks.mjs";
import { isDoneStatus } from "./lib/trackables.mjs";
import { hillPoint, hillCurvePoints, hillDotPercent, hillSvgY, clusterHillDots, hillTally, isOnHill } from "./lib/hill-position.mjs";
import { inheritAskArtifact, normalizeAskArtifactPath } from "./lib/question-batch.mjs";
import { questionCopy } from "./lib/question-presentation.mjs";
import { LIGHTWEIGHT_COLUMNS, LIGHTWEIGHT_COLUMN_LABELS, LIGHTWEIGHT_VISIBLE_COLUMNS } from "./lib/tracks.mjs";
import { shortRef, isPathInstall, updateAvailableFrom } from "./lib/plugin-update.mjs";
import { kanbanGridColumns, toggleFilterValue, matchesFilterValue } from "./lib/kanban-layout.mjs";
import { branchWebLinks } from "./lib/remote-url.mjs";
import { archivedCardDetailPresentation } from "./lib/card-detail-presentation.mjs";
import { ActivityPill, AttentionChip, BuildStatusPills, CurrentStagePill, DoingNowPill, LightweightStatusPills, Pill, ScopeStrip, activityDotTone } from "./components/dashboard/build-status-pills";
import { StayInTouchStep } from "./components/dashboard/stay-in-touch-step";
import { GithubIssuesDialog, type GithubStatus } from "./components/github/github-issues-dialog";
import { GithubCompletionDialog } from "./components/github/github-completion-dialog";
import { WorkflowSettings, sanitizeReviewGates, type Appetite, type ResearchStrategyOption, type ReviewGates } from "./components/creation/creation-settings";
import { CreateBuildDialog } from "./components/creation/create-build-dialog";
import { CreateResearchDialog } from "./components/creation/create-research-dialog";
import { CreateExploreDialog } from "./components/creation/create-explore-dialog";
import { BatchStepper, ExpiredQuestionsSection, QuestionBatch, type ArtifactViewerMode, type AskArtifact, type BatchItem } from "./components/conversation/question-batch";
import { CardConversation } from "./components/conversation/card-conversation";
import { useDetailComment } from "./components/conversation/use-detail-comment";
import { checkoutNoteFor, WorkerSection } from "./components/worker-history/worker-history";
import { ArtifactGroups, AuditTrailStatusRow, artifactGroupTitle, fileLinkTarget, openAskArtifact, type HostFileTarget, type WorkspaceFileTarget } from "./components/artifacts/artifact-inventory";
import { CardDetailHeader } from "./components/manage/card-detail-header";
import { ConfirmActionDialog } from "./components/manage/confirm-action-dialog";
import { DisclosureChevron, DisclosureSection } from "./components/disclosure";
import { InboxEventBanner, shouldShowInboxEventBanner, useInboxEventFocus } from "./components/detail/inbox-event-banner";
import { InputFiles } from "./components/detail/input-files";
import { ScopesList } from "./components/detail/scopes-list";
import { HERO_STYLE, heroFor } from "./components/detail/detail-hero";
import { DetailHeroActions } from "./components/detail/detail-hero-actions";
import { BAND_LABEL, StageTimeline } from "./components/detail/stage-timeline";
import { WorkflowMap } from "./components/detail/workflow-map";
import { ResearchDetailBody } from "./components/detail/research-detail-body";
import { ExploreDetailBody } from "./components/detail/explore-detail-body";
import { PreviewSection } from "./components/detail/preview-section";
import { ArtifactViewerDialog } from "./components/detail/artifact-viewer-dialog";
import type { rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon, type IconName } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ProjectList = Awaited<ReturnType<ReturnType<typeof useRpc<typeof rpcContract>>["call"]>>;
type ProjectItem = Extract<ProjectList, { projects: unknown }>["projects"][number];

type ProjectsResult = Awaited<ReturnType<ReturnType<typeof useRpc<typeof rpcContract>>["call"]>> extends infer R ? Extract<R, { projects?: unknown }> : never;

const INTENT_LABEL: Record<string, string> = {
  "new-product": "New product",
  feature: "Feature",
  bugfix: "Bug fix",
  refactor: "Refactor",
  investigate: "Investigate",
};

// Intent mapping lives server-side (lib/github-intent.mjs, single source).
// The panel no longer guesses intent; the server derives it from live labels.
const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  planning: "Planning",
  approved: "Approved",
  "in-progress": "In progress",
  completed: "Completed",
  archived: "Archived",
  pending: "Pending",
  done: "Done",
  skipped: "Skipped",
  blocked: "Blocked",
  escalated: "Escalated",
  failed: "Failed",
};

function statusLabel(status: string) {
  return STATUS_LABELS[status] ?? status;
}

// Stages are ordered workflow checkpoints; phases are board-level groups.
// Explore calls its independent, one-off choices techniques instead.
const STAGE_BAND = STAGE_TO_BAND;
// Build board topology is centralized with the workflow vocabulary. The
// aliases keep component call sites readable; they do not define columns.
const COLUMNS = BUILD_BOARD_COLUMNS;
const COLUMN_LABELS: Record<string, string> = BUILD_BOARD_COLUMN_LABELS;
// Rendered boards skip the Bucket column (header button + gallery own it);
// grouping, moves, and the status filter keep the full catalog.
const VISIBLE_COLUMNS = BUILD_BOARD_VISIBLE_COLUMNS;
// workerThreadId is part of the projection (a threadless card waits in the
// Bucket), so it must survive this pick — dropping it silently returned every
// parked card to the Analysis phase.
function boardColumnOf(card: Pick<CardItem, "status" | "stage" | "workerThreadId">): string {
  return buildBoardColumnFor(card);
}

// Lightweight-track columns (Research + Explore share them): a deliberately
// dumb Bucket / Doing / Done flow. Canonical in lib/tracks (shared with the
// server via lib/card-move) — these aliases keep existing call sites stable.
// Statuses reuse the shared enum (pending / in-progress / completed /
// archived) so no migration or guard changes are needed; the mapping lives
// in lib/card-question-state (shared with the server) so a waiting question
// — activity, never status — can never push a Doing card back to the Bucket.
const RESEARCH_COLUMNS = LIGHTWEIGHT_COLUMNS as unknown as readonly ["inbox", "doing", "done", "archived"];
const RESEARCH_COLUMN_LABELS: Record<string, string> = LIGHTWEIGHT_COLUMN_LABELS;
const VISIBLE_RESEARCH_COLUMNS = LIGHTWEIGHT_VISIBLE_COLUMNS as unknown as readonly ["doing", "done", "archived"];
function researchColumnOf(card: Pick<CardItem, "status">): string {
  return researchColumnForStatus(card.status);
}

type StelowTrack = "inbox" | "build" | "research" | "explore" | "about";
// Single source for tracks: the tab bar, the router, and every navigation
// helper read from here. Renaming a track (or reordering tabs) is one line.
const STELOW_TRACKS: Array<{ key: StelowTrack; title: string; icon: IconName; rootSubPath: string }> = [
  { key: "inbox", title: "Inbox", icon: "Mail", rootSubPath: "inbox" },
  { key: "research", title: "Research", icon: "Idea", rootSubPath: "research" },
  { key: "explore", title: "Explore", icon: "Target", rootSubPath: "explore" },
  { key: "build", title: "Build", icon: "Columns2", rootSubPath: "build" },
  { key: "about", title: "About", icon: "Info", rootSubPath: "about" },
];
function trackTitle(track: StelowTrack): string {
  return STELOW_TRACKS.find((entry) => entry.key === track)?.title ?? track;
}
function trackRootSubPath(track: StelowTrack): string {
  return STELOW_TRACKS.find((entry) => entry.key === track)?.rootSubPath ?? "";
}
function trackOfCard(card: Pick<CardItem, "kind">): StelowTrack {
  return card.kind === "research" ? "research" : card.kind === "explore" ? "explore" : "build";
}
function cardSubPath(card: Pick<CardItem, "kind">, cardId: string, eventId?: string | null): string {
  const track = trackOfCard(card);
  return `${track}/card/${cardId}${eventId ? `/event/${eventId}` : ""}`;
}
function inboxCardSubPath(cardId: string, eventId: string): string {
  return `inbox/card/${cardId}/event/${eventId}`;
}

// Panel identity lives here, not scattered across call sites: every
// navigation flows through goToTrack / goToCard / goToInboxCard, so the
// panel id, track routes, and card URLs change in exactly one place each.
const STELOW_PANEL_ID = "stelow";
const STELOW_PANEL_PATH = "stelow";
type BbNavigate = ReturnType<typeof useBbNavigate>;
function goToTrack(navigate: BbNavigate, track: StelowTrack): void {
  navigate.toPluginPanel(STELOW_PANEL_ID, { subPath: trackRootSubPath(track) });
}
function goToCard(navigate: BbNavigate, card: Pick<CardItem, "kind">, cardId: string, eventId?: string | null): void {
  stelowReturnFocusCardId = cardId;
  navigate.toPluginPanel(STELOW_PANEL_ID, { subPath: cardSubPath(card, cardId, eventId) });
}
function goToInboxCard(navigate: BbNavigate, cardId: string, eventId: string): void {
  navigate.toPluginPanel(STELOW_PANEL_ID, { subPath: inboxCardSubPath(cardId, eventId) });
}

// Position of a stage in the canonical sequence (-1 if unknown).
function stageIndex(stage: string) {
  return STAGE_SEQUENCE.indexOf(stage);
}


const FILTER_INTENT_OPTIONS = [{ value: "all", label: "All types" }, ...Object.entries(INTENT_LABEL).map(([value, label]) => ({ value, label }))];
const FILTER_STATUS_OPTIONS = [{ value: "all", label: "Any status" }, ...VISIBLE_COLUMNS.map((column) => ({ value: column, label: COLUMN_LABELS[column] ?? column }))];
const FILTER_ACTIVITY_OPTIONS = [
  { value: "all", label: "Any activity" },
  { value: "idle", label: "idle" },
  { value: "running", label: "running" },
  { value: "awaiting-answer", label: "awaiting-answer" },
  { value: "error", label: "error" },
];

type BoardResult = Awaited<ReturnType<ReturnType<typeof useRpc<typeof rpcContract>>["call"]>>;
type Workflow = Extract<BoardResult, { workflows: unknown }>["workflows"][number];
type ProjectsResponse = Extract<BoardResult, { projects: unknown }>;
type Project = ProjectsResponse["projects"][number];
type CardsResponse = Extract<BoardResult, { cards: unknown }>;
type CardItem = CardsResponse["cards"][number];
type CardDetailResponse = Extract<BoardResult, { card: unknown; comments: unknown; pendingQuestions: unknown }>;

function statusGlyph(status: string) {
  if (isDoneStatus(status)) return "✓";
  if (status === "skipped") return "↷";
  if (status === "blocked") return "⚠";
  if (status === "escalated") return "↑";
  if (status === "failed") return "✗";
  if (status === "in-progress" || status === "approved") return "●";
  if (status === "archived") return "○";
  return "·";
}

const buildStatusPillProps = (card: CardItem) => ({ card, statusTone, intentLabel: (intent: string) => INTENT_LABEL[intent] });

const DEBOUNCE_MS = 250;

// Unified attention: ONE flag (needsAttention) + the reason (kind). All four
// Attention label derived from the card's own activity/status — no separate
// kind enum. One flag (needsAttention) says "a human is needed"; the label
// comes from state the card already carries.
function attentionLabel(card: CardItem): string {
  if (card.activity === "awaiting-answer") return "Answer required";
  if (card.activity === "error") return "Worker failed";
  return "Paused. Resume it.";
}

// A finished card is work a human has to review, and a Done column that looks
// inert teaches people to stop opening it. This is deliberately NOT the amber
// needs-attention treatment: that one means "a worker is blocked on you", which
// is what the Inbox badge and the attention filter count. Finished work gets
// its own quieter, emerald signal so neither meaning is diluted.
function pendingReview(card: Pick<CardItem, "status" | "hasPendingReview">): boolean {
  return card.status === "completed" && card.hasPendingReview;
}

function ReviewChip() {
  return <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-300">Review</span>;
}

function useDebouncedRealtime(channels: readonly string[], handler: () => void, delayMs = DEBOUNCE_MS) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);
  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      handlerRef.current();
    }, delayMs);
  }, [delayMs]);
  for (const channel of channels) {
    useRealtime(channel, schedule);
  }
}

interface SidebarAccessoryHandle {
  count: number;
  tone: string;
}

function SidebarCount({ count, tone, label }: SidebarAccessoryHandle & { label: string }) {
  return (
    <span
      aria-label={label}
      className={`rounded-full px-1.5 py-0.5 text-2xs font-medium tabular-nums ${tone}`}
    >
      {count}
    </span>
  );
}

function useInboxAccessory(): SidebarAccessoryHandle {
  const rpc = useRpc<typeof rpcContract>();
  const [count, setCount] = useState(0);
  const reload = useCallback(async () => {
    try {
      const result = await rpc.call("listNotifications", { includeArchived: false });
      // Badge = live action needed. It deliberately matches the first Inbox
      // filter, so a visible count never opens to an empty state.
      setCount(result.notifications.filter((entry) => countsForInboxBadge(entry)).length);
    } catch {
      /* host will show stale silently */
    }
  }, [rpc]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useDebouncedRealtime(["card-state", "board-changed", "inbox-changed"], () => void reload());
  const tone = count > 0 ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground";
  return { count, tone };
}

// The update affordance shared by every surface — sidebar accessory, About
// tab badge, About header, and the update status box — so the amber "↑" reads
// as the same signal everywhere it appears. labeled={null} renders it
// decorative for places where surrounding text already names the state.
function UpdateBadge({ label = "Plugin update available" }: { label?: string | null }) {
  return (
    <span
      {...(label === null ? { "aria-hidden": true } : { "aria-label": label, title: label })}
      className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-2xs font-medium text-amber-700 dark:text-amber-300"
    >
      ↑
    </span>
  );
}

function StelowInboxSidebarAccessory() {
  const { count, tone } = useInboxAccessory();
  const updateAvailable = usePluginUpdateSignal();
  return <span className="inline-flex items-center gap-1"><SidebarCount count={count} tone={tone} label={`${count} Stelow Inbox items need attention`} />{updateAvailable ? <UpdateBadge label="Stelow plugin update available" /> : null}</span>;
}

// The update signal every surface shares: sidebar accessory, About tab
// badge, About header, and the status box. BB pushes no update events, so a
// module-level store (filled by the first buildInfo read, refreshed by a
// forced check and by the post-apply read) keeps them in lockstep — the
// per-component mount poll this replaced lit only the surface that checked,
// so a "Check update" inside About never reached the sidebar or the tab.
let pluginUpdateAvailable = false;
let pluginUpdateLoaded = false;
const pluginUpdateListeners = new Set<() => void>();
function setPluginUpdateAvailable(next: boolean): void {
  if (pluginUpdateAvailable === next) return;
  pluginUpdateAvailable = next;
  for (const listener of pluginUpdateListeners) listener();
}
function subscribePluginUpdate(listener: () => void): () => void {
  pluginUpdateListeners.add(listener);
  return () => { pluginUpdateListeners.delete(listener); };
}
function pluginUpdateSnapshot(): boolean { return pluginUpdateAvailable; }

function usePluginUpdateSignal(): boolean {
  const rpc = useRpc<typeof rpcContract>();
  const available = useSyncExternalStore(subscribePluginUpdate, pluginUpdateSnapshot, pluginUpdateSnapshot);
  useEffect(() => {
    if (pluginUpdateLoaded) return;
    pluginUpdateLoaded = true;
    void rpc.call("buildInfo", {}).then((info) => {
      setPluginUpdateAvailable(updateAvailableFrom(info));
    }).catch(() => { pluginUpdateLoaded = false; });
  }, [rpc]);
  return available;
}

function useBuildAccessory(): SidebarAccessoryHandle {
  const rpc = useRpc<typeof rpcContract>();
  const [count, setCount] = useState(0);
  const reload = useCallback(async () => {
    try {
      const result = await rpc.call("listCards", { projectId: null, kind: "build" });
      setCount(result.cards.filter((card) => card.status !== "completed" && card.status !== "archived").length);
    } catch {
      /* Keep the last known count while the host reconnects. */
    }
  }, [rpc]);
  useEffect(() => { void reload(); }, [reload]);
  useDebouncedRealtime(["card-state", "board-changed"], () => void reload());
  const tone = count > 0 ? "bg-muted text-foreground" : "bg-muted text-muted-foreground";
  return { count, tone };
}

function useResearchAccessory(): SidebarAccessoryHandle {
  const rpc = useRpc<typeof rpcContract>();
  const [count, setCount] = useState(0);
  const reload = useCallback(async () => {
    try {
      const result = await rpc.call("listCards", { projectId: null, kind: "research" });
      setCount(result.cards.filter((card) => card.status !== "completed" && card.status !== "archived").length);
    } catch {
      /* Keep the last known count while the host reconnects. */
    }
  }, [rpc]);
  useEffect(() => { void reload(); }, [reload]);
  useDebouncedRealtime(["card-state", "board-changed"], () => void reload());
  const tone = count > 0 ? "bg-muted text-foreground" : "bg-muted text-muted-foreground";
  return { count, tone };
}

type InboxNotification = {
  id: string; cardId: string; cardName: string; projectName: string; cardKind: "build" | "research" | "explore";
  kind: "question" | "error" | "paused" | "completed";
  summary: string; occurredAt: number; readAt: number | null; resolvedAt: number | null; archivedAt: number | null;
  severity: number; severityReasons: string[];
};

type InboxEventSnapshot = Pick<InboxNotification, "kind" | "summary" | "occurredAt" | "resolvedAt" | "archivedAt">;

const INBOX_COPY: Record<InboxNotification["kind"], { icon: string; label: string; tone: string }> = {
  question: { icon: "?", label: INBOX_EVENT_LABELS.question, tone: "bg-amber-500/15 text-amber-700" },
  error: { icon: "!", label: INBOX_EVENT_LABELS.error, tone: "bg-destructive/15 text-destructive" },
  paused: { icon: "Ⅱ", label: INBOX_EVENT_LABELS.paused, tone: "bg-amber-500/15 text-amber-700" },
  completed: { icon: "✓", label: INBOX_EVENT_LABELS.completed, tone: "bg-emerald-500/15 text-emerald-700" },
};

function PanelSkeleton({ rows = 4 }: { rows?: number }) {
  return <div className="space-y-3" aria-label="Loading" aria-busy="true">
    {Array.from({ length: rows }, (_, index) => <div key={index} className="h-20 animate-pulse rounded-md border bg-muted/30" />)}
  </div>;
}

// First-load placeholder mirrors the real Build/Research hierarchy: header,
// one compact onboarding row, filters, then cards. Keeping this geometry
// stable prevents the panel from visibly assembling around late RPC results.
function TrackSkeleton({ columns = 5 }: { columns?: number }) {
  return <div className="space-y-4" aria-label="Loading" aria-busy="true">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-2"><div className="h-5 w-72 animate-pulse rounded bg-muted/50" /><div className="h-7 w-28 animate-pulse rounded bg-muted/50" /></div>
      <div className="grid grid-cols-2 gap-2 sm:flex"><div className="h-11 w-28 animate-pulse rounded-md bg-muted/50" /><div className="h-11 w-24 animate-pulse rounded-md bg-muted/50" /></div>
    </header>
    <div className="h-11 animate-pulse rounded-md border bg-muted/30" />
    <div className="flex items-center gap-2 border-b pb-3"><div className="h-9 flex-1 animate-pulse rounded-md bg-muted/50" /><div className="h-9 w-20 animate-pulse rounded-md bg-muted/50" /></div>
    <div className="grid gap-3 lg:grid-cols-5">
      {Array.from({ length: columns }, (_, index) => <section key={index} className="min-h-40 rounded-md border bg-muted/20 p-3"><div className="h-4 w-20 animate-pulse rounded bg-muted/50" /><div className="mt-3 h-20 animate-pulse rounded-md bg-muted/50" /></section>)}
    </div>
  </div>;
}

function InboxPanel() {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [notifications, setNotifications] = useState<InboxNotification[]>([]);
  const [filter, setFilter] = useState<"attention" | "resolved" | "archived" | "all">("attention");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Background refreshes must never flash loading UI (see BoardPanel).
  const firstLoadRef = useRef(true);
  const load = useCallback(async () => {
    if (firstLoadRef.current) setLoading(true);
    try {
      setNotifications((await rpc.call("listNotifications", { includeArchived: true })).notifications);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load Stelow Inbox.");
    }
    finally { setLoading(false); firstLoadRef.current = false; }
  }, [rpc]);
  useEffect(() => { void load(); }, [load]);
  useDebouncedRealtime(["card-state", "inbox-changed"], () => void load());
  const entries = unreadInboxEntries(inboxFilterEntries(notifications, filter), unreadOnly);
  async function open(entry: InboxNotification) {
    if (!entry.readAt) {
      try { await rpc.call("markNotificationRead", { notificationId: entry.id }); }
      catch { /* navigation must remain available if acknowledgement fails */ }
    }
    goToInboxCard(navigate, entry.cardId, entry.id);
  }
  async function archive(entry: InboxNotification) { await rpc.call("archiveNotification", { notificationId: entry.id }); await load(); }
  async function restore(entry: InboxNotification) { await rpc.call("restoreNotification", { notificationId: entry.id }); await load(); }
  const Section = ({ title, entries }: { title: string; entries: InboxNotification[] }) => !entries.length ? null : (
    <section className="space-y-2" aria-label={title}>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <div className="divide-y rounded-md border">
        {entries.map((entry) => {
          const copy = INBOX_COPY[entry.kind];
          const presentation = inboxEventPresentation(entry);
          return <div key={entry.id} className={`flex items-start gap-2 p-3 sm:gap-3 ${entry.readAt ? "bg-background" : "bg-amber-500/5"}`}>
            <button onClick={() => void open(entry)} className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-sm text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
              <span aria-hidden className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${presentation.tone ?? copy.tone}`}>{copy.icon}</span>
              <span className="min-w-0"><span className="flex flex-wrap items-center gap-x-2"><strong className="text-sm">{entry.cardName}</strong>{presentation.stateLabel ? <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{presentation.label}</span> : null}{entry.severity >= 2 && entry.resolvedAt == null ? <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300" title={entry.severityReasons.join(" · ")}>escalating</span> : null}{!entry.readAt ? <span className="size-1.5 rounded-full bg-primary"><span className="sr-only">Unread</span></span> : null}</span><span className="mt-0.5 block text-sm text-muted-foreground">{inboxEventText(entry)}</span>{entry.severityReasons.length > 0 && entry.resolvedAt == null ? <span className="mt-1 block text-xs text-muted-foreground">{entry.severityReasons.slice(0, 3).join(" · ")}</span> : null}<span className="mt-1 block text-xs text-muted-foreground" title={new Date(inboxEventPresentation(entry).stateAt).toLocaleString()}>{entry.projectName} · {inboxEventTime(entry)}</span></span>
            </button>
            <button onClick={() => void (entry.archivedAt ? restore(entry) : archive(entry))} className="cursor-pointer min-h-11 shrink-0 rounded-md px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{entry.archivedAt ? "Restore" : "Archive"}</button>
          </div>;
        })}
      </div>
    </section>
  );
  const filters: Array<{ id: typeof filter; label: string; description: string }> = [
    { id: "attention", label: "Needs attention", description: "Work that needs your decision or recovery." },
    { id: "resolved", label: "Resolved automatically", description: "These needed you once, then cleared on their own — each says how (answered, resumed, completed…). History is kept here." },
    { id: "archived", label: "Archived", description: "Archived updates. Restore an item to return it to history." },
    { id: "all", label: "All", description: "All active Inbox updates, newest first." },
  ];
  // One semantic color per tab, from the same status vocabulary the cards
  // use (amber waits, emerald resolved, zinc archived, primary current):
  // the dot names the kind at a glance, the active tint only confirms it.
  const FILTER_DOT: Record<string, string> = { attention: "bg-amber-500", resolved: "bg-emerald-500", archived: "bg-zinc-500", all: "bg-primary" };
  const FILTER_ACTIVE: Record<string, string> = {
    attention: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    resolved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    archived: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
    all: "bg-primary/15 text-primary",
  };
  const selected = filters.find((entry) => entry.id === filter)!;
  // No blank on reload: first mount skeletons, later polls keep stale
  // content with a quiet updating hint instead of flashing.
  const firstLoad = loading && notifications.length === 0;
  const fatalError = loadError && notifications.length === 0;
  const emptyTitle = unreadOnly ? "No unread updates" : filter === "attention" ? "All clear" : `No ${selected.label.toLowerCase()} updates`;
  const emptyDescription = unreadOnly ? "Everything in this view has been read." : filter === "attention" ? "Stelow will surface work only when it needs you." : selected.description;
  return <div className="h-full overflow-auto bg-background p-4 md:p-6"><div className="mx-auto max-w-4xl space-y-5"><header><h1 className="text-xl font-semibold tracking-tight">Inbox</h1><p className="mt-1 text-sm text-muted-foreground">{selected.description}{loading && !firstLoad ? " Updating…" : ""}</p></header><div className="flex flex-wrap items-center gap-x-3 gap-y-2"><div className="flex min-h-11 gap-1 overflow-x-auto rounded-md border p-1" aria-label="Inbox filters">{filters.map((entry) => <button key={entry.id} onClick={() => setFilter(entry.id)} aria-pressed={filter === entry.id} title={entry.description} className={`inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${filter === entry.id ? FILTER_ACTIVE[entry.id] ?? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"}`}><span aria-hidden className={`size-1.5 rounded-full ${FILTER_DOT[entry.id] ?? "bg-primary"}`} />{entry.label}</button>)}</div><label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} className="size-4 accent-primary" />Unread only</label></div>{firstLoad ? <PanelSkeleton rows={3} /> : fatalError ? <section className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm"><p>{loadError}</p><button onClick={() => void load()} className="cursor-pointer mt-3 min-h-11 rounded-md border px-3 text-sm font-medium hover:bg-background">Retry</button></section> : entries.length ? <Section title={selected.label} entries={entries} /> : <section className="rounded-md border border-dashed bg-muted/30 p-8 text-center"><h2 className="text-sm font-semibold">{emptyTitle}</h2><p className="mt-1 text-sm text-muted-foreground">{emptyDescription}</p></section>}</div></div>;
}

function BoardPanel({ active }: { active: boolean }) {
  const { projectId: routeProjectId } = useBbContext();
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [cards, setCards] = useState<CardItem[]>([]);
  const [boardProjectId, setBoardProjectId] = useState<string | null>(routeProjectId);
  const [collapsedColumns, setCollapsedColumns] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return { archived: true };
    try {
      const raw = window.localStorage.getItem(STORAGE_KEYS.boardColumns);
      if (!raw) return { archived: true };
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      return typeof parsed === "object" && parsed ? parsed : { archived: true };
    } catch { return { archived: true }; }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(STORAGE_KEYS.boardColumns, JSON.stringify(collapsedColumns)); } catch { /* ignore */ }
  }, [collapsedColumns]);
  const [loading, setLoading] = useState(true);
  // Background refreshes (realtime) must never flash loading UI: skeletons
  // blank the board while loading is true. Only the first load may set
  // it; refreshes update state silently.
  const firstLoadRef = useRef(true);
  const [createBuildOpen, setCreateBuildOpen] = useState(false);
  // Workflow preferences stay visible under the composer: a collapsed
  // Settings hides consequential choices (planning depth, review gates)
  // the user would otherwise never discover. The dialog frame keeps a
  // fixed max height with inner scroll, so nothing jumps or resizes.
  const [appetite, setAppetite] = useState<Appetite>("Lean");
  // Review gates are a pure multi-select (empty ≡ Auto). The composer
  // remembers the last used selection per surface; board defaults fill
  // the gap only when nothing was remembered.
  const [reviewGates, setReviewGates] = useState<ReviewGates>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(STORAGE_KEYS.reviewGates);
      if (!raw) return [];
      return sanitizeReviewGates(JSON.parse(raw));
    } catch { return []; }
  });
  const [filterProjectIds, setFilterProjectIds] = useState<string[]>([]);
  const [filterStages, setFilterStages] = useState<string[]>([]);
  const [filterIntents, setFilterIntents] = useState<string[]>([]);
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
  const [filterActivities, setFilterActivities] = useState<string[]>([]);
  const [filterAttention, setFilterAttention] = useState(false);
  const [viewMode, setViewMode] = useBoardView(STORAGE_KEYS.buildView);
  const [collapsedListGroups, setCollapsedListGroups] = useCollapsedGroups(STORAGE_KEYS.buildListGroups);
  const [boardPresets, setBoardPresets] = useState<PresetManagerPreset[]>([]);
  const [boardBandPresets, setBoardBandPresets] = useState<{ band: string; presetId: string | null; stages: string[] }[]>([]);
  const [boardPresetsOpen, setBoardPresetsOpen] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const [githubStatus, setGithubStatus] = useState<GithubStatus | null>(null);
  const [githubAutomationEnabled, setGithubAutomationEnabled] = useState(true);

  const load = useCallback(async (targetId: string | null) => {
    if (firstLoadRef.current) setLoading(true);
    try {
      const [projectsResult, cardsResult, presetsResult, bandPresetsResult, boardResult] = await Promise.all([
        rpc.call("projects", {}).catch(() => null),
        rpc.call("listCards", { projectId: targetId, kind: "build" }).catch(() => ({ cards: [] })),
        rpc.call("listPresets", {}).catch(() => ({ presets: [] })),
        rpc.call("listBandPresets", {}).catch(() => ({ bands: [] })),
        rpc.call("board", { projectId: targetId }).catch(() => null),
      ]);
      setProjects(projectsResult?.projects ?? []);
      setCards(cardsResult.cards);
      setBoardPresets(presetsResult.presets);
      setBoardBandPresets(bandPresetsResult.bands);
      if (boardResult?.githubStatus) setGithubStatus(boardResult.githubStatus);
      if (boardResult && "githubAutomationEnabled" in boardResult) setGithubAutomationEnabled(boardResult.githubAutomationEnabled !== false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load Stelow.");
      if (firstLoadRef.current) {
        setProjects([]);
        setCards([]);
      }
    } finally {
      setLoading(false);
      firstLoadRef.current = false;
    }
  }, [rpc]);

  useEffect(() => { void load(boardProjectId ?? routeProjectId); }, [load, boardProjectId, routeProjectId]);
  useDebouncedRealtime(["card-state", "board-changed", "inbox-changed"], () => void load(boardProjectId ?? routeProjectId));
  useEffect(() => {
    void rpc.call("boardWorkflowDefaults", {}).then(({ appetite: savedAppetite, reviewGates: savedGates }) => {
      setAppetite(savedAppetite);
      // Last used wins: only fall back to the board default when the
      // composer never remembered a selection on this surface.
      try {
        if (window.localStorage.getItem(STORAGE_KEYS.reviewGates) === null) {
          setReviewGates(sanitizeReviewGates(savedGates));
        }
      } catch {
        setReviewGates(sanitizeReviewGates(savedGates));
      }
    }).catch(() => {
      /* Keep Lean/Auto when stored preferences cannot be read. */
    });
  }, [rpc]);
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEYS.reviewGates, JSON.stringify(reviewGates)); } catch { /* best-effort */ }
  }, [reviewGates]);

  const activeProjectId = boardProjectId ?? routeProjectId;
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const defaultWorkerPreset = boardPresets.find((preset) => preset.isDefault) ?? boardPresets[0] ?? null;
  const presetForBand = (band: string) => {
    const assignment = boardBandPresets.find((entry) => entry.band === band);
    return boardPresets.find((preset) => preset.id === assignment?.presetId) ?? defaultWorkerPreset;
  };
  const analysisWorkerPreset = presetForBand("analysis");
  const inbox = cards.filter((card) => card.needsAttention && card.status !== "archived");
  const filteredCards = useMemo(() => cards.filter((card) => {
    if (!matchesFilterValue(filterProjectIds, card.projectId)) return false;
    if (!matchesFilterValue(filterIntents, card.intent)) return false;
    if (!matchesFilterValue(filterStatuses, boardColumnOf(card))) return false;
    if (!matchesFilterValue(filterActivities, card.activity)) return false;
    if (!matchesFilterValue(filterStages, card.stage)) return false;
    if (filterAttention && !card.needsAttention) return false;
    return true;
  }), [cards, filterProjectIds, filterIntents, filterStatuses, filterActivities, filterStages, filterAttention]);
  const stageOptions = useMemo(() => [...STAGE_SEQUENCE], []);
  const grouped = useMemo(() => {
    const groups: Record<string, CardItem[]> = Object.fromEntries(COLUMNS.map((column) => [column, []]));
    for (const card of filteredCards) {
      (groups[boardColumnOf(card)] ?? groups.analysis).push(card);
    }
    for (const column of Object.keys(groups)) {
      groups[column]!.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return groups;
  }, [filteredCards]);
  // Captured pile for the creation checkbox link: same gallery as the
  // header Bucket button, opened from the "park in Bucket" copy.
  const bucketGallery = useBucketGallery(grouped.inbox ?? []);

  async function moveCard(cardId: string, target: string) {
    if (!(COLUMNS as readonly string[]).includes(target)) return;
    const result = await rpc.call("moveCard", { cardId, status: target as "inbox" | "analysis" | "planning" | "execution" | "review" | "completed" | "archived" });
    if (!result.ok) toast.error(result.error ?? "Move failed");
  }


  return (
    <div className="flex h-full overflow-hidden bg-background">
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto max-w-[1500px] space-y-4">
          {loading && cards.length === 0 ? <TrackSkeleton /> : <>
          <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight">Build</h1>
              <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">An AI agent carries each card through a structured workflow—from triage to scope-by-scope execution—pausing for your decisions wherever your review mode requires it.</p>
              {inbox.length > 0 ? <button type="button" onClick={() => setFilterAttention(true)} className="mt-0.5 inline-flex min-h-11 cursor-pointer items-center text-xs text-amber-700 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary dark:text-amber-300" aria-label={`Show the ${inbox.length} card${inbox.length === 1 ? "" : "s"} that need attention`}>
                {inbox.length} {inbox.length === 1 ? "item needs" : "items need"} your attention
              </button> : null}
            </div>
            <div className="grid w-full grid-cols-2 gap-2 sm:mt-0.5 sm:flex sm:w-auto sm:items-center sm:gap-3">
              <Button className="min-h-11 w-full sm:w-auto sm:flex-none" onClick={() => setCreateBuildOpen(true)}><Icon name="Plus" className="h-4 w-4" aria-hidden /> New issue</Button>
              <BucketGalleryButton cards={grouped.inbox ?? []} />
              <Button className="min-h-11 w-full sm:w-auto sm:flex-none" variant="outline" onClick={() => setBoardPresetsOpen(true)} title="Manage agent presets and per-phase routing"><Icon name="Settings" className="h-4 w-4" aria-hidden /> Agent Presets</Button>
              {githubAutomationEnabled ? (
                <Button className="min-h-11 w-full sm:w-auto sm:flex-none" variant="outline" onClick={() => setGithubOpen(true)} title="Import GitHub issues now or watch labels automatically"><Icon name="Github" className="h-4 w-4" aria-hidden /> GitHub issues</Button>
              ) : null}
            </div>
          </header>
          <PresetOnboardingDialog
            storageKey={STORAGE_KEYS.onboardBuild}
            title="Choose your agent presets"
            intro="Set the preset each phase runs with. Planning depth and your review gates are a separate choice — picked per card in New issue, under the description."
            onOpenPresets={() => setBoardPresetsOpen(true)}
            active={active}
            secondTitle="Defaults for new cards"
            secondBody={<WorkflowSettings appetite={appetite} reviewGates={reviewGates} onAppetiteChange={setAppetite} onReviewGatesChange={setReviewGates} groupNamePrefix="board-default" />}
          />
          {githubStatus !== null && githubStatus.pluginAvailable && !githubStatus.ghOk ? (
            <div className="mb-3 flex flex-col gap-1 rounded-md border p-2 text-xs sm:flex-row sm:items-center sm:gap-2">
              <span className="text-amber-700 dark:text-amber-300">Import issues needs a GitHub account linked in the <span className="font-medium">github</span> plugin.</span>
              <a className="text-primary underline underline-offset-2" href="https://github.com/settings/tokens" target="_blank" rel="noreferrer">Set up GitHub auth</a>
            </div>
          ) : null}

          <CreateBuildDialog
            open={createBuildOpen}
            onOpenChange={setCreateBuildOpen}
            activeProjectId={activeProjectId}
            analysisPreset={analysisWorkerPreset}
            appetite={appetite}
            reviewGates={reviewGates}
            onAppetiteChange={setAppetite}
            onReviewGatesChange={setReviewGates}
            bucketGallery={bucketGallery}
            onOpenPresets={() => setBoardPresetsOpen(true)}
          />

          <GithubIssuesDialog
            open={githubOpen}
            onOpenChange={setGithubOpen}
            projects={projects}
            activeProjectId={activeProjectId ?? null}
            activeProjectName={activeProject?.name ?? null}
            githubStatus={githubStatus}
            onChanged={() => void load(boardProjectId ?? routeProjectId)}
          />
          <PresetManagerDialog
            open={boardPresetsOpen}
            onOpenChange={setBoardPresetsOpen}
            rpc={rpc}
            presets={boardPresets}
            onChanged={() => load(boardProjectId ?? routeProjectId)}
          />

          <div className="flex items-start gap-2 border-b pb-3">
            <div className="min-w-0 flex-1">
              <FiltersBar
                projects={projects}
                stageOptions={stageOptions}
                filterProjectIds={filterProjectIds}
                filterStages={filterStages}
                filterIntents={filterIntents}
                filterStatuses={filterStatuses}
                filterActivities={filterActivities}
                filterAttention={filterAttention}
                onProjectToggle={(value) => setFilterProjectIds((prev) => toggleFilterValue(prev, value))}
                onStageToggle={(value) => setFilterStages((prev) => toggleFilterValue(prev, value))}
                onIntentToggle={(value) => setFilterIntents((prev) => toggleFilterValue(prev, value))}
                onStatusToggle={(value) => setFilterStatuses((prev) => toggleFilterValue(prev, value))}
                onActivityToggle={(value) => setFilterActivities((prev) => toggleFilterValue(prev, value))}
                onAttention={setFilterAttention}
                onReset={() => { setFilterProjectIds([]); setFilterStages([]); setFilterIntents([]); setFilterStatuses([]); setFilterActivities([]); setFilterAttention(false); }}
              />
            </div>
            <ViewToggle view={viewMode} onChange={setViewMode} label="Build cards view" />
          </div>
          {cards.length === 0 && !loading ? (
            <section className="rounded-md border border-dashed bg-muted/30 p-6 text-center">
              <h2 className="text-sm font-semibold text-foreground">Product work, guided end to end</h2>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Stelow is an opinionated product workflow for humans and AI agents. Start with an outcome or problem; it guides the work through framing, critique, planning, execution, and review.</p>
              <div className="mt-4 flex flex-col items-center justify-center gap-2 sm:flex-row">
                <Button onClick={() => setCreateBuildOpen(true)}>Start new issue</Button>
                <UrlLink href="https://github.com/calionauta/stelow" className="text-sm font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground">Learn about Stelow <span aria-hidden="true">↗</span></UrlLink>
              </div>
            </section>
          ) : null}

          {viewMode === "board" ? <p className="text-xs text-muted-foreground">
            <span className="sm:hidden">Swipe sideways to view every stage.</span>
            <span className="hidden sm:inline">Use Shift + scroll to move across stages.</span>
          </p> : null}
          <FlowStrip rpc={rpc} projectId={filterProjectIds.length === 1 ? filterProjectIds[0] ?? null : null} navigate={navigate} />
          {viewMode === "list" ? <BuildList groups={grouped} navigate={navigate} collapsed={collapsedListGroups} onToggle={(column) => setCollapsedListGroups((current) => ({ ...current, [column]: !current[column] }))} /> : viewMode === "hill" ? <HillBoard cards={Object.values(grouped).flat()} navigate={navigate} /> : <div data-testid="kanban-board" className="grid justify-start gap-3 overflow-x-auto md:h-[clamp(20rem,calc(100dvh-17rem),48rem)] md:overflow-y-hidden" style={{ gridTemplateColumns: kanbanGridColumns(VISIBLE_COLUMNS, collapsedColumns) }}>
            {VISIBLE_COLUMNS.map((column) => (
              <BoardColumn
                key={column}
                column={column}
                cards={grouped[column]}
                collapsed={Boolean(collapsedColumns[column])}
                onToggleCollapsed={() => setCollapsedColumns((current) => ({ ...current, [column]: !current[column] }))}
                onDrop={(cardId) => moveCard(cardId, column)}
              />
            ))}
          </div>}
          </>}
        </div>
      </div>
    </div>
  );
}

// Second track beside Build: lightweight research (Bucket / Doing / Done)
// driven by one stelow-product-* strategy per card. No stages, no gates —
// the card produces a index, and opportunities fan out into Build cards.
function ResearchPanel({ active }: { active: boolean }) {
  const { projectId: routeProjectId } = useBbContext();
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [cards, setCards] = useState<CardItem[]>([]);
  const [strategies, setStrategies] = useState<ResearchStrategyOption[]>([]);
  const [presets, setPresets] = useState<PresetManagerPreset[]>([]);
  const [researchBandPresets, setResearchBandPresets] = useState<{ band: string; presetId: string | null; stages: string[] }[]>([]);
  const [researchPresetsOpen, setResearchPresetsOpen] = useState(false);
  const [researchProjectId, setResearchProjectId] = useState<string | null>(routeProjectId);
  const [collapsedColumns, setCollapsedColumns] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return { archived: true };
    try {
      const raw = window.localStorage.getItem(STORAGE_KEYS.researchColumns);
      if (!raw) return { archived: true };
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      return typeof parsed === "object" && parsed ? parsed : { archived: true };
    } catch { return { archived: true }; }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(STORAGE_KEYS.researchColumns, JSON.stringify(collapsedColumns)); } catch { /* ignore */ }
  }, [collapsedColumns]);
  const [loading, setLoading] = useState(true);
  // Background refreshes must never flash loading UI (see BoardPanel).
  const firstLoadRef = useRef(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [viewMode, setViewMode] = useBoardView(STORAGE_KEYS.researchView);
  const [collapsedListGroups, setCollapsedListGroups] = useCollapsedGroups(STORAGE_KEYS.researchListGroups);
  const [filterProjectIds, setFilterProjectIds] = useState<string[]>([]);
  const [filterAttention, setFilterAttention] = useState(false);

  const load = useCallback(async (targetId: string | null) => {
    if (firstLoadRef.current) setLoading(true);
    try {
      const [projectsResult, cardsResult, strategiesResult, presetsResult, bandPresetsResult] = await Promise.all([
        rpc.call("projects", {}).catch(() => null),
        rpc.call("listCards", { projectId: targetId, kind: "research" }).catch(() => ({ cards: [] })),
        rpc.call("researchStrategies", {}).catch(() => ({ strategies: [] })),
        rpc.call("listPresets", {}).catch(() => ({ presets: [] })),
        rpc.call("listBandPresets", {}).catch(() => ({ bands: [] })),
      ]);
      setProjects(projectsResult?.projects ?? []);
      setCards(cardsResult.cards);
      setStrategies(strategiesResult.strategies);
      setPresets(presetsResult.presets);
      setResearchBandPresets(bandPresetsResult.bands);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load research.");
      if (firstLoadRef.current) {
        setProjects([]);
        setCards([]);
      }
    } finally {
      setLoading(false);
      firstLoadRef.current = false;
    }
  }, [rpc]);

  useEffect(() => { void load(researchProjectId ?? routeProjectId); }, [load, researchProjectId, routeProjectId]);
  useDebouncedRealtime(["card-state", "board-changed", "inbox-changed"], () => void load(researchProjectId ?? routeProjectId));

  const strategyLabelById = useMemo(() => new Map(strategies.map((entry) => [entry.id, entry.label])), [strategies]);
  const activeProjectId = researchProjectId ?? routeProjectId;
  const defaultPreset = presets.find((preset) => preset.isDefault) ?? presets[0] ?? null;
  // Research has its own band default (like each build phase). Unset means
  // "use the board default" — the same fallback the worker spawn applies, so
  // the dialog never promises a preset the worker won't get.
  const researchBandPreset = presets.find((preset) => preset.id === researchBandPresets.find((entry) => entry.band === "research")?.presetId) ?? null;
  const effectiveResearchPreset = researchBandPreset ?? defaultPreset;
  const filteredCards = useMemo(() => cards.filter((card) => {
    if (!matchesFilterValue(filterProjectIds, card.projectId)) return false;
    if (filterAttention && !card.needsAttention) return false;
    return true;
  }), [cards, filterProjectIds, filterAttention]);
  const grouped = useMemo(() => {
    const groups: Record<string, CardItem[]> = Object.fromEntries(RESEARCH_COLUMNS.map((column) => [column, []]));
    for (const card of filteredCards) {
      (groups[researchColumnOf(card)] ?? groups.inbox).push(card);
    }
    for (const column of Object.keys(groups)) {
      groups[column]!.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return groups;
  }, [filteredCards]);
  // Captured pile for the creation checkbox link: same gallery as the
  // header Bucket button, opened from the "park in Bucket" copy.
  const bucketGallery = useBucketGallery(grouped.inbox ?? []);
  const inbox = cards.filter((card) => card.needsAttention && card.status !== "archived");

  async function moveCard(cardId: string, target: string) {
    if (!(RESEARCH_COLUMNS as readonly string[]).includes(target)) return;
    const result = await rpc.call("moveCard", { cardId, status: target as "inbox" | "doing" | "done" | "archived" });
    if (!result.ok) toast.error(result.error ?? "Move failed");
  }

  return (
    <div className="flex h-full overflow-hidden bg-background">
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto max-w-[1500px] space-y-4">
          {loading && cards.length === 0 ? <TrackSkeleton columns={4} /> : <>
          <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight">Research</h1>
              <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">An AI agent applies specialized research strategy to surface prioritized opportunities you can turn into {trackTitle("build")} cards.</p>
              {inbox.length > 0 ? <button type="button" onClick={() => setFilterAttention(true)} className="mt-0.5 inline-flex min-h-11 cursor-pointer items-center text-xs text-amber-700 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary dark:text-amber-300" aria-label={`Show the ${inbox.length} card${inbox.length === 1 ? "" : "s"} that need attention`}>
                {inbox.length} {inbox.length === 1 ? "item needs" : "items need"} your attention
              </button> : null}
            </div>
            <div className="grid w-full grid-cols-2 gap-2 sm:mt-0.5 sm:flex sm:w-auto sm:items-center sm:gap-3">
              <Button className="min-h-11 w-full sm:w-auto sm:flex-none" onClick={() => setCreateOpen(true)}><Icon name="Plus" className="h-4 w-4" aria-hidden /> New research</Button>
              <BucketGalleryButton cards={grouped.inbox ?? []} />
              <Button className="min-h-11 w-full sm:w-auto sm:flex-none" variant="outline" onClick={() => setResearchPresetsOpen(true)} title="Manage agent presets and the research band default"><Icon name="Settings" className="h-4 w-4" aria-hidden /> Agent Presets</Button>
            </div>
          </header>

          <PresetOnboardingDialog
            storageKey={STORAGE_KEYS.onboardResearch}
            title="Choose your research agent preset"
            intro="Investigations run on the research band preset — set it once here, or pin a different preset per card in Manage."
            onOpenPresets={() => setResearchPresetsOpen(true)}
            active={active}
          />

          <CreateResearchDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            activeProjectId={activeProjectId}
            strategies={strategies}
            researchPreset={effectiveResearchPreset}
            hasBandPreset={Boolean(researchBandPreset)}
            bucketGallery={bucketGallery}
            onOpenPresets={() => setResearchPresetsOpen(true)}
          />

          <PresetManagerDialog
            open={researchPresetsOpen}
            onOpenChange={setResearchPresetsOpen}
            rpc={rpc}
            presets={presets}
            onChanged={() => load(researchProjectId ?? routeProjectId)}
          />

          <div className="flex items-start gap-2 border-b pb-3">
            <div className="min-w-0 flex-1">
              <FiltersBar
                projects={projects}
                filterProjectIds={filterProjectIds}
                filterAttention={filterAttention}
                onProjectToggle={(value) => setFilterProjectIds((prev) => toggleFilterValue(prev, value))}
                onAttention={setFilterAttention}
                onReset={() => { setFilterProjectIds([]); setFilterAttention(false); }}
              />
            </div>
            <ViewToggle view={viewMode} onChange={setViewMode} label="Research cards view" views={["board", "list"]} />
          </div>
          {viewMode === "board" ? (
          <p className="text-xs text-muted-foreground">
            <span className="sm:hidden">Swipe sideways to view every stage.</span>
            <span className="hidden sm:inline">Use Shift + scroll to move across stages.</span>
          </p>
          ) : null}
          {viewMode === "list" ? <ResearchList groups={grouped} navigate={navigate} strategyLabelById={strategyLabelById} collapsed={collapsedListGroups} onToggle={(column) => setCollapsedListGroups((current) => ({ ...current, [column]: !current[column] }))} /> : (
          <div data-testid="kanban-board" className="grid justify-start gap-3 overflow-x-auto md:h-[clamp(20rem,calc(100dvh-17rem),48rem)] md:overflow-y-hidden" style={{ gridTemplateColumns: kanbanGridColumns(VISIBLE_RESEARCH_COLUMNS, collapsedColumns) }}>
            {VISIBLE_RESEARCH_COLUMNS.map((column) => (
              <BoardColumn
                key={column}
                column={column}
                cards={grouped[column]}
                collapsed={Boolean(collapsedColumns[column])}
                onToggleCollapsed={() => setCollapsedColumns((current) => ({ ...current, [column]: !current[column] }))}
                onDrop={(cardId) => moveCard(cardId, column)}
                labels={RESEARCH_COLUMN_LABELS}
                renderCard={(card) => <ResearchCard card={card} strategyLabel={joinStrategyLabels(card.researchStrategies ?? [], strategyLabelById)} />}
              />
            ))}
          </div>
          )}
          </>}
        </div>
      </div>
    </div>
  );
}

function ExplorePanel({ active }: { active: boolean }) {
  const { projectId: routeProjectId } = useBbContext();
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [cards, setCards] = useState<CardItem[]>([]);
  const [stages, setStages] = useState<ResearchStrategyOption[]>([]);
  const [presets, setPresets] = useState<PresetManagerPreset[]>([]);
  const [researchBandPresets, setResearchBandPresets] = useState<{ band: string; presetId: string | null; stages: string[] }[]>([]);
  const [researchPresetsOpen, setResearchPresetsOpen] = useState(false);
  const [exploreProjectId, setExploreProjectId] = useState<string | null>(routeProjectId);
  const [collapsedColumns, setCollapsedColumns] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return { archived: true };
    try {
      const raw = window.localStorage.getItem(STORAGE_KEYS.exploreColumns);
      if (!raw) return { archived: true };
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      return typeof parsed === "object" && parsed ? parsed : { archived: true };
    } catch { return { archived: true }; }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(STORAGE_KEYS.exploreColumns, JSON.stringify(collapsedColumns)); } catch { /* ignore */ }
  }, [collapsedColumns]);
  const [loading, setLoading] = useState(true);
  // Background refreshes must never flash loading UI (see BoardPanel).
  const firstLoadRef = useRef(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [viewMode, setViewMode] = useBoardView(STORAGE_KEYS.exploreView);
  const [collapsedListGroups, setCollapsedListGroups] = useCollapsedGroups(STORAGE_KEYS.exploreListGroups);
  const [filterProjectIds, setFilterProjectIds] = useState<string[]>([]);
  const [filterAttention, setFilterAttention] = useState(false);

  const load = useCallback(async (targetId: string | null) => {
    if (firstLoadRef.current) setLoading(true);
    try {
      const [projectsResult, cardsResult, stagesResult, presetsResult, bandPresetsResult] = await Promise.all([
        rpc.call("projects", {}).catch(() => null),
        rpc.call("listCards", { projectId: targetId, kind: "explore" }).catch(() => ({ cards: [] })),
        rpc.call("stageCatalog", {}).catch(() => ({ stages: [] })),
        rpc.call("listPresets", {}).catch(() => ({ presets: [] })),
        rpc.call("listBandPresets", {}).catch(() => ({ bands: [] })),
      ]);
      setProjects(projectsResult?.projects ?? []);
      setCards(cardsResult.cards);
      setStages(stagesResult.stages);
      setPresets(presetsResult.presets);
      setResearchBandPresets(bandPresetsResult.bands);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load explore.");
      if (firstLoadRef.current) {
        setProjects([]);
        setCards([]);
      }
    } finally {
      setLoading(false);
      firstLoadRef.current = false;
    }
  }, [rpc]);

  useEffect(() => { void load(exploreProjectId ?? routeProjectId); }, [load, exploreProjectId, routeProjectId]);
  useDebouncedRealtime(["card-state", "board-changed", "inbox-changed"], () => void load(exploreProjectId ?? routeProjectId));

  const activeProjectId = exploreProjectId ?? routeProjectId;
  const defaultPreset = presets.find((preset) => preset.isDefault) ?? presets[0] ?? null;
  const exploreBandPreset = presets.find((preset) => preset.id === researchBandPresets.find((entry) => entry.band === "explore")?.presetId) ?? null;
  const effectiveExplorePreset = exploreBandPreset ?? defaultPreset;
  const stageLabelById = useMemo(() => new Map(stages.map((entry) => [entry.id, entry.label])), [stages]);
  const filteredCards = useMemo(() => cards.filter((card) => {
    if (!matchesFilterValue(filterProjectIds, card.projectId)) return false;
    if (filterAttention && !card.needsAttention) return false;
    return true;
  }), [cards, filterProjectIds, filterAttention]);
  const grouped = useMemo(() => {
    const groups: Record<string, CardItem[]> = Object.fromEntries(RESEARCH_COLUMNS.map((column) => [column, []]));
    for (const card of filteredCards) {
      (groups[researchColumnOf(card)] ?? groups.inbox).push(card);
    }
    for (const column of Object.keys(groups)) {
      groups[column]!.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return groups;
  }, [filteredCards]);
  // Captured pile for the creation checkbox link: same gallery as the
  // header Bucket button, opened from the "park in Bucket" copy.
  const bucketGallery = useBucketGallery(grouped.inbox ?? []);
  const inbox = cards.filter((card) => card.needsAttention && card.status !== "archived");

  async function moveCard(cardId: string, target: string) {
    if (!(RESEARCH_COLUMNS as readonly string[]).includes(target)) return;
    const result = await rpc.call("moveCard", { cardId, status: target as "inbox" | "doing" | "done" | "archived" });
    if (!result.ok) toast.error(result.error ?? "Move failed");
  }

  return (
    <div className="flex h-full overflow-hidden bg-background">
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto max-w-[1500px] space-y-4">
          {loading && cards.length === 0 ? <TrackSkeleton columns={4} /> : <>
          <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight">Explore</h1>
              <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">Choose a single technique from the {trackTitle("build")} workflow — an AI agent runs it on your input, returning a focused result on the card.</p>
              {inbox.length > 0 ? <button type="button" onClick={() => setFilterAttention(true)} className="mt-0.5 inline-flex min-h-11 cursor-pointer items-center text-xs text-amber-700 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary dark:text-amber-300" aria-label={`Show the ${inbox.length} card${inbox.length === 1 ? "" : "s"} that need attention`}>
                {inbox.length} {inbox.length === 1 ? "item needs" : "items need"} your attention
              </button> : null}
            </div>
            <div className="grid w-full grid-cols-2 gap-2 sm:mt-0.5 sm:flex sm:w-auto sm:items-center sm:gap-3">
              <Button className="min-h-11 w-full sm:w-auto sm:flex-none" onClick={() => setCreateOpen(true)}><Icon name="Plus" className="h-4 w-4" aria-hidden /> New exploration</Button>
              <BucketGalleryButton cards={grouped.inbox ?? []} />
              <Button className="min-h-11 w-full sm:w-auto sm:flex-none" variant="outline" onClick={() => setResearchPresetsOpen(true)} title="Manage agent presets and the band default"><Icon name="Settings" className="h-4 w-4" aria-hidden /> Agent Presets</Button>
            </div>
          </header>

          <PresetOnboardingDialog
            storageKey={STORAGE_KEYS.onboardExplore}
            title="Choose your exploration agent preset"
            intro="Explorations run on the explore band preset — set it once here, or pin a different preset per card in Manage."
            onOpenPresets={() => setResearchPresetsOpen(true)}
            active={active}
          />

          <CreateExploreDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            activeProjectId={activeProjectId}
            stages={stages}
            explorePreset={effectiveExplorePreset}
            hasBandPreset={Boolean(exploreBandPreset)}
            bucketGallery={bucketGallery}
            onOpenPresets={() => setResearchPresetsOpen(true)}
          />

          <PresetManagerDialog
            open={researchPresetsOpen}
            onOpenChange={setResearchPresetsOpen}
            rpc={rpc}
            presets={presets}
            onChanged={() => load(exploreProjectId ?? routeProjectId)}
          />

          <div className="flex items-start gap-2 border-b pb-3">
            <div className="min-w-0 flex-1">
              <FiltersBar
                projects={projects}
                filterProjectIds={filterProjectIds}
                filterAttention={filterAttention}
                onProjectToggle={(value) => setFilterProjectIds((prev) => toggleFilterValue(prev, value))}
                onAttention={setFilterAttention}
                onReset={() => { setFilterProjectIds([]); setFilterAttention(false); }}
              />
            </div>
            <ViewToggle view={viewMode} onChange={setViewMode} label="Explore cards view" views={["board", "list"]} />
          </div>
          {viewMode === "board" ? (
          <p className="text-xs text-muted-foreground">
            <span className="sm:hidden">Swipe sideways to view every stage.</span>
            <span className="hidden sm:inline">Use Shift + scroll to move across stages.</span>
          </p>
          ) : null}
          {viewMode === "list" ? <ExploreList groups={grouped} navigate={navigate} stageLabelById={stageLabelById} collapsed={collapsedListGroups} onToggle={(column) => setCollapsedListGroups((current) => ({ ...current, [column]: !current[column] }))} /> : (
          <div data-testid="kanban-board" className="grid justify-start gap-3 overflow-x-auto md:h-[clamp(20rem,calc(100dvh-17rem),48rem)] md:overflow-y-hidden" style={{ gridTemplateColumns: kanbanGridColumns(VISIBLE_RESEARCH_COLUMNS, collapsedColumns) }}>
            {VISIBLE_RESEARCH_COLUMNS.map((column) => (
              <BoardColumn
                key={column}
                column={column}
                cards={grouped[column]}
                collapsed={Boolean(collapsedColumns[column])}
                onToggleCollapsed={() => setCollapsedColumns((current) => ({ ...current, [column]: !current[column] }))}
                onDrop={(cardId) => moveCard(cardId, column)}
                labels={RESEARCH_COLUMN_LABELS}
                renderCard={(card) => <ExploreCard card={card} stageLabel={card.exploreStage ? (stageLabelById.get(card.exploreStage) ?? card.exploreStage) : null} />}
              />
            ))}
          </div>
          )}
          </>}
        </div>
      </div>
    </div>
  );
}

// localStorage keys in one place: board/research column collapse and the
// remembered track. Renaming a key is one line; readers never guess at
// raw strings scattered through panels.
const STORAGE_KEYS = {
  boardColumns: "stelow-columns-collapsed-v1",
  researchColumns: "stelow-research-columns-collapsed-v1",
  exploreColumns: "stelow-explore-columns-collapsed-v1",
  lastTab: "stelow-tab-v1",
  reviewGates: "stelow-review-gates-v1",
  onboardBuild: "stelow-onboard-build-v1",
  onboardResearch: "stelow-onboard-research-v1",
  onboardExplore: "stelow-onboard-explore-v1",
  onboardPresets: "stelow-onboard-presets-v1",
  buildListGroups: "stelow-build-list-groups-collapsed-v1",
  researchListGroups: "stelow-research-list-groups-collapsed-v1",
  exploreListGroups: "stelow-explore-list-groups-collapsed-v1",
  buildView: "stelow-build-view-v1",
  researchView: "stelow-research-view-v1",
  exploreView: "stelow-explore-view-v1",
} as const;

// Collapsible list-view groups with archived collapsed by default. Stored
// choices win over the default (spread after), matching the kanban column
// behavior; unknown keys are inert.
type BoardView = "board" | "list" | "hill";

// The board forgets nothing: returning from a card restores the view the
// human picked (board, list, or hill), per track. Unknown stored values
// degrade to board — a corrupt key must never strand the track.
function useBoardView(storageKey: string): [BoardView, (view: BoardView) => void] {
  const [viewMode, setViewMode] = useState<BoardView>(() => {
    if (typeof window === "undefined") return "board";
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw === "board" || raw === "list" || raw === "hill" ? raw : "board";
    } catch { return "board"; }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(storageKey, viewMode); } catch { /* ignore */ }
  }, [storageKey, viewMode]);
  return [viewMode, setViewMode];
}

function useCollapsedGroups(storageKey: string) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return { archived: true };
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return { archived: true };
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      return typeof parsed === "object" && parsed ? { archived: true, ...parsed } : { archived: true };
    } catch { return { archived: true }; }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(storageKey, JSON.stringify(collapsed)); } catch { /* ignore */ }
  }, [storageKey, collapsed]);
  return [collapsed, setCollapsed] as const;
}

type ParsedStelowRoute =
  | { kind: "track"; track: StelowTrack }
  | { kind: "card"; cardId: string; eventId: string | null; origin: StelowTrack }
  | { kind: "bare-card"; cardId: string; eventId: string | null };

// One panel, five tracks. Grammar (routes are panel-relative):
//   "" | "build"                 -> Build board ("" reopens the last tab)
//   "inbox"                      -> Inbox list
//   "research"                   -> Research board
//   "explore"                    -> Explore board
//   "about"                      -> About Stelow (no cards live here)
//   "<track>/card/<id>[/event/]" -> card detail, back returns to <track>
//   "card/<id>[/event/]"         -> trackless link: kind is resolved
//                                  live, then rendered with back to its track.
function parseStelowSubPath(subPath: string): ParsedStelowRoute {
  const normalized = subPath.replace(/^\/+|\/+$/g, "");
  if (normalized === "" || normalized === "build") return { kind: "track", track: "build" };
  if (normalized === "inbox") return { kind: "track", track: "inbox" };
  if (normalized === "research") return { kind: "track", track: "research" };
  if (normalized === "explore") return { kind: "track", track: "explore" };
  if (normalized === "about") return { kind: "track", track: "about" };
  let match = normalized.match(/^(inbox|build|research|explore)\/card\/(card_[A-Za-z0-9]+)(?:\/event\/(evt_[A-Za-z0-9]+))?$/);
  if (match) return { kind: "card", cardId: match[2]!, eventId: match[3] ?? null, origin: match[1] as StelowTrack };
  match = normalized.match(/^card\/(card_[A-Za-z0-9]+)(?:\/event\/(evt_[A-Za-z0-9]+))?$/);
  if (match) return { kind: "bare-card", cardId: match[1]!, eventId: match[2] ?? null };
  return { kind: "track", track: "build" };
}

function StelowTabBar({ tab, counts, aboutAlert, onSelect }: {
  tab: StelowTrack;
  counts: { inbox: number; build: number; research: number; explore: number; about: number };
  aboutAlert?: boolean;
  onSelect: (track: StelowTrack) => void;
}) {
  const countFor = (key: StelowTrack) => counts[key];
  // Route navigation, not tab panels: each track is its own subPath route,
  // so this is a nav with aria-current (the GitHub repo-tabs pattern) —
  // never a tablist, which would promise tabpanels and arrow-key behavior
  // that routed views don't have.
  return (
    <nav aria-label="Stelow tracks" className="flex max-w-full shrink-0 items-center gap-1 overflow-x-auto border-b bg-card/80 px-2 py-1.5 sm:px-3">
      {STELOW_TRACKS.map((entry) => {
        const active = tab === entry.key;
        const count = countFor(entry.key);
        return (
          <button
            key={entry.key}
            aria-current={active ? "page" : undefined}
            onClick={() => onSelect(entry.key)}
            title={entry.key === "inbox" ? "Things that need you, plus recent completions" : entry.key === "build" ? "Build board" : entry.key === "research" ? "Research board" : entry.key === "explore" ? "Single-technique runs" : "What Stelow is"}
            className={`inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:px-3 sm:text-sm ${active ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          >
            <Icon name={entry.icon} className="h-4 w-4" aria-hidden />
            <span>{entry.title}</span>
            {entry.key === "about" ? (aboutAlert ? <UpdateBadge /> : null) : (
              <span className={`rounded-full px-1.5 py-0.5 text-2xs font-medium tabular-nums ${active ? "bg-background/20 text-background" : "bg-muted text-muted-foreground"}`}>{count}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

function StelowCardDetail({ cardId, eventId, backTrack, navigate }: {
  cardId: string; eventId: string | null; backTrack: StelowTrack; navigate: ReturnType<typeof useBbNavigate>;
}) {
  const back = () => goToTrack(navigate, backTrack);
  return (
    <CardDetailBody cardId={cardId} inboxEventId={eventId} onClose={back} onBack={back} navigate={navigate} />
  );
}

// Bare card link (card/<id> without a track prefix): the track is unknown until
// the card loads, so resolve the kind live and render with back to its
// track. New code always links track-prefixed routes instead.
function BareCardRoute({ cardId, eventId, navigate }: {
  cardId: string; eventId: string | null; navigate: ReturnType<typeof useBbNavigate>;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [kind, setKind] = useState<"build" | "research" | "explore" | null>(null);
  useEffect(() => {
    let cancelled = false;
    setKind(null);
    void rpc.call("listCards", { projectId: null }).then((result) => {
      if (cancelled) return;
      const found = result.cards.find((entry) => entry.id === cardId);
      setKind(found ? found.kind : "build");
    }).catch(() => { if (!cancelled) setKind("build"); });
    return () => { cancelled = true; };
  }, [cardId, rpc]);
  if (!kind) return <div className="p-4"><PanelSkeleton rows={4} /></div>;
  return <StelowCardDetail cardId={cardId} eventId={eventId} backTrack={trackOfCard({ kind })} navigate={navigate} />;
}

// About track: what Stelow is vs what this plugin adds — one section each,
// each with its own repo link and its own version, so the two releases can
// never be mistaken for each other. No cards live here.
// Optional host binaries the workflow knows how to use. Presence is probed
// live on the host (toolStatus); install commands are the canonical
// one-liners from the upstream README's External Dependencies section.
// Everything here is opt-in and fail-soft — the plugin never installs
// unless you press the button (explicit consent), and every capability
// keeps working with its built-in fallback until then.
const HOST_TOOLS: Array<{ id: "ast-grep" | "cymbal" | "ripwire" | "sem"; name: string; repo: string; plain: string; tech: string; install: string }> = [
  { id: "ast-grep", name: "ast-grep", repo: "https://github.com/ast-grep/ast-grep", plain: "Find code patterns and rename across files without touching text inside strings — when refactoring.", tech: "Structural AST search with safe rewrite; used for refactors that change signatures.", install: "npm install -g @ast-grep/cli" },
  { id: "cymbal", name: "cymbal", repo: "https://github.com/1broseidon/cymbal", plain: "See who calls each function and what breaks if you change it — before touching code.", tech: "Symbol graph (refs, impact, trace); used in Tech Preview, Feature Recon and Alignment Check.", install: "brew install 1broseidon/tap/cymbal" },
  { id: "ripwire", name: "ripwire", repo: "https://github.com/redhat-et/ripwire", plain: "First read of an unfamiliar codebase: what matters, where to enter, what to test.", tech: "Token-budgeted symbol map (symbols, callers, blast radius).", install: "RIPWIRE_REPO=redhat-et/ripwire bash -c \"$(curl -fsSL https://raw.githubusercontent.com/redhat-et/ripwire/main/scripts/install.sh)\"" },
  { id: "sem", name: "sem", repo: "https://github.com/Ataraxy-Labs/sem", plain: "Tell which functions and types changed — not just which lines — including renames.", tech: "Entity-level diff via tree-sitter; powers the Diff summary and agent audits.", install: "curl -fsSL https://raw.githubusercontent.com/Ataraxy-Labs/sem/main/install.sh | sh" },
];

// Resolved on demand through npx — no host install, nothing to probe, no
// buttons. Listed so the full dependency surface is visible in one place;
// each entry names who consumes it and under which consent. No commands
// shown: you never run anything here, workers resolve it automatically.
const NPX_TOOLS: Array<{ name: string; repo?: string; plain: string; tech: string }> = [
  { name: "npx skills", repo: "https://github.com/vercel-labs/skills", plain: "The skills hub workers use to fetch playbooks and stack-matched skills on demand.", tech: "Ships with Node.js; invoked per use, never installed globally by the plugin." },
  { name: "ctx7", repo: "https://github.com/upstash/context7", plain: "Current, version-specific library docs while writing code — never for choosing the stack.", tech: "Auto-installs on first npx invocation; guided OAuth setup (terminal) only raises limits." },
  { name: "last30days", repo: "https://github.com/mvanhorn/last30days-skill", plain: "Social recency signal for market research — complementary source only.", tech: "Agent skill, never a binary; workers add it per use, only with your confirmation." },
  { name: "agent-reach", repo: "https://github.com/Panniantong/agent-reach", plain: "Fetch router for platform evidence (incl. Bilibili/Xiaohongshu) — fetch only, never synthesis.", tech: "Agent skill + local CLIs; workers add it per use, only with your confirmation. Login channels need your browser session or cookies — use a secondary account, never the primary." },
  { name: "thermo-nuclear", repo: "https://github.com/cursor/plugins/tree/main/cursor-team-kit/skills/thermo-nuclear-code-quality-review", plain: "Optional ultra-strict final code review, gated by appetite and risk.", tech: "Agent skill from the cursor/plugins hub package; documented manual checks apply when absent." },
];

function HostToolsSection({ tools, onInstall, installingId, errors }: {
  tools: Array<{ id: string; present: boolean; version: string | null }> | null;
  onInstall: (id: "ast-grep" | "cymbal" | "ripwire" | "sem") => void;
  installingId: string | null;
  errors: Record<string, string>;
}) {
  const byId = new Map((tools ?? []).map((tool) => [tool.id, tool]));
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-foreground">Optional tools</h2>
      <p className="text-sm leading-6 text-muted-foreground">
        Recommended by Stelow, honored here. Workers use these tools when present; without one, the same step still works with the built-in fallback — just with less depth. Install anytime; effects apply on next use.{" "}
        <UrlLink href="https://github.com/calionauta/stelow#external-dependencies" className="underline underline-offset-4 hover:text-foreground">Learn more ↗</UrlLink>
      </p>
      {!tools ? <p className="text-xs text-muted-foreground">Checking host tools…</p> : (
      <div className="space-y-2">
        {HOST_TOOLS.map((meta) => {
          const hit = byId.get(meta.id);
          const present = hit?.present === true;
          const busy = installingId === meta.id;
          const error = errors[meta.id];
          return (
            <div key={meta.id} className="rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center gap-2">
                <span aria-hidden className={present ? "text-emerald-500" : "text-muted-foreground/50"}>{present ? "●" : "○"}</span>
                <span className="font-mono text-xs font-semibold text-foreground">{meta.name}</span>
                <UrlLink href={meta.repo} title={`${meta.name} repository`} className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:border-primary/50 hover:text-foreground"><Icon name="Github" className="h-3.5 w-3.5" aria-hidden /></UrlLink>
                <span className="text-[11px] text-muted-foreground">{present ? (hit?.version ?? "installed") : "not installed"}</span>
                {!present ? (
                  <span className="ml-auto">
                    <Button size="sm" variant="outline" disabled={busy || installingId !== null} onClick={() => onInstall(meta.id)} title={`Install ${meta.name} now`}>
                      {busy ? "Installing…" : "Install"}
                    </Button>
                  </span>
                ) : null}
                {present ? (
                  <span className="ml-auto">
                    <Button size="sm" variant="ghost" disabled={busy || installingId !== null} onClick={() => onInstall(meta.id)} title={`Reinstall ${meta.name} at its latest release`}>
                      {busy ? "Updating…" : "Update"}
                    </Button>
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{meta.plain}</p>
              <p className="mt-0.5 font-mono text-[11px] leading-5 text-muted-foreground/80">{meta.tech}</p>
              {!present && !busy ? <pre className="mt-1.5 overflow-x-auto rounded-md border bg-background/60 p-2 font-mono text-[11px] leading-relaxed">{meta.install}</pre> : null}
              {busy ? <p className="mt-1.5 text-[11px] text-muted-foreground">Installing — can take a couple minutes. The row flips to ● on success.</p> : null}
              {error ? (
                <div className="mt-1.5 space-y-1">
                  <p className="text-[11px] text-destructive">Install failed: {error.split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 220) ?? "unknown error"}</p>
                  <details className="group">
                    <summary className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"><DisclosureChevron />Install log</summary>
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border bg-background/60 p-2 font-mono text-[11px] leading-relaxed">{error}</pre>
                  </details>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      )}
      <h3 className="pt-2 text-sm font-semibold text-foreground">Ready via npx — no install needed</h3>
      <p className="text-xs leading-5 text-muted-foreground">You never run anything below — workers resolve these automatically when a step needs them. Listed so every dependency Stelow touches is visible.</p>
      <div className="space-y-2">
        {NPX_TOOLS.map((meta) => (
          <div key={meta.name} className="rounded-lg border bg-muted/20 p-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold text-foreground">{meta.name}</span>
              {meta.repo ? (
                <UrlLink href={meta.repo} title={`${meta.name} repository`} className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:border-primary/50 hover:text-foreground"><Icon name="Github" className="h-3.5 w-3.5" aria-hidden /></UrlLink>
              ) : null}
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{meta.plain}</p>
            <p className="mt-0.5 font-mono text-[11px] leading-5 text-muted-foreground/80">{meta.tech}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

type PluginUpdateInfo = {
  outcome: "checking" | "update-available" | "current" | "incompatible" | "pinned" | "unavailable";
  installed: string | null;
  installedDisplay: string | null;
  candidate: string | null;
  candidateDisplay: string | null;
  detail: string | null;
  checkedAt: number | null;
};
type GithubReleaseInfo = { tag: string; url: string; checkedAt: number; newer: boolean } | null;

// Update status for the About panel: one tone-coded box directly under the
// plugin title, so the verdict, the apply action, and the freshness check
// read together next to the version they describe. role="status" announces
// state changes to assistive tech; the leading mark is decorative
// (aria-hidden) because the title text names the state.
function PluginUpdateStatus({ version, update, github, confirming, updating, checking, onCheck, onConfirm, onCancel, onApply }: {
  version: string;
  update: PluginUpdateInfo;
  github: GithubReleaseInfo;
  confirming: boolean;
  updating: boolean;
  checking: boolean;
  onCheck: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  const tone = update.outcome === "current" ? "text-emerald-500"
    : update.outcome === "update-available" ? "text-amber-500"
    : "text-muted-foreground/60";
  const title = update.outcome === "update-available"
    ? (confirming
      ? `Update from ${shortRef(update.installed, update.installedDisplay) ?? "the installed version"} to ${shortRef(update.candidate, update.candidateDisplay) ?? "the latest version"}?`
      : `Update available — ${shortRef(update.candidate, update.candidateDisplay) ?? "a new version"}`)
    : update.outcome === "current"
      ? "Up to date"
      : update.outcome === "checking"
        ? "Checking BB for a compatible plugin update…"
        : update.outcome === "pinned" || update.outcome === "incompatible"
          ? "Not updated through BB"
          : "Update check unavailable";
  const unmanaged = update.outcome === "pinned" || update.outcome === "incompatible" || update.outcome === "unavailable";
  // Only path installs take the manual path (checkout pull + rebuild +
  // reload); every other source is BB-managed, so manual instructions
  // must never reach users who have no checkout.
  const pathInstall = isPathInstall(update.installedDisplay);
  return (
    <div role="status" className="space-y-2 rounded-lg border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
      <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        {update.outcome === "update-available" ? <UpdateBadge label={null} /> : <span aria-hidden className={tone}>●</span>}{title}
      </p>
      {update.outcome === "update-available" ? (
        confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={updating} onClick={onApply}>{updating ? "Updating…" : "Confirm update"}</Button>
            <Button size="sm" variant="ghost" disabled={updating} onClick={onCancel}>Cancel</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={onConfirm} title="Apply the update and reload Stelow">Update plugin…</Button>
          </div>
        )
      ) : null}
      {update.outcome === "update-available" ? <p>Stelow reloads afterwards.</p> : null}
      {update.outcome === "update-available" && update.detail ? <p>{update.detail} — showing the last known verdict; Check update retries.</p> : null}
      {unmanaged && update.detail ? <p>{update.detail}</p> : null}
      {unmanaged && !update.detail && pathInstall ? <p>BB reports this install as not updatable through BB itself — local checkouts update with git pull, rebuild, and reload. “Check update” refreshes BB’s verdict and the GitHub release lookup together.</p> : null}
      {unmanaged && !update.detail && !pathInstall ? <p>BB can’t apply an update to this install automatically right now. “Check update” re-checks; new releases appear here once BB can apply them.</p> : null}
      {unmanaged && pathInstall && github && !github.newer && version !== "dev" && version.replace(/^v/, "") === github.tag.replace(/^v/, "") ? (
        <p>Matches {github.tag} on GitHub — this checkout is current.</p>
      ) : null}
      {unmanaged && github?.newer ? (
        <p className="text-amber-700 dark:text-amber-300">
          <UrlLink href={github.url} className="underline underline-offset-4 hover:text-foreground">{github.tag} is published on GitHub ↗</UrlLink>
          {" "}{pathInstall ? "— pull the checkout, rebuild, and reload to run it." : "— it will be offered here once BB can apply it."}
        </p>
      ) : null}
      {update.outcome === "checking" ? null : (
        <p>
          {update.checkedAt ? `Last checked ${relativeTime(update.checkedAt)} · ` : null}
          <button
            type="button"
            onClick={onCheck}
            disabled={checking}
            className="cursor-pointer underline decoration-dotted underline-offset-2 hover:text-foreground disabled:cursor-default disabled:opacity-60"
          >
            {checking ? "Checking…" : "Check update"}
          </button>
        </p>
      )}
    </div>
  );
}

function AboutPanel() {
  const rpc = useRpc<typeof rpcContract>();
  const [buildInfo, setBuildInfo] = useState<{ version: string; builtAt: string | null; stelowVersion: string | null; skills: string[]; pluginUpdate: PluginUpdateInfo; githubRelease: GithubReleaseInfo } | null>(null);
  const [aboutLogo, setAboutLogo] = useState<string | null>(null);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [hostTools, setHostTools] = useState<Array<{ id: string; present: boolean; version: string | null }> | null>(null);
  const [installingToolId, setInstallingToolId] = useState<string | null>(null);
  const [installErrors, setInstallErrors] = useState<Record<string, string>>({});
  function installHostTool(id: "ast-grep" | "cymbal" | "ripwire" | "sem") {
    setInstallingToolId(id);
    setInstallErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    void rpc.call("installTool", { id }).then((result) => {
      if (result.ok) {
        void rpc.call("toolStatus", {}).then((status) => setHostTools(status.tools)).catch(() => undefined);
      } else {
        setInstallErrors((prev) => ({ ...prev, [id]: result.log || "Install failed." }));
      }
    }).catch((error) => {
      setInstallErrors((prev) => ({ ...prev, [id]: error instanceof Error ? error.message : "Install failed." }));
    }).finally(() => setInstallingToolId(null));
  }
  // Two-step reset: first click arms the confirm, second clears all four
  // onboarding keys so each track shows its setup dialogs again on visit.
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmPluginUpdate, setConfirmPluginUpdate] = useState(false);
  const [updatingPlugin, setUpdatingPlugin] = useState(false);
  const [checkingPluginUpdate, setCheckingPluginUpdate] = useState(false);
  const [pluginUpdateError, setPluginUpdateError] = useState<string | null>(null);
  const [pluginUpdateNotice, setPluginUpdateNotice] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void rpc.call("buildInfo", {}).then((result) => { if (cancelled) return; setBuildInfo(result); setPluginUpdateAvailable(updateAvailableFrom(result)); }).catch(() => undefined);
    void rpc.call("aboutLogo", {}).then((result) => { if (!cancelled && result.dataUri) setAboutLogo(result.dataUri); }).catch(() => undefined);
    void rpc.call("toolStatus", {}).then((result) => { if (!cancelled) setHostTools(result.tools); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [rpc]);
  function resetOnboarding() {
    try {
      window.localStorage.removeItem(STORAGE_KEYS.onboardBuild);
      window.localStorage.removeItem(STORAGE_KEYS.onboardResearch);
      window.localStorage.removeItem(STORAGE_KEYS.onboardExplore);
      window.localStorage.removeItem(STORAGE_KEYS.onboardPresets);
    } catch { /* best-effort */ }
    setConfirmReset(false);
    toast.success("Onboarding reset — Build, Research, and Explore open their setup dialogs again on visit.");
  }
  function applyPluginUpdate() {
    setUpdatingPlugin(true); setPluginUpdateError(null); setPluginUpdateNotice(null);
    // Applying swaps the server bundle and reloads the plugin. That reload can
    // sever the RPC channel mid-call, leaving the promise pending forever (no
    // resolve, no reject) — so timebox the quiet phase and, if nothing settles,
    // say the reload is happening instead of spinning on "Updating…" with no
    // verdict. A clean apply that never settles only does so because the
    // reload cut the channel, so the reloading message is the honest one.
    const APPLY_SETTLE_MS = 15_000;
    let settled = false;
    const settle = () => { if (settled) return; settled = true; setUpdatingPlugin(false); setConfirmPluginUpdate(false); };
    const timer = window.setTimeout(() => {
      setPluginUpdateNotice("Update applied — Stelow is reloading; the new version appears shortly.");
      settle(); // the caller's component may have unmounted with the reload; a late settle is a no-op
    }, APPLY_SETTLE_MS);
    let applied = false;
    void rpc.call("applyPluginUpdate", {}).then((result) => {
      window.clearTimeout(timer);
      applied = result.applied;
      if (!result.applied) {
        setPluginUpdateError(result.detail ?? "BB did not apply an update.");
        settle();
        return;
      }
      toast.success(`Plugin updated to ${shortRef(result.to, null) ?? "the latest compatible version"}.`);
      return rpc.call("buildInfo", {}).then((info) => {
        if (info) { setBuildInfo(info); setPluginUpdateAvailable(updateAvailableFrom(info)); }
        else setPluginUpdateNotice("Update applied — Stelow is reloading; the new version appears shortly.");
        settle();
      });
    }).catch((error) => {
      window.clearTimeout(timer);
      if (applied) setPluginUpdateNotice("Update applied — Stelow is reloading; the new version appears shortly.");
      else setPluginUpdateError(error instanceof Error ? error.message : "Plugin update failed.");
      settle();
    });
  }
  function recheckPluginUpdate() {
    setCheckingPluginUpdate(true); setPluginUpdateError(null); setPluginUpdateNotice(null); setConfirmPluginUpdate(false);
    void rpc.call("checkPluginUpdate", {}).then((update) => {
      setBuildInfo((prev) => prev ? { ...prev, pluginUpdate: update.pluginUpdate, githubRelease: update.githubRelease } : prev);
      // A forced check is the freshest verdict there is: publish it to every
      // surface at once instead of letting one component own the news.
      setPluginUpdateAvailable(updateAvailableFrom(update));
    }).catch((error) => {
      setPluginUpdateError(error instanceof Error ? error.message : "Update check failed.");
    }).finally(() => setCheckingPluginUpdate(false));
  }
  return (
    <>
    <div className="flex h-full overflow-hidden bg-background">
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto max-w-[1500px] space-y-4">
          <header>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="text-xl font-semibold tracking-tight">About</h1>
              {buildInfo && updateAvailableFrom(buildInfo) ? <UpdateBadge /> : null}
            </div>
          </header>
          <div className="grid max-w-2xl gap-5">
            <section className="space-y-2">
              {aboutLogo ? (
                <div className="flex justify-center py-1">
                  <img src={aboutLogo} alt="Stelow — Your Product Team" className="w-56 max-w-full object-contain sm:w-64" />
                </div>
              ) : null}
              <h2 className="text-base font-semibold text-foreground">
                Stelow {buildInfo?.stelowVersion ? <span className="text-[11px] font-normal text-muted-foreground">v{buildInfo.stelowVersion}</span> : null}
              </h2>
              <p className="text-sm leading-6 text-muted-foreground">Stelow helps humans and AI agents operate as a cross-functional product team, not just coding assistants, through a structured product workflow.</p>
              <div>
                <UrlLink href="https://github.com/calionauta/stelow" className="inline-flex h-8 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md border bg-card px-3 text-xs font-medium shadow-sm hover:border-primary/50"><Icon name="Github" className="h-3.5 w-3.5" aria-hidden />Stelow repo <span aria-hidden="true">↗</span></UrlLink>
              </div>
            </section>
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-foreground">
                bb-plugin-stelow {buildInfo ? <span className="text-[11px] font-normal text-muted-foreground" title={buildInfo.builtAt ? `Built ${new Date(buildInfo.builtAt).toLocaleString()}` : "Running build"}>v{buildInfo.version}</span> : null}
              </h2>
              <div className="rounded-lg border bg-muted/20 p-3">
                <h3 className="text-sm font-semibold text-foreground">Status</h3>
                {buildInfo ? (
                <div className="mt-2">
                <PluginUpdateStatus
                  version={buildInfo.version}
                  update={buildInfo.pluginUpdate}
                  github={buildInfo.githubRelease}
                  confirming={confirmPluginUpdate}
                  updating={updatingPlugin}
                  checking={checkingPluginUpdate}
                  onCheck={recheckPluginUpdate}
                  onConfirm={() => setConfirmPluginUpdate(true)}
                  onCancel={() => setConfirmPluginUpdate(false)}
                  onApply={applyPluginUpdate}
                />
                {pluginUpdateError ? <p className="mt-2 text-xs text-destructive" role="alert">{pluginUpdateError}</p> : null}
                {pluginUpdateNotice ? <p className="mt-2 text-xs text-primary" role="status">{pluginUpdateNotice}</p> : null}
                </div>
                ) : (
                <p className="mt-1 text-xs text-muted-foreground">Checking status…</p>
                )}
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <h3 className="text-sm font-semibold text-foreground">What this plugin gives you</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">This plugin hosts Stelow inside bb: Build, Research, and Explore boards, a quiet inbox that only interrupts when the agent needs you, and a worker CLI with deterministic artifact checks.</p>
              {buildInfo ? (
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <p className="flex items-center gap-1.5">
                    <span aria-hidden className="text-emerald-500">●</span>
                    <button type="button" onClick={() => setSkillsOpen(true)} className="cursor-pointer underline decoration-dotted underline-offset-2 hover:text-foreground" title={`Pinned to Stelow ${buildInfo.stelowVersion ?? "at this plugin release"} — click to see which skills shipped`}>
                      {buildInfo.skills.length} skills · pinned to Stelow {buildInfo.stelowVersion ?? "this release"}
                    </button>
                  </p>
                  <p>Skills refresh with plugin updates — this pin names the methodology this build carries.</p>
                </div>
              ) : null}
                <p className="mt-2 text-xs leading-5 text-muted-foreground">Working as a team? bb is single-user — <UrlLink href="https://calionauta.github.io/stelow/#teams" className="cursor-pointer underline decoration-dotted underline-offset-2 hover:text-foreground">see the experimental team playbook</UrlLink>: one bb per teammate, GitHub as the team room.</p>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <h3 className="text-sm font-semibold text-foreground">Resources & maintenance</h3>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                <UrlLink href="https://github.com/calionauta/bb-plugin-stelow" className="inline-flex h-8 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md border bg-card px-3 text-xs font-medium shadow-sm hover:border-primary/50"><Icon name="Github" className="h-3.5 w-3.5" aria-hidden />Plugin repo <span aria-hidden="true">↗</span></UrlLink>
                {confirmReset ? (
                  <>
                    <Button size="sm" variant="destructive" onClick={resetOnboarding} title="Clear onboarding state so every track shows its setup dialog again">Confirm reset</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>Cancel</Button>
                  </>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setConfirmReset(true)} title="Show the first-visit setup dialogs again">Reset onboarding</Button>
                )}
                </div>
              </div>
              </section>
              <HostToolsSection tools={hostTools} onInstall={installHostTool} installingId={installingToolId} errors={installErrors} />
            </div>
        </div>
      </div>
    </div>
    <Dialog open={skillsOpen} onOpenChange={setSkillsOpen}>
      <DialogContent className="max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Vendored Stelow skills</DialogTitle>
          <DialogDescription>
            Pinned to Stelow {buildInfo?.stelowVersion ?? "this plugin release"}. Workers load these exact files from the plugin — no network or silent updates at card time.
          </DialogDescription>
        </DialogHeader>
        {(["stelow-workflow-", "stelow-product-"] as const).map((prefix) => {
          const group = (buildInfo?.skills ?? []).filter((name) => name.startsWith(prefix));
          if (!group.length) return null;
          return (
            <div key={prefix} className="mt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {prefix === "stelow-workflow-" ? "Workflow" : "Product playbooks"} ({group.length})
              </h3>
              <ul className="mt-1 space-y-0.5">
                {group.map((name) => (
                  <li key={name} className="font-mono text-xs text-foreground">{name.replace(prefix, "")}</li>
                ))}
              </ul>
            </div>
          );
        })}
        <div className="mt-4">
          <UrlLink href="https://github.com/calionauta/stelow/tree/main/skills" className="inline-flex h-8 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md border bg-card px-3 text-xs font-medium shadow-sm hover:border-primary/50"><Icon name="Github" className="h-3.5 w-3.5" aria-hidden />Upstream skills ↗</UrlLink>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}

function StelowPanel({ subPath }: { subPath: string }) {
  const navigate = useBbNavigate();
  const route = useMemo(() => parseStelowSubPath(subPath), [subPath]);
  const inbox = useInboxAccessory();
  const build = useBuildAccessory();
  const research = useResearchAccessory();
  const [lastTab, setLastTab] = useState<StelowTrack>(() => {
    if (typeof window === "undefined") return "inbox";
    try {
      const raw = window.localStorage.getItem(STORAGE_KEYS.lastTab);
      if (raw === "inbox" || raw === "build" || raw === "research" || raw === "explore" || raw === "about") return raw;
    } catch { /* default below */ }
    return "inbox";
  });
  // Remember the last visited track so the bare root reopens where you were.
  // The bare root itself only reads — persisting it would overwrite the
  // memory with the fallback on every fresh entry.
  useEffect(() => {
    if (route.kind !== "track") return;
    if (subPath.replace(/^\/+|\/+$/g, "") === "") return;
    setLastTab(route.track);
    try { window.localStorage.setItem(STORAGE_KEYS.lastTab, route.track); } catch { /* ignore */ }
  }, [route, subPath]);
  const goTrack = useCallback((track: StelowTrack) => {
    goToTrack(navigate, track);
  }, [navigate]);
  const aboutAlert = usePluginUpdateSignal();

  if (route.kind === "card") {
    return <StelowCardDetail cardId={route.cardId} eventId={route.eventId} backTrack={route.origin} navigate={navigate} />;
  }
  if (route.kind === "bare-card") {
    return <BareCardRoute cardId={route.cardId} eventId={route.eventId} navigate={navigate} />;
  }
  // The bare root reopens the last visited track; explicit track routes
  // always win (otherwise clicking Build while lastTab is Research would
  // visibly do nothing).
  const bare = subPath.replace(/^\/+|\/+$/g, "") === "";
  const tab = bare ? lastTab : route.track;
  const counts = { inbox: inbox.count, build: build.count, research: research.count, explore: 0, about: 0 };
  // Keep-alive: all tracks stay mounted and only the active one
  // shows. Tab switches are instant (no reload flash) and every track
  // keeps its realtime subscription warm. First mount still loads once —
  // data has to come from somewhere.
  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <StelowTabBar tab={tab} counts={counts} aboutAlert={aboutAlert} onSelect={goTrack} />
      <div className={tab === "inbox" ? "min-h-0 flex-1" : "hidden"}>
        <InboxPanel />
      </div>
      <div className={tab === "build" ? "min-h-0 flex-1" : "hidden"}>
        <BoardPanel active={tab === "build"} />
      </div>
      <div className={tab === "research" ? "min-h-0 flex-1" : "hidden"}>
        <ResearchPanel active={tab === "research"} />
      </div>
      <div className={tab === "explore" ? "min-h-0 flex-1" : "hidden"}>
        <ExplorePanel active={tab === "explore"} />
      </div>
      <div className={tab === "about" ? "min-h-0 flex-1" : "hidden"}>
        <AboutPanel />
      </div>
    </div>
  );
}

// One filter bar for both boards (Archetype A: same components, same
// affordances). Project + attention are the shared facets; build adds
// Facets are multi-select arrays (empty means all) shared by every board:
// stage/type/status/activity by passing values + toggle handler. Facets
// without a handler are not rendered — Research gets the identical popover,
// pills, and checkboxes without a forked filter row. Selected values render
// as removable pills beside the Filters button (attention-pill pattern);
// the popover holds checkbox lists (native inputs, keyboard-first) instead
// of single selects and autocomplete widgets.
type FilterFacet = { values: string[]; options: Array<{ value: string; label: string }>; onToggle: (value: string) => void };
function FiltersBar({ projects, filterProjectIds, filterAttention, onProjectToggle, onAttention, onReset, stageOptions, filterStages, onStageToggle, filterIntents, onIntentToggle, filterStatuses, onStatusToggle, filterActivities, onActivityToggle }: {
  projects: Project[];
  filterProjectIds: string[];
  filterAttention: boolean;
  onProjectToggle: (v: string) => void;
  onAttention: (v: boolean) => void;
  onReset: () => void;
  stageOptions?: string[];
  filterStages?: string[];
  onStageToggle?: (v: string) => void;
  filterIntents?: string[];
  onIntentToggle?: (v: string) => void;
  filterStatuses?: string[];
  onStatusToggle?: (v: string) => void;
  filterActivities?: string[];
  onActivityToggle?: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  // The popover is a lightweight dialog, not a modal: clicking outside or
  // pressing Escape dismisses it, like Done does. Selections apply live,
  // so dismissing never loses filter state.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  const projectOptions = useMemo(() => projects.map((project) => ({ value: project.id, label: project.name })), [projects]);
  const stageOptionsList = useMemo(() => (stageOptions ?? []).map((stage) => ({ value: stage, label: stageLabel(stage) })), [stageOptions]);
  const facets: Array<{ label: string } & FilterFacet> = [
    { label: "Project", values: filterProjectIds, options: projectOptions, onToggle: onProjectToggle },
    ...(onIntentToggle && filterIntents ? [{ label: "Type", values: filterIntents, options: FILTER_INTENT_OPTIONS, onToggle: onIntentToggle }] : []),
    ...(onStatusToggle && filterStatuses ? [{ label: "Status", values: filterStatuses, options: FILTER_STATUS_OPTIONS, onToggle: onStatusToggle }] : []),
    ...(onStageToggle && filterStages ? [{ label: "Stage", values: filterStages, options: stageOptionsList, onToggle: onStageToggle }] : []),
    ...(onActivityToggle && filterActivities ? [{ label: "Activity", values: filterActivities, options: FILTER_ACTIVITY_OPTIONS, onToggle: onActivityToggle }] : []),
  ];
  const activeCount = facets.reduce((total, facet) => total + facet.values.length, 0) + (filterAttention ? 1 : 0);
  const removePill = (facet: { label: string } & FilterFacet, value: string) => facet.onToggle(value);
  return (
    <div ref={wrapRef} className="relative flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition ${activeCount > 0 ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}
      >
        <span aria-hidden>⚙</span>
        <span>Filters</span>
        {activeCount > 0 ? <span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground" aria-label={`${activeCount} active filter${activeCount === 1 ? "" : "s"}`}>{activeCount}</span> : null}
      </button>
      {facets.flatMap((facet) => facet.values.map((value) => {
        const option = facet.options.find((entry) => entry.value === value);
        return (
          <button key={`${facet.label}:${value}`} onClick={() => removePill(facet, value)} className="cursor-pointer inline-flex h-7 items-center gap-1 rounded-full border border-primary bg-primary/10 px-3 text-xs font-medium text-foreground hover:text-foreground" aria-label={`Remove ${facet.label} filter ${option?.label ?? value}`}>
            <span>{option?.label ?? value}</span>
            <span aria-hidden className="ml-1">×</span>
          </button>
        );
      }))}
      {filterAttention ? <button onClick={() => onAttention(!filterAttention)} className="cursor-pointer inline-flex h-7 items-center gap-1.5 rounded-full border border-amber-500 bg-amber-500/15 px-3 text-xs font-medium text-amber-700 dark:text-amber-300" aria-label="Remove attention filter" aria-pressed="true">
        <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
        Needs attention
        <span aria-hidden className="ml-1">×</span>
      </button> : null}
      {activeCount > 0 ? <button onClick={onReset} className="cursor-pointer inline-flex h-7 items-center rounded-full border bg-background px-3 text-xs text-muted-foreground hover:text-foreground">Clear</button> : null}
      {open ? (
        <div role="dialog" aria-label="Filters" className="absolute left-0 top-10 z-20 w-[min(36rem,calc(100vw-2rem))] rounded-md border bg-card p-3 shadow-lg">
          <div className="grid gap-3 sm:grid-cols-2">
            <FilterMultiSelect label="Project" values={filterProjectIds} options={projectOptions} onToggle={onProjectToggle} />
            {onIntentToggle && filterIntents ? <FilterMultiSelect label="Type" values={filterIntents} options={FILTER_INTENT_OPTIONS} onToggle={onIntentToggle} /> : null}
            {onStatusToggle && filterStatuses ? <FilterMultiSelect label="Status" values={filterStatuses} options={FILTER_STATUS_OPTIONS} onToggle={onStatusToggle} /> : null}
            {onStageToggle && filterStages ? <FilterMultiSelect label="Stage" values={filterStages} options={stageOptionsList} onToggle={onStageToggle} /> : null}
            {onActivityToggle && filterActivities ? <FilterMultiSelect label="Activity" values={filterActivities} options={FILTER_ACTIVITY_OPTIONS} onToggle={onActivityToggle} /> : null}
            <label className="flex items-center gap-2 self-end text-sm">
              <input type="checkbox" checked={filterAttention} onChange={(event) => onAttention(event.target.checked)} aria-label="Needs attention" />
              <span className="text-xs text-muted-foreground">Needs attention</span>
            </label>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={onReset}>Reset</Button>
            <Button size="sm" onClick={() => setOpen(false)}>Done</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FilterMultiSelect({ label, values, options, onToggle }: { label: string; values: string[]; options: Array<{ value: string; label: string }>; onToggle: (value: string) => void }) {
  const active = values.length > 0;
  return (
    <fieldset className="min-w-0">
      <legend className="text-xs text-muted-foreground">{label}{active ? ` (${values.length})` : ""}</legend>
      <div className={`mt-1 max-h-56 space-y-0.5 overflow-auto rounded-md border px-2 py-1 ${active ? "border-primary bg-primary/10" : "border-border bg-background"}`}>
        {options.length === 0 ? <p className="px-1 py-1 text-xs text-muted-foreground">No options.</p> : null}
        {options.map((option) => (
          <label key={option.value} className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-foreground hover:bg-muted/60">
            <input type="checkbox" checked={values.includes(option.value)} onChange={() => onToggle(option.value)} className="size-4 shrink-0 cursor-pointer accent-primary" />
            <span className="truncate">{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// Quiet view switcher shared by both boards. Icon-only and chromeless on
// purpose: changing how the cards below render is a view preference, not an
// action — so it lives beside the filters, never in the CTA row, and never
// looks like a primary button.
function ViewToggle({ view, onChange, label, views }: { view: "board" | "list" | "hill"; onChange: (view: "board" | "list" | "hill") => void; label: string; views?: Array<"board" | "list" | "hill"> }) {
  const options = [
    { value: "board" as const, title: "Board view", icon: "GridView" as const },
    { value: "list" as const, title: "List view", icon: "ListView" as const },
    { value: "hill" as const, title: "Hill view", icon: "ChartColumn" as const },
  ].filter((option) => (views ?? ["board", "list", "hill"]).includes(option.value));
  return (
    <div role="group" aria-label={label} className="flex shrink-0 items-center">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          aria-pressed={view === option.value}
          title={option.title}
          aria-label={option.title}
          className={`inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${view === option.value ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}
        >
          <Icon name={option.icon} className="h-4 w-4" aria-hidden />
        </button>
      ))}
    </div>
  );
}

function ResearchList({ groups, navigate, strategyLabelById, collapsed, onToggle }: { groups: Record<string, CardItem[]>; navigate: ReturnType<typeof useBbNavigate>; strategyLabelById: Map<string, string>; collapsed: Record<string, boolean>; onToggle: (column: string) => void }) {
  return <LightweightTrackList groups={groups} navigate={navigate} collapsed={collapsed} onToggle={onToggle} metaFor={(card) => joinStrategyLabels(card.researchStrategies ?? [], strategyLabelById) || null} />;
}

function ExploreList({ groups, navigate, stageLabelById, collapsed, onToggle }: { groups: Record<string, CardItem[]>; navigate: ReturnType<typeof useBbNavigate>; stageLabelById: Map<string, string>; collapsed: Record<string, boolean>; onToggle: (column: string) => void }) {
  return <LightweightTrackList groups={groups} navigate={navigate} collapsed={collapsed} onToggle={onToggle} metaFor={(card) => (card.exploreStage ? (stageLabelById.get(card.exploreStage) ?? card.exploreStage) : null)} />;
}

// Hill view: one dot per card on a figuring-out/executing curve (Shape Up
// hill-chart reading). Position comes from data the board already carries
// (task/scope fractions, stage checkpoint) via lib/hill-position — no new
// fetch, no layout shift (lanes hash from the card id). Dots are real
// buttons opening the same card surface as tiles and rows.
// Hill region in product words: position never reads as a number anywhere
// on this surface — counts and work states, never percentages.
function hillRegionLabel(region: string): string {
  return region === "uphill" ? "Figuring out" : "Executing";
}

function HillBoard({ cards, navigate }: { cards: CardItem[]; navigate: ReturnType<typeof useBbNavigate> }) {
  // The open cluster is identified by its x, not its index: board updates
  // re-sort clusters, and an index would silently point at another pile.
  // Click-only: hover previews fired while sweeping across piles and the
  // floating panel anchored to the frame edge, not the dot — a modal
  // gallery names its cards instead of floating near them.
  const [openX, setOpenX] = useState<number | null>(null);
  // Archived cards are not work and have no position (see isOnHill): only
  // cards still in the workflow get dots. The tally counts the same way, so
  // the line can never claim execution for a card that already landed.
  const onHill = useMemo(() => cards.filter(isOnHill), [cards]);
  const tally = useMemo(() => hillTally(cards), [cards]);
  const dots = useMemo(() => onHill.map((card) => ({ card, point: hillPoint(card) })), [onHill]);
  const clusters = useMemo(() => clusterHillDots(dots), [dots]);
  const curvePath = useMemo(() => hillCurvePoints(41).map((entry, index) => `${index === 0 ? "M" : "L"} ${(entry.x * 100).toFixed(2)} ${(36 - entry.y * 24.8).toFixed(2)}`).join(" "), []);
  if (cards.length === 0) return <p className="text-sm text-muted-foreground">No cards in this view.</p>;
  if (tally.onHill === 0) return <p className="text-sm text-muted-foreground">Nothing on the hill — {tally.archived} archived {tally.archived === 1 ? "card is" : "cards are"} off it.</p>;
  const openCluster = openX === null ? null : clusters.find((cluster) => cluster.x === openX) ?? null;
  return (
    <div>
      <p className="text-xs text-muted-foreground" role="status">{tally.onHill} {tally.onHill === 1 ? "card" : "cards"} on the hill — {tally.uphill} figuring out, {tally.executing} executing, {tally.done} done.{tally.archived > 0 ? ` ${tally.archived} archived, off the hill.` : ""}</p>
      <div className="relative mt-2 h-64 w-full sm:h-80">
        <svg aria-hidden className="absolute inset-0 h-full w-full text-muted-foreground/40" viewBox="0 0 100 40" preserveAspectRatio="none">
          <path d={curvePath} pathLength={100} className="stelow-hill-draw" fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <line x1="50" y1="2" x2="50" y2="38" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
        </svg>
        {clusters.map((cluster) => {
          const pos = hillDotPercent({ x: cluster.x, y: hillPoint(cluster.cards[0]).y });
          const multi = cluster.cards.length > 1;
          const attention = cluster.cards.some((card) => card.needsAttention);
          const isOpen = openX === cluster.x;
          // Fluidity without lying: x stays exact (shared ratios genuinely
          // coincide — that pile-up IS the bottleneck signal), but dot area
          // grows with slice size, so a 10-scope slice reads bigger than a
          // 1-scope one at the same position.
          const biggest = Math.max(...cluster.cards.map((card) => card.scopeSummary?.scopesTotal ?? 0));
          const dotSize = biggest >= 8 ? "size-5" : biggest >= 4 ? "size-4" : "size-3";
          return multi ? (
            <button
              key={`cluster-${cluster.x}`}
              onClick={() => setOpenX(isOpen ? null : cluster.x)}
              title={`${cluster.cards.length} cards here`}
              aria-label={`${cluster.cards.length} cards, ${hillRegionLabel(hillPoint(cluster.cards[0]).region)}. Open the list.`}
              aria-expanded={isOpen}
              style={{ left: `${pos.left}%`, bottom: `${pos.bottom}%` }}
              className={`stelow-hill-dot absolute flex size-5 -translate-x-1/2 translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-muted-foreground/30 text-[10px] font-semibold text-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${attention ? "stelow-hill-attn" : ""}`}
            >{cluster.cards.length}</button>
          ) : (
            <button
              key={cluster.cards[0].id}
              onClick={() => goToCard(navigate, cluster.cards[0], cluster.cards[0].id)}
              title={biggest > 0 ? `${cluster.cards[0].displayName} · ${biggest} scopes` : cluster.cards[0].displayName}
              aria-label={`Open card ${cluster.cards[0].displayName}.`}
              style={{ left: `${pos.left}%`, bottom: `${pos.bottom}%`, animationDelay: `${Math.min(Math.round(cluster.x * 900), 900)}ms` }}
              className={`stelow-hill-dot absolute ${dotSize} -translate-x-1/2 translate-y-1/2 cursor-pointer rounded-full before:absolute before:-inset-2 before:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${activityDotTone(cluster.cards[0])}${attention ? " stelow-hill-attn" : ""}`}
            />
          );
        })}
        {openCluster ? (
          <CardGalleryDialog
            open
            title={`${openCluster.cards.length} cards · ${hillRegionLabel(hillPoint(openCluster.cards[0]).region)}`}
            description="Cards sharing this hill position. Pick one to open it."
            cards={openCluster.cards}
            emptyText="No cards here."
            onOpenCard={(card) => { setOpenX(null); goToCard(navigate, card, card.id); }}
            onClose={() => setOpenX(null)}
          />
        ) : null}
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground" aria-hidden><span>Figuring out</span><span>Executing</span></div>
      <ul aria-label="Hill legend" className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <li className="flex items-center gap-1"><span aria-hidden className="size-2 rounded-full bg-amber-500" />Needs you</li>
        <li className="flex items-center gap-1"><span aria-hidden className="size-2 rounded-full bg-primary" />Working</li>
        <li className="flex items-center gap-1"><span aria-hidden className="size-2 rounded-full bg-emerald-500" />Done</li>
        <li className="flex items-center gap-1"><span aria-hidden className="size-2 rounded-full bg-destructive" />Failed</li>
        <li className="flex items-center gap-1"><span aria-hidden className="size-2 rounded-full bg-muted-foreground/40" />Resting</li>
      </ul>
    </div>
  );
}

// Phase rail: the four workflow phases with the card's current one filled.
// A glanceable "you are here" for the open card; research/explore cards
// (no workflow stage) render no marker rather than a wrong one.
// Flow strip: finished-work lead/cycle reading on the Build board. One
// Flow indicators over finished cards: a named header (finished count with
// a measured trail, typical/median and slow/p90 lead/cycle), expanding to
// window presets and a per-card table. Reads the flowMetrics RPC — the same
// math as gap summaries and card detail, never a third implementation. Empty
// boards render nothing: clean stays clean.
type FlowWindow = "all" | "30d" | "90d";
const FLOW_WINDOWS: Array<{ id: FlowWindow; label: string; days: number | null }> = [
  { id: "all", label: "All time", days: null },
  { id: "30d", label: "30d", days: 30 },
  { id: "90d", label: "90d", days: 90 },
];
function FlowStrip({ rpc, projectId, navigate }: { rpc: ManagerRpc; projectId: string | null; navigate: ReturnType<typeof useBbNavigate> }) {
  const [open, setOpen] = useState(false);
  const [window, setWindow] = useState<FlowWindow>("all");
  const [tab, setTab] = useState<"tempo" | "atencao">("tempo");
  const [result, setResult] = useState<{ items: Array<{ cardId: string; kind: string; name: string; leadMs: number | null; cycleMs: number | null; doneAt: number | null }>; summary: { count: number; leadP50Ms: number | null; leadP90Ms: number | null; cycleP50Ms: number | null; cycleP90Ms: number | null }; attention: Array<{ cardId: string; kind: string; name: string; reason: "stuck" | "review" }> } | null>(null);
  const preset = FLOW_WINDOWS.find((entry) => entry.id === window) ?? FLOW_WINDOWS[0]!;
  const since = preset.days === null ? null : Date.now() - preset.days * 86400000;
  useEffect(() => {
    let cancelled = false;
    void rpc.call("flowMetrics", { projectId, since }).then((next) => { if (!cancelled) setResult(next); }).catch(() => { if (!cancelled) setResult(null); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpc, projectId, window]);
  if (!result || result.summary.count === 0) return null;
  const rows = [...result.items].sort((a, b) => (b.leadMs ?? -1) - (a.leadMs ?? -1));
  const stuck = result.attention.filter((entry) => entry.reason === "stuck");
  const review = result.attention.filter((entry) => entry.reason === "review");
  const leadTypical = result.summary.leadP50Ms !== null ? formatDuration(result.summary.leadP50Ms) : "—";
  const cycleTypical = result.summary.cycleP50Ms !== null ? formatDuration(result.summary.cycleP50Ms) : "—";
  const label = `${result.summary.count} finished · ${preset.label.toLowerCase()} · lead typical ${leadTypical} · cycle typical ${cycleTypical}`;
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <button onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={`Flow indicators: ${label}. Finished cards with a measured trail in this scope and window.`} title="Finished cards with a measured trail in this scope and window — a Done-column card without one reads here only after its trail records." className="flex min-h-11 w-full cursor-pointer flex-wrap items-center gap-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
        <DisclosureChevron open={open} />
        <span className="font-medium text-foreground">Flow</span>
        <span className="whitespace-nowrap text-muted-foreground">{result.summary.count} finished · {preset.label.toLowerCase()}</span>
        <span className="whitespace-nowrap text-muted-foreground">lead typical {leadTypical}</span>
        <span className="whitespace-nowrap text-muted-foreground">cycle typical {cycleTypical}</span>
        {stuck.length > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-300" title="Blocked status or errored worker — needs unblocking, right now">
            <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-amber-500" />
            {stuck.length} stuck
          </span>
        ) : null}
        {review.length > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-300" title="Finished cards awaiting your read">
            <span aria-hidden className="size-1.5 rounded-full bg-emerald-500" />
            {review.length} to review
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-1" role="group" aria-label="Flow view">
            {(["tempo", "atencao"] as const).map((entry) => (
              <button key={entry} onClick={() => setTab(entry)} aria-pressed={tab === entry} className={`min-h-9 cursor-pointer rounded-md px-2 text-xs font-medium ${tab === entry ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"}`}>{entry === "tempo" ? "Tempo" : `Atenção${stuck.length + review.length > 0 ? ` (${stuck.length + review.length})` : ""}`}</button>
            ))}
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">slow: lead {result.summary.leadP90Ms !== null ? formatDuration(result.summary.leadP90Ms) : "—"} · cycle {result.summary.cycleP90Ms !== null ? formatDuration(result.summary.cycleP90Ms) : "—"}</span>
          </div>
          {tab === "tempo" ? (
          <div className="space-y-2">
          <p className="text-xs leading-5 text-muted-foreground">Typical is the median (p50); slow is p90 — 9 of 10 finish within. Lead runs idea to done; cycle runs first real movement to done.</p>
          <div className="flex items-center gap-1" role="group" aria-label="Done window">
            {FLOW_WINDOWS.map((entry) => (
              <button key={entry.id} onClick={() => setWindow(entry.id)} aria-pressed={window === entry.id} className={`min-h-9 cursor-pointer rounded-md px-2 text-xs font-medium ${window === entry.id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"}`}>{entry.label}</button>
            ))}
          </div>
          <ul className="max-h-56 space-y-0.5 overflow-auto">
            {rows.map((item) => (
              <li key={item.cardId}>
                <button onClick={() => goToCard(navigate, { kind: item.kind as "build" | "research" | "explore" }, item.cardId)} className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">lead {item.leadMs !== null ? formatDuration(item.leadMs) : "—"}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">cycle {item.cycleMs !== null ? formatDuration(item.cycleMs) : "—"}</span>
                </button>
              </li>
            ))}
          </ul>
          </div>
          ) : (
          <div className="space-y-2">
          <p className="text-xs leading-5 text-muted-foreground">Right now — not in the selected window. Stuck means blocked status or an errored worker; review means finished and awaiting your read.</p>
          {stuck.length + review.length === 0 ? (
            <p className="text-xs text-muted-foreground">All clear — nothing stuck, nothing awaiting review.</p>
          ) : (
          <ul className="max-h-56 space-y-0.5 overflow-auto">
            {[...stuck.map((entry) => ({ ...entry, tone: "text-amber-700 dark:text-amber-300", mark: "stuck" })), ...review.map((entry) => ({ ...entry, tone: "text-emerald-700 dark:text-emerald-300", mark: "to review" }))].map((entry) => (
              <li key={entry.cardId}>
                <button onClick={() => goToCard(navigate, { kind: entry.kind as "build" | "research" | "explore" }, entry.cardId)} className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                  <span className={`shrink-0 font-medium ${entry.tone}`}>{entry.mark}</span>
                </button>
              </li>
            ))}
          </ul>
          )}
          </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function BuildList({ groups, navigate, collapsed, onToggle }: { groups: Record<string, CardItem[]>; navigate: ReturnType<typeof useBbNavigate>; collapsed: Record<string, boolean>; onToggle: (column: string) => void }) {
  return <div className="space-y-5">{VISIBLE_COLUMNS.map((column) => {
    const cards = groups[column] ?? [];
    if (!cards.length) return null;
    const isCollapsed = collapsed[column] === true;
    const label = COLUMN_LABELS[column] ?? column;
    return <section key={column} className="space-y-2"><div className="flex items-center gap-2"><button type="button" onClick={() => onToggle(column)} aria-expanded={!isCollapsed} aria-label={isCollapsed ? `Expand ${label}` : `Collapse ${label}`} title={isCollapsed ? `Expand ${label}` : `Collapse ${label}`} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-sm font-semibold hover:bg-foreground/5 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><DisclosureChevron open={!isCollapsed} className="text-foreground/60" />{label}</button><span className="text-xs text-muted-foreground">{cards.length}</span></div>{!isCollapsed ? <div className="overflow-hidden rounded-md border">{cards.map((card) => <TrackListRow key={card.id} card={card} summary={{ scopesDone: card.scopeSummary.scopesDone, scopesTotal: card.scopeSummary.scopesTotal }} meta={`${card.status === "completed" ? "Completed" : stageLabel(card.stage)}${card.scopeSummary.scopesTotal > 0 ? ` · ✓ ${card.scopeSummary.scopesDone}/${card.scopeSummary.scopesTotal} scopes · ${card.scopeSummary.tasksDone}/${card.scopeSummary.tasksTotal} tasks` : ""}`} onOpen={() => goToCard(navigate, card, card.id)} />)}</div> : null}</section>;
  })}</div>;
}

// One list row for all three tracks (convention over configuration):
// Build's row geometry is the standard; per-track context rides the meta
// line (stage + scopes, strategy, technique). Kanban tiles stay rich;
// list rows stay dense and keyboard-native.
function TrackListRow({ card, meta, summary, onOpen }: {
  card: CardItem;
  meta: string | null;
  summary?: { scopesDone: number; scopesTotal: number } | null;
  onOpen: () => void;
}) {
  const navigate = useBbNavigate();
  const returnFocusRef = useReturnFocus<HTMLButtonElement>(card.id);
  return <button ref={returnFocusRef} onClick={onOpen} onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === "w" || event.key === "W") { event.preventDefault(); if (card.workerThreadId) navigate.toThread(card.workerThreadId); } }} title={card.workerThreadId ? "Open card · W opens the worker thread" : "Open card"} aria-label={`Open card ${card.displayName}.`} className="cursor-pointer flex min-h-11 w-full flex-col items-stretch gap-1.5 border-b p-3 text-left last:border-b-0 hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:flex-row sm:items-center sm:gap-3"><span className="flex min-w-0 flex-1 items-start gap-2"><span className={`mt-1 size-2 shrink-0 rounded-full ${card.needsAttention ? "bg-amber-500" : pendingReview(card) ? "bg-emerald-500" : card.activity === "running" ? "bg-primary" : "bg-muted-foreground/40"}`} /><span className="min-w-0 flex-1"><strong className="block break-words text-sm leading-5">{card.displayName}</strong><span className="mt-0.5 block break-words text-xs leading-5 text-muted-foreground">{card.projectName}{meta ? ` · ${meta}` : ""}{summary && summary.scopesTotal > 0 ? <> · <ScopeStrip done={summary.scopesDone} total={summary.scopesTotal} /></> : null}</span></span></span><span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><ActivityPill activity={card.activity} />{card.needsAttention && card.activity !== "awaiting-answer" && card.activity !== "error" ? <AttentionChip label={attentionLabel(card)} /> : null}{(card.activity === "running" || card.activity === "awaiting-answer") && (card.doingNow ?? []).length > 0 ? <DoingNowPill names={card.doingNow ?? []} /> : null}{pendingReview(card) ? <ReviewChip /> : null}<span className="whitespace-nowrap">{new Date(card.updatedAt).toLocaleString()}</span></span></button>;
}

function BoardColumn({ column, cards, collapsed, onToggleCollapsed, onDrop, labels = COLUMN_LABELS, renderCard = (card) => <BoardCard card={card} /> }: { column: string; cards: CardItem[]; collapsed: boolean; onToggleCollapsed: () => void; onDrop: (cardId: string) => void; labels?: Record<string, string>; renderCard?: (card: CardItem) => React.ReactNode }) {
  const [over, setOver] = useState(false);
  return (
    <section onDragOver={(event) => { event.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(event) => { event.preventDefault(); setOver(false); const id = event.dataTransfer.getData("text/stelow-card"); if (id) onDrop(id); }} className={`flex min-h-40 flex-col rounded-lg border bg-muted/30 p-2 transition md:h-full md:min-h-0 ${over ? "border-primary bg-primary/5" : "border-border"} ${collapsed ? "items-center" : ""}`}>
      <button onClick={onToggleCollapsed} className={`${collapsed ? "flex h-full w-full cursor-pointer flex-col items-center gap-2 py-2 hover:bg-foreground/5" : "mb-2 flex min-h-10 cursor-pointer items-center justify-between gap-2 rounded-md px-1 py-0.5 hover:bg-foreground/5"} text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground`} title={collapsed ? `Expand ${labels[column]}` : `Collapse ${labels[column]}`} aria-label={collapsed ? `Expand ${labels[column]}` : `Collapse ${labels[column]}`}>
        {collapsed ? (
          <>
            <span className="rounded-md bg-foreground/10 px-1.5 text-foreground">{cards.length}</span>
            <span style={{ writingMode: "vertical-rl" }} className="text-[10px] tracking-widest text-foreground/80">{labels[column]}</span>
            <DisclosureChevron open={false} className="text-foreground/60" />
          </>
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              <DisclosureChevron open />
              <span>{labels[column]}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="rounded-md bg-foreground/10 px-2 text-foreground">{cards.length}</span>
            </span>
          </>
        )}
      </button>
      {!collapsed ? (
        <div className="space-y-2 md:min-h-0 md:flex-1 md:overflow-y-auto md:overscroll-y-contain md:pr-1" role="list" aria-label={`${labels[column]} cards`}>
          {cards.map((card) => <div key={card.id}>{renderCard(card)}</div>)}
        </div>
      ) : null}
    </section>
  );
}

// Shared card leaves. BoardCard and ResearchCard render identical worker
// chrome (inline retry, attention/error/idle rows) — one definition serves
// both tracks instead of drifting copies.
function CardRetryButton({ cardId, label }: { cardId: string; label: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [retrying, setRetrying] = useState(false);
  async function retry(event: React.MouseEvent) {
    event.stopPropagation();
    if (retrying) return;
    setRetrying(true);
    try {
      const result = await rpc.call("retryWorker", { cardId });
      if (!result.ok) toast.error(result.error ?? "Retry failed. Open the card to restart fresh.");
      else toast.success("Worker retried.");
    } finally {
      setRetrying(false);
    }
  }
  return (
    <button onClick={(event) => void retry(event)} disabled={retrying} title="Retry the worker in place" className="min-h-11 disabled:cursor-not-allowed cursor-pointer rounded-md border border-primary/40 px-3 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50">
      {retrying ? "Resuming…" : `↻ ${label}`}
    </button>
  );
}

// Return focus: opening a card remembers it; the board restores focus to
// that card when the user comes back (Esc / Back button), so keyboard users
// never lose their place. One module slot — a board shows one track at a time.
let stelowReturnFocusCardId: string | null = null;

function useReturnFocus<T extends HTMLElement>(cardId: string) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (stelowReturnFocusCardId === cardId && ref.current) {
      stelowReturnFocusCardId = null;
      ref.current.focus();
    }
  }, [cardId]);
  return ref;
}

// Tiles signal; the open card explains. A failure's full text and its
// retry live in the detail hero — never on the tile — so board columns stay
// scannable. The Failed chip keeps the reason one hover away via title.
function CardMetaRows({ card }: { card: CardItem }) {
  const attention = card.needsAttention;
  return (
    <>
      <div className="mt-1 truncate text-[11px] text-muted-foreground" title={`Project: ${card.projectName}`}>{card.projectName}</div>
      {attention && card.activity !== "error" && card.activity !== "awaiting-answer" ? (
        <div className="mt-2"><AttentionChip label={attentionLabel(card)} /></div>
      ) : null}
      {card.activity === "running" || card.activity === "awaiting-answer" ? (
        <div className="mt-2 max-w-full"><DoingNowPill names={card.doingNow ?? []} /></div>
      ) : null}
      {pendingReview(card) ? (
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
          <span aria-hidden className="size-1.5 rounded-full bg-emerald-500" />
          <span>Review</span>
        </div>
      ) : null}
      {card.activity === "idle" ? <div className="mt-1 text-[10px] text-muted-foreground">Idle since {new Date(card.updatedAt).toLocaleString()}</div> : null}
    </>
  );
}

// All board tiles share this header geometry. Identity, state and recovery
// actions are deliberately distinct rows: a narrow board column must never
// make a title look like a tiny label among controls, or make state look like
// an action. The pills are self-describing through their canonical order, so
// a generic "Status" label would only add noise.
function CardHeading({ title, status, action }: { title: string; status: React.ReactNode; action?: React.ReactNode }) {
  const statusItems = Children.toArray(status);
  return (
    <header className="min-w-0 space-y-2.5">
      <h3 className="min-w-0 break-all text-sm font-semibold leading-5 text-foreground">{title}</h3>
      {statusItems.length ? <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">{statusItems}</div> : null}
      {action ? <div className="border-t border-border/70 pt-2">{action}</div> : null}
    </header>
  );
}

function BoardCard({ card, onOpen }: { card: CardItem; onOpen?: () => void }) {
  const navigate = useBbNavigate();
  const attention = card.needsAttention;
  // Retry is for active workers only: a Done card never offers it, even if a
  // stale error survived underneath.
  const terminal = card.status === "completed" || card.status === "archived" || card.status === "blocked";
  const stuck = !terminal && Boolean(card.workerThreadId) && (card.activity === "error" || (card.activity === "idle" && attention));
  const borderClass = liveBorderClass(card) || "border-border hover:border-primary/60";
  const open = useCallback(() => { onOpen?.(); goToCard(navigate, card, card.id); }, [navigate, card, onOpen]);
  const returnFocusRef = useReturnFocus<HTMLDivElement>(card.id);
  const openThread = useCallback(() => { if (card.workerThreadId) navigate.toThread(card.workerThreadId); }, [navigate, card.workerThreadId]);
  return (
    <div
      role="button"
      tabIndex={0}
      ref={returnFocusRef}
      draggable
      onDragStart={(event) => { event.dataTransfer.setData("text/stelow-card", card.id); event.dataTransfer.effectAllowed = "move"; }}
      onClick={open}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); }
        else if (event.key === "w" || event.key === "W") { event.preventDefault(); openThread(); }
      }}
      title={card.workerThreadId ? "Click to inspect · W opens the worker thread" : "Click to inspect"}
      className={`stelow-live-surface stelow-board-card relative block w-full cursor-pointer overflow-hidden rounded-lg border bg-card p-3 text-left shadow-sm transition hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${borderClass}`}
      aria-label={`Open card ${card.displayName}.`}
    >
      <CardHeading title={card.displayName}
        action={stuck && card.activity !== "error" ? <CardRetryButton cardId={card.id} label="Resume work" /> : null}
        status={<BuildStatusPills {...buildStatusPillProps(card)} />}
      />
      {card.scopeSummary.scopesTotal > 0 ? <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <ScopeStrip done={card.scopeSummary.scopesDone} total={card.scopeSummary.scopesTotal} />
        <span className="whitespace-nowrap text-muted-foreground" title={`${card.scopeSummary.scopesDone} of ${card.scopeSummary.scopesTotal} scopes done · ${card.scopeSummary.tasksDone} of ${card.scopeSummary.tasksTotal} tasks done`}>✓ {card.scopeSummary.scopesDone}/{card.scopeSummary.scopesTotal} scopes · {card.scopeSummary.tasksDone}/{card.scopeSummary.tasksTotal} tasks</span>
      </div> : null}
      <CardMetaRows card={card} />
    </div>
  );
}

// Card gallery dialog: one expanded modal listing cards as the same tiles
// the board shows — near-fullscreen (70vw), tiles at the board's own column
// bounds (240–320px, the shared KANBAN_COLUMN_WIDTHS pair) and the board's
// own natural height, filling left to right and wrapping down, vertical
// scroll. Buckets and hill piles share it: callers pass title, description,
// and cards; choosing a tile opens it through the same surface as the
// board. Empty renders one line, never a dead modal. A narrow modal
// degrades to one bounded column instead of overflowing sideways.
function CardGalleryDialog({ open, title, description, cards, emptyText, onOpenCard, onClose }: {
  open: boolean;
  title: string;
  description: string;
  cards: CardItem[];
  emptyText: string;
  onOpenCard: (card: CardItem) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent fullscreenOnMobile className="h-[85dvh] overflow-y-auto sm:w-[70vw] sm:max-w-[70vw]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {cards.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <ul data-gallery-tiles className="grid items-start justify-start gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(240px,100%),320px))]">
            {cards.map((card) => (
              <li key={card.id}>
                <BoardCard card={card} onOpen={() => onOpenCard(card)} />
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

// One copy source for the Bucket gallery (header button + creation
// dialogs): title, description, and empty text derive from the pile,
// never pasted per call site.
function bucketGalleryCopy(cards: CardItem[]) {
  return {
    title: "Bucket",
    description: cards.length > 0 ? `Captured, nothing running yet — ${cards.length} card${cards.length === 1 ? "" : "s"} waiting to start.` : "Captured, nothing running yet.",
    emptyText: "Bucket's empty — new cards land here until their worker starts.",
  };
}

// Creation dialogs share one opener for the track's captured pile: the
// checkbox link calls open, the dialog node renders once beside the form.
function useBucketGallery(cards: CardItem[]) {
  const navigate = useBbNavigate();
  const [open, setOpen] = useState(false);
  const copy = bucketGalleryCopy(cards);
  const node = (
    <CardGalleryDialog open={open} title={copy.title} description={copy.description} cards={cards} emptyText={copy.emptyText} onOpenCard={(card) => { setOpen(false); goToCard(navigate, card, card.id); }} onClose={() => setOpen(false)} />
  );
  return { openBucketGallery: () => setOpen(true), bucketGallery: node };
}

// Bucket gallery affordance: one button per track opens its captured pile
// as the shared gallery modal. Owns its open state — panels pass cards.
function BucketGalleryButton({ cards }: { cards: CardItem[] }) {
  const gallery = useBucketGallery(cards);
  return (
    <>
      <Button className="min-h-11 w-full sm:w-auto sm:flex-none" variant="outline" onClick={gallery.openBucketGallery} title="Open the Bucket — captured cards waiting to start"><Icon name="PackageReceive" className="h-4 w-4" aria-hidden /> Bucket{cards.length > 0 ? ` (${cards.length})` : ""}</Button>
      {gallery.bucketGallery}
    </>
  );
}

// Lightweight-track card (Research + Explore share it — convention over
// configuration): identical worker chrome, one tag pill whose label comes
// from the track catalog (strategy for research, stage for explore).
function LightweightTrackCard({ card, kind, tagLabel, tagTitle, ariaNoun }: { card: CardItem; kind: "research" | "explore"; tagLabel: string | null; tagTitle: string; ariaNoun: string }) {
  const navigate = useBbNavigate();
  const attention = card.needsAttention;
  // Retry is for active workers only: a Done card never offers it, even if a
  // stale error survived underneath.
  const terminal = card.status === "completed" || card.status === "archived" || card.status === "blocked";
  const stuck = !terminal && Boolean(card.workerThreadId) && (card.activity === "error" || (card.activity === "idle" && attention));
  const borderClass = liveBorderClass(card) || "border-border hover:border-primary/60";
  const open = useCallback(() => goToCard(navigate, card, card.id), [navigate, card]);
  const returnFocusRef = useReturnFocus<HTMLDivElement>(card.id);
  const openThread = useCallback(() => { if (card.workerThreadId) navigate.toThread(card.workerThreadId); }, [navigate, card.workerThreadId]);
  return (
    <div
      role="button"
      tabIndex={0}
      ref={returnFocusRef}
      draggable
      onDragStart={(event) => { event.dataTransfer.setData("text/stelow-card", card.id); event.dataTransfer.effectAllowed = "move"; }}
      onClick={open}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); }
        else if (event.key === "w" || event.key === "W") { event.preventDefault(); openThread(); }
      }}
      title={card.workerThreadId ? "Click to inspect · W opens the worker thread" : "Click to inspect"}
      className={`stelow-live-surface stelow-board-card relative block w-full cursor-pointer overflow-hidden rounded-lg border bg-card p-3 text-left shadow-sm transition hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${borderClass}`}
      aria-label={`Open ${ariaNoun} ${card.displayName}.`}
    >
      <CardHeading title={card.displayName}
        action={stuck && card.activity !== "error" ? <CardRetryButton cardId={card.id} label="Resume work" /> : null}
        status={<ActivityPill activity={card.activity} detail={card.lastError} />}
      />
      {tagLabel ? <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <LightweightStatusPills card={card} statusTone={statusTone} columnLabel={null} tagLabel={tagLabel} tagTitle={tagTitle} kind={kind} />
      </div> : null}
      <CardMetaRows card={card} />
    </div>
  );
}

// Research-track card: strategy instead of stage/intent, opens in the
// Research panel. Retry, attention, and activity reuse the build pieces.
function ResearchCard({ card, strategyLabel }: { card: CardItem; strategyLabel: string | null }) {
  return <LightweightTrackCard card={card} kind="research" tagLabel={strategyLabel} tagTitle="Research strategy — the playbook driving this investigation." ariaNoun="research" />;
}

// Explore-track card: a single technique (one isolated Build-workflow skill)
// instead of strategy/intent, opens in the Explore panel. Retry, attention,
// and activity reuse the same pieces as the other tracks.
function ExploreCard({ card, stageLabel }: { card: CardItem; stageLabel: string | null }) {
  return <LightweightTrackCard card={card} kind="explore" tagLabel={stageLabel ?? card.exploreStage} tagTitle="Technique — the focused approach this exploration runs." ariaNoun="exploration" />;
}

// Lightweight list view (Research + Explore share it): same grouping as the
// board, one card per row. tagFor resolves the card's tag pill label.
function LightweightTrackList({ groups, navigate, metaFor, collapsed, onToggle }: { groups: Record<string, CardItem[]>; navigate: ReturnType<typeof useBbNavigate>; metaFor: (card: CardItem) => string | null; collapsed: Record<string, boolean>; onToggle: (column: string) => void }) {
  return <div className="space-y-5">{VISIBLE_RESEARCH_COLUMNS.map((column) => {
    const cards = groups[column] ?? [];
    if (cards.length === 0) return null;
    const isCollapsed = collapsed[column] === true;
    const label = RESEARCH_COLUMN_LABELS[column] ?? column;
    return <section key={column} className="space-y-2"><div className="flex items-center gap-2"><button type="button" onClick={() => onToggle(column)} aria-expanded={!isCollapsed} aria-label={isCollapsed ? `Expand ${label}` : `Collapse ${label}`} title={isCollapsed ? `Expand ${label}` : `Collapse ${label}`} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-sm font-semibold hover:bg-foreground/5 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><DisclosureChevron open={!isCollapsed} className="text-foreground/60" />{label}</button><span className="text-xs text-muted-foreground">{cards.length}</span></div>{!isCollapsed ? <div className="overflow-hidden rounded-md border">{cards.map((card) => <TrackListRow key={card.id} card={card} meta={metaFor(card)} onOpen={() => goToCard(navigate, card, card.id)} />)}</div> : null}</section>;
  })}</div>;
}

// Timeline of the 17 workflow stages, grouped by phase (band). Each stage is a
// chip: passed / current / upcoming. Clicking an allowed target advances or
// regresses ONE stage — the timeline is the position context AND the advance
// control, so the user always sees where the card is and what it can move to.

// One-line entity summary for the Diff section ("4 entities · 2 added,
// 1 modified, 1 deleted"). Null when sem is absent or found nothing — the
// patch list renders on its own either way.
function formatEntitySummary(summary: { total: number; added: number; modified: number; deleted: number; renamed: number; moved: number; cosmeticOnly: boolean } | null): string | null {
  if (!summary || summary.total <= 0) return null;
  const parts = [
    summary.added > 0 ? `${summary.added} added` : null,
    summary.modified > 0 ? `${summary.modified} modified` : null,
    summary.deleted > 0 ? `${summary.deleted} deleted` : null,
    summary.renamed > 0 ? `${summary.renamed} renamed` : null,
    summary.moved > 0 ? `${summary.moved} moved` : null,
  ].filter((part): part is string => part !== null);
  const head = `${summary.total} ${summary.total === 1 ? "entity" : "entities"}`;
  const tail = summary.cosmeticOnly ? " · cosmetic only" : "";
  return parts.length > 0 ? `${head} · ${parts.join(" · ")}${tail}` : `${head}${tail}`;
}

// Blast-radius line for the Diff section ("mul · 3 callers (1 test); add ·
// no callers"). Null when cymbal is absent or found no symbols.
function formatChangedSymbols(symbols: Array<{ symbol: string; callers: number; testCallers: number }> | null): string | null {
  if (!symbols || symbols.length === 0) return null;
  return symbols.map((entry) => {
    const impact = entry.callers === 0
      ? "no callers"
      : `${entry.callers} caller${entry.callers === 1 ? "" : "s"}${entry.testCallers > 0 ? ` (${entry.testCallers} test${entry.testCallers === 1 ? "" : "s"})` : ""}`;
    return `${entry.symbol} · ${impact}`;
  }).join("; ");
}

function CardDrawerAdapter(props: PluginThreadPanelProps) {
  const params = props.params;
  const directCardId = typeof params === "object" && params && "cardId" in params && typeof params.cardId === "string" ? params.cardId : "";
  const threadId = typeof params === "object" && params && "threadId" in params && typeof params.threadId === "string" ? params.threadId : "";
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  // Palette commands open this drawer with a threadId (no card context at
  // the palette); resolve it to the owning card like the header action does.
  const [resolvedCardId, setResolvedCardId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  useEffect(() => {
    if (directCardId || !threadId) return;
    let cancelled = false;
    setResolving(true);
    void rpc.call("cardByWorkerThread", { threadId }).then((result) => {
      if (!cancelled) {
        setResolvedCardId(result.cardId);
        setResolving(false);
      }
    }).catch(() => {
      if (!cancelled) setResolving(false);
    });
    return () => { cancelled = true; };
  }, [rpc, directCardId, threadId]);
  const cardId = directCardId || resolvedCardId || "";
  if (!cardId) {
    if (resolving) return <p className="p-4 text-sm text-muted-foreground">Finding this thread&apos;s Stelow card…</p>;
    if (threadId) return <p className="p-4 text-sm text-muted-foreground">This thread is not a Stelow worker thread.</p>;
    return <p className="p-4 text-sm text-muted-foreground">Pick a card from Stelow {trackTitle("build")} to see its details here.</p>;
  }
  return <CardDetailBody cardId={cardId} inboxEventId={null} onClose={() => { /* host tab close */ }} navigate={navigate} />;
}

// Scope progress hero: one glanceable readout above the per-scope list.
// Presentation only — same scopes/tasks contract, no new data. Shows
// overall scope + task bars, what is actively doing now, and what waits.
// Checks rollup: every pending thing on the card grouped by type with
// done/pending counts — questions, scopes, tasks, gaps, review. Reads the
// same sources the heroes read (pending questions, scope states, the gap
// summary RPC), never a second truth. A pending-only filter hides
// all-done groups; all clear reads as one line, not an empty box.
function CardChecksSection({ cardId, card, detail }: { cardId: string; card: CardItem; detail: CardDetailResponse }) {
  const rpc = useRpc<typeof rpcContract>();
  const [gaps, setGaps] = useState<{ matched: boolean; items: Array<{ description: string }>; fixed: number; documented: number; total: number } | null>(null);
  const [pendingOnly, setPendingOnly] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void rpc.call("gapSummary", { cardId }).then((result) => { if (!cancelled) setGaps(result); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [rpc, cardId]);
  const groups = groupCardChecks({
    questions: [...detail.pendingQuestions, ...detail.expiredQuestions],
    scopes: detail.scopes,
    gaps,
    review: card.status === "completed" ? { pending: card.hasPendingReview, done: !card.hasPendingReview } : null,
  });
  if (groups.length === 0) return null;
  const visible = pendingOnly ? groups.filter((group) => groupState(group) === "pending") : groups;
  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold text-foreground">Checks</h3>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground"><input type="checkbox" checked={pendingOnly} onChange={(event) => setPendingOnly(event.target.checked)} className="size-3.5 accent-primary" />Pending only</label>
      </div>
      {isExecutionUntracked({ activity: card.activity, scopes: detail.scopes }) ? <p className="text-xs text-amber-700 dark:text-amber-300" role="status">Executing with no scope marked started — the worker has not marked any scope in-progress or done. Scopes may be going untracked.</p> : null}
      {isScopeTrackingMissing({ activity: card.activity, stage: card.stage, scopes: detail.scopes }) && card.status !== "completed" && card.status !== "archived" ? <p className="text-xs text-amber-700 dark:text-amber-300" role="status">No synced scopes on this card — planning likely used headings instead of machine blocks, so sync-scopes parsed nothing. Rewrite the spec with [SCOPE-N] blocks and resync before executing.</p> : null}
      {visible.length === 0 ? <p className="text-xs text-muted-foreground">All clear — nothing pending on this card.</p> : visible.map((group) => (
        <div key={group.id} className="space-y-0.5">
          <p className="text-xs">
            <span className="font-medium text-foreground">{group.label}</span>
            <span className="ml-2 tabular-nums text-muted-foreground">{group.open.length}/{group.total} open</span>
            {groupState(group) === "done" ? <span className="ml-2 text-emerald-700 dark:text-emerald-300">✓</span> : null}
          </p>
          {group.open.length > 0 ? <p className="truncate text-[11px] text-muted-foreground" title={group.open.join(" · ")}>{group.open.slice(0, 3).join(" · ")}{group.open.length > 3 ? ` +${group.open.length - 3} more` : ""}</p> : null}
        </div>
      ))}
    </div>
  );
}

function ScopeProgress({ scopes, flow }: { scopes: Extract<CardDetailResponse, { scopes: unknown }>["scopes"]; flow?: { leadMs: number | null; cycleMs: number | null } | null }) {
  const isDone = (status: string | undefined) => isDoneStatus(status ?? "");
  const scopesDone = scopes.filter((scope) => isDone(scope.status)).length;
  const tasksAll = scopes.flatMap((scope) => scope.tasks);
  const tasksDone = tasksAll.filter((task) => isDone(task.status)).length;
  const doingScopes = scopes.filter((scope) => scope.status === "in-progress");
  const doingTasks = tasksAll.filter((task) => task.status === "in-progress");
  const blockedScopes = scopes.filter((scope) => ["blocked", "failed", "escalated"].includes(scope.status ?? ""));
  const scopePct = scopes.length > 0 ? Math.round((scopesDone / scopes.length) * 100) : 0;
  const taskPct = tasksAll.length > 0 ? Math.round((tasksDone / tasksAll.length) * 100) : 0;
  const bar = (pct: number, tone: string) => (
    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
      {flow && (flow.leadMs !== null || flow.cycleMs !== null) ? (
        <p className="text-xs text-muted-foreground" title="Lead runs idea to done; cycle runs first real movement to done. Unfinished cards show no times.">
          <span className="font-semibold text-foreground">Lead {flow.leadMs !== null ? formatDuration(flow.leadMs) : "—"}</span>
          <span aria-hidden> · </span>
          <span>Cycle {flow.cycleMs !== null ? formatDuration(flow.cycleMs) : "—"}</span>
        </p>
      ) : null}
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold">✓ {scopesDone}/{scopes.length} scopes</span>
        {bar(scopePct, "bg-emerald-500")}
      </div>
      {tasksAll.length > 0 ? (
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold">✓ {tasksDone}/{tasksAll.length} tasks</span>
          {bar(taskPct, "bg-primary")}
        </div>
      ) : null}
      {doingScopes.length > 0 || doingTasks.length > 0 ? (
        <p className="text-xs">
          <span className="font-semibold text-primary">● Doing now: </span>
          <span className="text-muted-foreground">
            {[...doingScopes.map((scope) => scope.name), ...doingTasks.filter((task) => !doingScopes.some((scope) => scope.tasks.includes(task))).map((task) => task.name)].slice(0, 3).join(" · ")}
            {doingScopes.length + doingTasks.length > 3 ? ` +${doingScopes.length + doingTasks.length - 3} more` : ""}
          </span>
        </p>
      ) : scopesDone === scopes.length && scopes.length > 0 ? (
        <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">✓ All scopes complete</p>
      ) : null}
      {blockedScopes.length > 0 ? (
        <p className="text-xs"><span className="font-semibold text-destructive">⚠ Blocked: </span><span className="text-muted-foreground">{blockedScopes.map((scope) => scope.name).slice(0, 3).join(" · ")}</span></p>
      ) : null}
    </div>
  );
}

type PresetManagerPreset = { id: string; name: string; providerId: string; modelId: string; reasoningLevel: string; permissionMode: string; environmentKind: string; builtIn: boolean; isDefault: boolean };
const EMPTY_PRESET_FORM = { id: null as string | null, name: "", providerId: "", modelId: "", reasoningLevel: "medium", permissionMode: "full" as "accept-edits" | "auto" | "full", environmentKind: "project-default" as "project-default" | "new-worktree" };

// First-visit setup dialog for the work tracks (Build / Research / Explore).
// Unlike the removed Tour steppers, this earns its interruption: it ends
// with the user having configured something (or explicitly skipping).
// One Dialog primitive, track-specific copy; dismissal persists per
// storageKey so it shows exactly once. All panels stay mounted for
// keep-alive, so the dialog opens only while its own track is active —
// otherwise first visit would stack three dialogs at once.
function onboardingTotal(hasSecond: boolean) {
  return hasSecond ? 3 : 2;
}

function PresetOnboardingBody({ step, total, secondBody, children }: {
  step: number;
  total: number;
  secondBody?: React.ReactNode;
  children?: React.ReactNode;
}) {
  if (step === total - 1) return <StayInTouchStep />;
  if (step === 1 && secondBody) return <div className="min-w-0">{secondBody}</div>;
  return (
    <div className="grid gap-3 py-1 text-sm leading-6 text-muted-foreground">
      <p>Agent presets decide which provider, model, reasoning, and permission each worker runs with. Each track has its own band default; cards without one fall back to the board default, and any card can pin its own preset in Manage.</p>
      {children}
    </div>
  );
}

function PresetOnboardingFooter({ step, total, hasSecond, onOpenPresets, onNext, onBack, onDone }: {
  step: number;
  total: number;
  hasSecond: boolean;
  onOpenPresets: () => void;
  onNext: () => void;
  onBack: () => void;
  onDone: () => void;
}) {
  if (step === total - 1) {
    return (
      <>
        <Button variant="outline" onClick={onBack}>Back</Button>
        <Button onClick={onDone}>Done</Button>
      </>
    );
  }
  if (step === 0) {
    return (
      <>
        <Button variant="outline" onClick={onOpenPresets}>Open Agent Presets</Button>
        {hasSecond || total > 1 ? <Button onClick={onNext}>Next</Button> : <Button onClick={onDone}>Got it</Button>}
      </>
    );
  }
  return (
    <>
      <Button variant="outline" onClick={onBack}>Back</Button>
      <Button onClick={onNext}>Next</Button>
    </>
  );
}

function PresetOnboardingDialog({ storageKey, title, intro, children, onOpenPresets, active, secondTitle, secondBody }: {
  storageKey: string;
  title: string;
  intro: string;
  children?: React.ReactNode;
  onOpenPresets: () => void;
  active: boolean;
  secondTitle?: string;
  secondBody?: React.ReactNode;
}) {
  const [open, setOpen] = useState<boolean>(false);
  const [step, setStep] = useState(0);
  // When the shared presets step was already acknowledged on another track,
  // the dialog opens straight at the second panel — the step counter
  // would reference a step the user never saw, so it stays hidden.
  const [singleStep, setSingleStep] = useState(false);
  function showStep(next: number, single: boolean) { setStep(next); setSingleStep(single); }
  const hasSecond = !!secondTitle;
  const total = onboardingTotal(hasSecond);
  const lastStep = total - 1;
  // Shared presets onboarding: configuring (or acknowledging) presets on
  // any track counts for all tracks — Research/Explore stay silent, Build
  // still opens straight into its defaults step.
  const isSharedDone = () => {
    try { return window.localStorage.getItem(STORAGE_KEYS.onboardPresets) === "onboarded"; } catch { return false; }
  };
  const markSharedDone = () => {
    try { window.localStorage.setItem(STORAGE_KEYS.onboardPresets, "onboarded"); } catch { /* best-effort */ }
  };
  useEffect(() => {
    if (!active || open) return;
    try {
      if (window.localStorage.getItem(storageKey) === "onboarded") return;
      if (isSharedDone()) {
        if (hasSecond) { showStep(1, true); setOpen(true); }
        return;
      }
      showStep(0, false);
      setOpen(true);
    } catch { /* best-effort */ }
  }, [active, open, storageKey, hasSecond]);
  function dismiss() {
    setOpen(false);
    showStep(0, false);
    try { window.localStorage.setItem(storageKey, "onboarded"); } catch { /* best-effort */ }
    markSharedDone();
  }
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) dismiss(); }}>
      <DialogContent className={`${hasSecond ? "sm:max-w-2xl" : "sm:max-w-lg"} sm:max-h-[calc(100dvh-1rem)] sm:overflow-y-auto`}>
        <DialogHeader>
          <DialogTitle>{step === lastStep ? "Stay in touch" : step === 1 && secondTitle ? secondTitle : title}</DialogTitle>
          <DialogDescription>{step === lastStep ? "Feedback and follow-ups." : step === 1 && secondTitle ? "Defaults new cards start from." : intro}</DialogDescription>
        </DialogHeader>
        {!singleStep && total > 1 ? <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Step {step + 1} of {total}</p> : null}
        <PresetOnboardingBody step={step} total={total} secondBody={secondBody}>{children}</PresetOnboardingBody>
        <DialogFooter>
          <PresetOnboardingFooter
            step={step}
            total={total}
            hasSecond={hasSecond}
            onOpenPresets={() => { markSharedDone(); onOpenPresets(); }}
            onNext={() => setStep(step + 1)}
            onBack={() => setStep(step - 1)}
            onDone={dismiss}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const PRESET_REASONING_LEVELS = ["low", "medium", "high", "xhigh", "max", "none", "ultra", "ultracode"] as const;
type PresetReasoningLevel = (typeof PRESET_REASONING_LEVELS)[number];
type PresetExecution = { providerId: string; modelId: string; reasoningLevel: string; permissionMode: "accept-edits" | "auto" | "full" };
// Legacy rows may carry a reasoning string outside the host catalog: coerce
// to the shared level set instead of handing the picker an unknown value.
function asPresetReasoningLevel(value: string): PresetReasoningLevel {
  return (PRESET_REASONING_LEVELS as readonly string[]).includes(value) ? (value as PresetReasoningLevel) : "medium";
}

// BB owns provider/model/reasoning/permission selection on every preset
// surface: the same host pickers as the new-card composer, with the live
// catalog and its own search. One shared block for the manager form and the
// assign dialog's custom row — never hand-rolled provider/model selects.
function PresetExecutionPicker({ value, onChange }: {
  value: PresetExecution;
  onChange: (next: PresetExecution) => void;
}) {
  if (!value.providerId || !value.modelId) {
    return <p className="py-2 text-xs text-muted-foreground">Pick or create a preset to configure its provider and model.</p>;
  }
  return (
    <div className="grid gap-2">
      <ProviderModelPicker
        value={{ providerId: value.providerId, model: value.modelId, reasoningLevel: asPresetReasoningLevel(value.reasoningLevel) }}
        onChange={(next) => onChange({ ...value, providerId: next.providerId, modelId: next.model, reasoningLevel: next.reasoningLevel })}
      />
      <label className="flex flex-col gap-1 text-xs text-muted-foreground"><span>Permission mode</span>
        <PermissionModePicker
          providerId={value.providerId}
          value={value.permissionMode}
          onChange={(next) => onChange({ ...value, permissionMode: next })}
        />
      </label>
    </div>
  );
}

type DecisionApiConfig = { endpoint: string; model: string; hasKey: boolean; keySource: string | null; keyRequired: boolean; disabled: boolean; provider: string; configured: boolean };
type DecisionPointRoute = { provider: string | null; endpoint: string | null; apiKey: string | null; model: string | null };
type DecisionRouterPoint = { id: string; label: string; description: string; rules: string; requires: string | null; modes: string[]; mode: string; thresholds: Record<string, number>; route: DecisionPointRoute | null; presetId: string | null };
type RouterPresetOption = { id: string; name: string };
type ManagerRpc = ReturnType<typeof useRpc<typeof rpcContract>>;

function modeLabel(mode: string): string {
  if (mode === "api") return "Decision API";
  if (mode === "preset") return "Preset judge";
  return "Built-in rules (default)";
}

// One Jev-compatible endpoint for every router below. Endpoint, key, and
// model live here once as the shared default — points may override fields
// per router or judge via any provider preset, so a key rotation still
// touches exactly one field unless a point pins its own.
function DecisionApiSection({ rpc }: { rpc: ManagerRpc }) {
  const [endpoint, setEndpoint] = useState("");
  const [model, setModel] = useState("");
  const [provider, setProvider] = useState("jev");
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<DecisionApiConfig | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(() => {
    void rpc.call("getDecisionApiConfig", {}).then((result) => {
      setStatus(result); setEndpoint(result.endpoint); setModel(result.model); setProvider(result.provider); setKey(""); setMessage(null);
    }).catch(() => setMessage("Could not load the Decision API settings."));
  }, [rpc]);
  useEffect(() => { reload(); }, [reload]);
  function pickProvider(next: string) {
    setProvider(next);
    // Follow the provider switch with its default endpoint, unless the
    // endpoint was customized (a custom URL survives provider flips).
    const knownDefaults = DECISION_PROVIDERS.map((entry) => entry.defaultEndpoint);
    if (endpoint === "" || knownDefaults.includes(endpoint)) {
      setEndpoint(DECISION_PROVIDERS.find((entry) => entry.id === next)?.defaultEndpoint ?? endpoint);
    }
    if (model === "" || DECISION_PROVIDERS.some((entry) => entry.defaultModel !== "" && entry.defaultModel === model)) {
      setModel(DECISION_PROVIDERS.find((entry) => entry.id === next)?.defaultModel ?? model);
    }
  }
  async function save(clearKey: boolean) {
    setBusy(true); setMessage(null);
    try {
      const result = await rpc.call("setDecisionApiConfig", { endpoint: endpoint.trim() || null, model: model.trim() || null, provider, apiKey: clearKey ? null : (key ? key : undefined) });
      setMessage(result.error ?? "Saved.");
      setKey("");
      reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }
  async function probe() {
    setBusy(true); setMessage(null);
    try {
      const result = await rpc.call("testDecisionApi", {});
      setMessage(result.ok ? `Probe ok · ${result.latencyMs ?? "?"}ms · ${result.model ?? "unknown model"}` : (result.error ?? "Probe failed."));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Probe failed.");
    } finally {
      setBusy(false);
    }
  }
  const providerEntry = DECISION_PROVIDERS.find((entry) => entry.id === provider) ?? null;
  const providerNeedsKey = providerEntry ? providerEntry.needsKey : true;
  const providerTakesModel = providerEntry ? providerEntry.takesModel : true;
  const keyHint = !status ? "Loading…" : status.disabled ? "Disabled on this host (STELOW_DECISION_API=0)." : !providerNeedsKey ? "No key needed (free tier, rate-limited)." : status.keySource === "env" ? "Key from environment (env wins over stored)." : status.hasKey ? "Key stored — leave blank to keep it." : "No key yet. Routers fall back to built-in rules.";
  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">One decision endpoint for every router below. Set the provider first — the rest follows its schema.</p>
      {status && !status.configured ? <p className="text-xs text-muted-foreground" role="status">Showing defaults — nothing saved yet. Save to make these yours.</p> : null}
      {status?.disabled ? <p className="text-xs text-muted-foreground" role="status">Decision API is disabled on this host (STELOW_DECISION_API=0). Routers answer with built-in rules.</p> : null}
      <label className="flex flex-col gap-1 text-xs text-muted-foreground"><span>Provider</span>
        <select
          className="cursor-pointer h-9 rounded-md border bg-background px-2 text-sm"
          value={provider}
          disabled={status?.disabled}
          onChange={(event) => pickProvider(event.target.value)}
        >
          <option value="jev">TypeSafe AI&apos;s Jev-compatible</option>
          {DECISION_PROVIDERS.filter((entry) => entry.id !== "jev").map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select>
      </label>
      {providerEntry && providerEntry.schema === "jev" && providerNeedsKey ? <p className="text-[11px] text-muted-foreground">State + questions schema — endpoint + key + model required.</p> : null}
      {providerEntry && providerEntry.schema === "jev" && !providerNeedsKey ? <p className="text-[11px] text-muted-foreground">State + questions schema — endpoint + model, no key.</p> : null}
      {providerEntry && providerEntry.schema === "labels" ? <p className="text-[11px] text-muted-foreground">Labels schema — endpoint only, no key; Choice questions only.</p> : null}
      <label className="flex flex-col gap-1 text-xs text-muted-foreground"><span>Endpoint</span><Input value={endpoint} disabled={status?.disabled} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://api.typesafe.ai/v1/systemone" /></label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground"><span>Model</span><Input value={model} disabled={status?.disabled || !providerTakesModel} onChange={(event) => setModel(event.target.value)} placeholder="jev-latest" /></label>
      {!providerTakesModel ? <p className="text-[11px] text-muted-foreground">This provider answers on its own tier; model does not apply.</p> : null}
      <label className="flex flex-col gap-1 text-xs text-muted-foreground"><span>API key</span><Input type="password" value={key} disabled={status?.disabled} onChange={(event) => setKey(event.target.value)} placeholder={keyHint} autoComplete="off" /></label>
      {message ? <p className="text-xs text-muted-foreground" role="status">{message}</p> : null}
      <div className="flex justify-end gap-2">
        {status?.hasKey && status.keySource !== "env" && !status.disabled ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save(true)}>Clear key</Button> : null}
        <Button size="sm" variant="outline" disabled={busy || status?.disabled} onClick={() => void probe()}>{busy ? "Working…" : "Test connection"}</Button>
        <Button size="sm" disabled={busy || status?.disabled} onClick={() => void save(false)}>{busy ? "Working…" : "Save"}</Button>
      </div>
    </div>
  );
}

function DecisionRouterRow({ rpc, point, presets, refresh }: { rpc: ManagerRpc; point: DecisionRouterPoint; presets: RouterPresetOption[]; refresh: () => Promise<void> }) {
  // Mode selection is a local draft until saved: flipping the select never
  // fires a request by itself, so preset mode can explain itself and ask
  // for a preset before anything is stored.
  const [modeDraft, setModeDraft] = useState(point.mode);
  const [routeAt, setRouteAt] = useState(String(point.thresholds.routeAt ?? 0.6));
  const [presetId, setPresetId] = useState(point.presetId ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  useEffect(() => {
    setModeDraft(point.mode);
    setRouteAt(String(point.thresholds.routeAt ?? 0.6));
    setPresetId(point.presetId ?? "");
  }, [point]);
  function note(text: string, error: boolean) {
    setMessage(text);
    setIsError(error);
  }
  async function save(input: { mode?: string; presetId?: string | null }) {
    setBusy(true); note("", false);
    try {
      const result = await rpc.call("setDecisionPoint", { point: point.id, mode: input.mode ?? point.mode, ...(input.presetId !== undefined ? { presetId: input.presetId } : {}) });
      if (result.error) note(result.error, true); else { note("Saved.", false); await refresh(); }
    } catch (err) {
      note(err instanceof Error ? err.message : "Save failed.", true);
    } finally {
      setBusy(false);
    }
  }
  async function saveThreshold() {
    setBusy(true); note("", false);
    try {
      // A pending mode flip rides along: saving the threshold never wipes
      // an unsaved mode draft on the subsequent refresh.
      const result = await rpc.call("setDecisionPoint", { point: point.id, mode: modeDraft, thresholds: { routeAt: Number(routeAt) } });
      if (result.error) note(result.error, true); else { note("Saved.", false); await refresh(); }
    } catch (err) {
      note(err instanceof Error ? err.message : "Save failed.", true);
    } finally {
      setBusy(false);
    }
  }
  const dirty = Number(routeAt) !== (point.thresholds.routeAt ?? 0.6);
  const valid = routeAt.trim() !== "" && Number.isFinite(Number(routeAt)) && Number(routeAt) >= 0 && Number(routeAt) <= 1;
  const modeDirty = modeDraft !== point.mode;
  return (
    <div className="space-y-1 rounded-md border bg-muted/30 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate" title={point.description}><span className="font-medium">{point.label}</span></span>
        <select
          aria-label={`${point.label} mode`}
          className="cursor-pointer h-11 shrink-0 rounded-md border bg-background px-2 text-sm"
          value={modeDraft}
          disabled={busy}
          onChange={(event) => { setModeDraft(event.target.value); note("", false); }}
        >
          {point.modes.map((mode) => <option key={mode} value={mode}>{modeLabel(mode)}</option>)}
        </select>
        {modeDirty && modeDraft !== "preset" ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({ mode: modeDraft })}>Save</Button> : null}
      </div>
      <p className="text-[11px] text-muted-foreground">{point.description}</p>
      {point.mode === "rules" && modeDraft === "rules" ? <p className="text-[11px] text-muted-foreground">Built-in rules: {point.rules}</p> : null}
      {point.requires ? <p className="text-[11px] text-muted-foreground">Needs: {point.requires}</p> : null}
      {modeDraft === "api" || modeDraft === "preset" ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <label className="flex flex-1 items-center gap-2"><span className="shrink-0">Act at confidence ≥</span>
            <Input type="number" min="0" max="1" step="0.05" className="h-11" value={routeAt} onChange={(event) => setRouteAt(event.target.value)} />
          </label>
          <Button size="sm" variant="outline" disabled={busy || !dirty || !valid} onClick={() => void saveThreshold()}>Save</Button>
        </div>
      ) : null}
      {modeDraft === "preset" ? (
        <div className="space-y-1 text-xs text-muted-foreground">
          <p className="text-[11px]">Preset judge asks one of your provider presets to answer this judgment in a hidden thread — one thread per judgment, archived right after. Pick this when you trust one of your own models more than the shared endpoint above. Any preset works, including one no workflow stage uses. Each judgment costs a provider turn; failures fall back to built-in rules.</p>
          {presets.length === 0 ? <p className="text-[11px]" role="status">No presets yet — create one under Agent Presets, then pick it here.</p> : null}
          <div className="flex items-center gap-2">
            <select aria-label={`${point.label} judge preset`} className="cursor-pointer h-11 flex-1 rounded-md border bg-background px-2 text-sm text-foreground" value={presetId} disabled={busy} onChange={(event) => { setPresetId(event.target.value); note("", false); }}>
              <option value="">Pick a preset…</option>
              {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
            </select>
            <Button size="sm" variant="outline" disabled={busy || presetId.trim() === ""} onClick={() => void save({ mode: "preset", presetId: presetId.trim() })}>Save preset</Button>
          </div>
          {point.mode === "preset" && point.presetId ? <p className="text-[11px]">Judging on {presets.find((preset) => preset.id === point.presetId)?.name ?? point.presetId}.</p> : null}
        </div>
      ) : null}
      {message ? <p className="text-[11px] text-destructive" role={isError ? "alert" : "status"}>{message}</p> : null}
    </div>
  );
}

function DecisionRoutersSection({ rpc }: { rpc: ManagerRpc }) {
  const [points, setPoints] = useState<DecisionRouterPoint[]>([]);
  const [presets, setPresets] = useState<RouterPresetOption[]>([]);
  const [keyMissing, setKeyMissing] = useState(false);
  const reload = useCallback(() => {
    void rpc.call("listDecisionPoints", {}).then((result) => setPoints(result.points)).catch(() => setPoints([]));
    void rpc.call("listPresets", {}).then((result) => setPresets(result.presets.map((preset) => ({ id: preset.id, name: preset.name })))).catch(() => setPresets([]));
    void rpc.call("getDecisionApiConfig", {}).then((result) => setKeyMissing(result.keyRequired && !result.hasKey)).catch(() => setKeyMissing(false));
  }, [rpc]);
  useEffect(() => { reload(); }, [reload]);
  const keylessApi = keyMissing && points.some((point) => point.mode === "api");
  // Router saves refresh only this section: point state lives nowhere else,
  // so flipping a mode never pays for a board reload.
  const refresh = useCallback(async () => { reload(); }, [reload]);
  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">Each router picks how one judgment runs. Built-in rules run inside existing workers and host code — no extra calls, no keys. Decision API needs the section above. Anything unconfigured answers with built-in rules.</p>
      {keylessApi ? <p className="text-xs text-muted-foreground" role="status">Decision API has no key — api routers answer with built-in rules until one is set.</p> : null}
      {points.map((point) => <DecisionRouterRow key={point.id} rpc={rpc} point={point} presets={presets} refresh={refresh} />)}
    </div>
  );
}

function PresetManagerDialog({ open, onOpenChange, rpc, presets, onChanged }: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  rpc: ReturnType<typeof useRpc<typeof rpcContract>>;
  presets: PresetManagerPreset[];
  onChanged: () => Promise<void>;
}) {
  const [form, setForm] = useState(EMPTY_PRESET_FORM);
  // The preset form stays collapsed until asked for: the list + band
  // routing are the frequent jobs, authoring a preset is the rare one.
  // Editing always expands (startEdit opens); closing the dialog resets.
  const [formOpen, setFormOpen] = useState(false);
  const [bandPresets, setBandPresets] = useState<{ band: string; presetId: string | null; stages: string[] }[]>([]);
  const [generationPreset, setGenerationPreset] = useState<{ id: string; name: string } | null>(null);
  const [reliablePreset, setReliablePreset] = useState<{ id: string; name: string } | null>(null);
  const [reviewerPreset, setReviewerPreset] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);
  // Creation sits with the list now, but a long list can still push it out
  // of view — bring it back when it opens instead of stranding the user.
  useEffect(() => {
    if (formOpen) formRef.current?.scrollIntoView({ block: "nearest" });
  }, [formOpen]);
  const reloadGeneration = useCallback(() => {
    void rpc.call("getGenerationPreset", {}).then((result) => setGenerationPreset(result.preset)).catch(() => setGenerationPreset(null));
  }, [rpc]);
  const reloadReliable = useCallback(() => {
    void rpc.call("getReliablePreset", {}).then((result) => setReliablePreset(result.preset)).catch(() => setReliablePreset(null));
  }, [rpc]);
  const reloadReviewer = useCallback(() => {
    void rpc.call("getReviewPreset", {}).then((result) => setReviewerPreset(result.preset)).catch(() => setReviewerPreset(null));
  }, [rpc]);

  useEffect(() => {
    if (!open) {
      setForm(EMPTY_PRESET_FORM);
      setFormOpen(false);
      return;
    }
    const defaultPreset = presets.find((preset) => preset.isDefault) ?? presets[0] ?? null;
    setForm(defaultPreset ? { id: null, name: "", providerId: defaultPreset.providerId, modelId: defaultPreset.modelId, reasoningLevel: defaultPreset.reasoningLevel, permissionMode: defaultPreset.permissionMode as "accept-edits" | "auto" | "full", environmentKind: defaultPreset.environmentKind as "project-default" | "new-worktree" } : EMPTY_PRESET_FORM);
    setMessage(null);
    void rpc.call("listBandPresets", {}).then((result) => setBandPresets(result.bands)).catch(() => setBandPresets([]));
    reloadGeneration();
    reloadReliable();
    reloadReviewer();
  }, [open, rpc, reloadGeneration, reloadReliable, reloadReviewer]);

  const newPresetForm = () => {
    const defaultPreset = presets.find((preset) => preset.isDefault) ?? presets[0] ?? null;
    return defaultPreset ? { id: null, name: "", providerId: defaultPreset.providerId, modelId: defaultPreset.modelId, reasoningLevel: defaultPreset.reasoningLevel, permissionMode: defaultPreset.permissionMode as "accept-edits" | "auto" | "full", environmentKind: defaultPreset.environmentKind as "project-default" | "new-worktree" } : EMPTY_PRESET_FORM;
  };
  const startNew = () => { setForm(newPresetForm()); setFormOpen(true); setMessage(null); };
  const startEdit = (preset: PresetManagerPreset) => { setForm({ id: preset.id, name: preset.name, providerId: preset.providerId, modelId: preset.modelId, reasoningLevel: preset.reasoningLevel, permissionMode: preset.permissionMode as "accept-edits" | "auto" | "full", environmentKind: preset.environmentKind as "project-default" | "new-worktree" }); setFormOpen(true); setMessage(null); };

  async function save() {
    if (!form.name.trim()) { setMessage("Name is required."); return; }
    setBusy(true);
    setMessage(null);
    try {
      const result = await rpc.call("upsertPreset", { id: form.id, name: form.name.trim(), providerId: form.providerId, modelId: form.modelId, reasoningLevel: form.reasoningLevel, permissionMode: form.permissionMode, environmentKind: form.environmentKind, baseBranch: null, machineId: null, instructions: "" });
      setForm((current) => ({ ...current, id: result.preset.id }));
      setMessage(`Saved ${result.preset.name}.`);
      await onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(preset: PresetManagerPreset) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await rpc.call("deletePreset", { id: preset.id });
      setMessage(result.error ?? `Removed ${preset.name}.`);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function setDefault(preset: PresetManagerPreset) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await rpc.call("setDefaultPreset", { id: preset.id });
      setMessage(result.error ?? `${preset.name} is now the default.`);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent fullscreenOnMobile className="overflow-y-auto sm:max-h-[calc(100dvh-1rem)] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Manage agent presets</DialogTitle>
          <DialogDescription>Presets set the provider, model, reasoning level, and permission mode used when a card starts its worker thread. Research investigations use the research phase preset.</DialogDescription>
        </DialogHeader>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Presets ({presets.length})</h3>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => { startNew(); }}>New preset</Button>
        </div>
        <div className="max-h-56 space-y-1.5 overflow-auto pr-1">
          {presets.length === 0 ? <p className="text-sm text-muted-foreground">No presets yet. Create one below.</p> : null}
          {presets.map((preset) => (
            <div key={preset.id} className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{preset.name}</span>
                <span className="ml-2 text-muted-foreground">{preset.providerId}/{preset.modelId} · {preset.reasoningLevel} · {preset.permissionMode}</span>
              </span>
              {preset.isDefault ? <Pill tone="bg-primary/15 text-primary">default</Pill> : null}
              {preset.builtIn ? <Pill>built-in</Pill> : null}
              <div className="flex shrink-0 gap-1">
                {!preset.isDefault ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void setDefault(preset)}>Set default</Button> : null}
                <Button size="sm" variant="outline" disabled={busy} onClick={() => startEdit(preset)}>Edit</Button>
                {!preset.builtIn ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void remove(preset)}>Delete</Button> : null}
              </div>
            </div>
          ))}
        </div>
        <div ref={formRef} className="mt-3 rounded-md border bg-muted/30 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">{form.id ? `Edit ${form.name}` : "New preset"}</h4>
            <div className="flex shrink-0 gap-1">
              {form.id ? <Button size="sm" variant="ghost" onClick={startNew}>New preset</Button> : null}
              <Button size="sm" variant="ghost" aria-expanded={formOpen} aria-controls="preset-form-body" onClick={() => setFormOpen((open) => !open)} title={formOpen ? "Collapse the preset form" : "Expand the preset form"}><DisclosureChevron open={formOpen} />{formOpen ? "Hide" : "Show"}</Button>
            </div>
          </div>
          {formOpen ? (
            <div id="preset-form-body">
            <div className="grid gap-2">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground"><span>Name</span><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Default" /></label>
              <PresetExecutionPicker value={{ providerId: form.providerId, modelId: form.modelId, reasoningLevel: form.reasoningLevel, permissionMode: form.permissionMode }} onChange={(next) => setForm({ ...form, providerId: next.providerId, modelId: next.modelId, reasoningLevel: next.reasoningLevel, permissionMode: next.permissionMode })} />
            </div>
            {message ? <p className="mt-2 text-xs text-muted-foreground">{message}</p> : null}
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              <Button size="sm" disabled={busy} onClick={() => void save()}>{busy ? "Working…" : form.id ? "Save changes" : "Create preset"}</Button>
            </div>
            </div>
          ) : null}
        </div>
        <DisclosureSection title="Worker preset per track" hint="phase routing" defaultOpen={false}>
          <p className="mb-2 text-xs text-muted-foreground">Each track runs on its own preset. Build phases can each override it; the worker switches automatically at phase boundaries. Unset rows fall back to the card preset (or default).</p>
          <div className="grid gap-3">
            {[
              { track: "Research", bands: ["research"] },
              { track: "Explore", bands: ["explore"] },
              { track: "Build", bands: ["analysis", "planning", "execution", "review"] },
            ].map((group) => (
              <div key={group.track} className="space-y-2">
                <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.track}</h5>
                {group.bands.map((bandName) => {
                  const band = bandPresets.find((entry) => entry.band === bandName);
                  if (!band) return null;
                  return (
                    <div key={band.band} className="flex items-center gap-2 text-sm">
                      <span className="w-24 shrink-0 capitalize">{group.track === "Build" ? band.band : "preset"}</span>
                      <select
                        className="cursor-pointer h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
                        value={band.presetId ?? ""}
                        onChange={(event) => {
                          const value = event.target.value || null;
                          setBusy(true);
                          void rpc.call("setBandPreset", { band: band.band, presetId: value }).then(() => { void onChanged(); void rpc.call("listBandPresets", {}).then((result) => setBandPresets(result.bands)).catch(() => setBandPresets([])); }).catch(() => setMessage("Failed to set phase preset.")).finally(() => setBusy(false));
                        }}
                      >
                        <option value="">Use card default</option>
                        {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                      </select>
                      <span className="w-28 shrink-0 truncate text-right text-[11px] text-muted-foreground" title={band.stages.join(", ")}>{band.stages.join(", ")}</span>
                    </div>
                  );
                })}
              </div>
            ))}
            {(() => {
              const known = new Set(["research", "explore", "analysis", "planning", "execution", "review"]);
              const extra = bandPresets.filter((entry) => !known.has(entry.band));
              if (extra.length === 0) return null;
              return (
                <div className="space-y-2">
                  <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Other</h5>
                  {extra.map((band) => (
                    <div key={band.band} className="flex items-center gap-2 text-sm">
                      <span className="w-24 shrink-0 capitalize">{band.band}</span>
                      <select
                        className="cursor-pointer h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
                        value={band.presetId ?? ""}
                        onChange={(event) => {
                          const value = event.target.value || null;
                          setBusy(true);
                          void rpc.call("setBandPreset", { band: band.band, presetId: value }).then(() => { void onChanged(); void rpc.call("listBandPresets", {}).then((result) => setBandPresets(result.bands)).catch(() => setBandPresets([])); }).catch(() => setMessage("Failed to set phase preset.")).finally(() => setBusy(false));
                        }}
                      >
                        <option value="">Use card default</option>
                        {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                      </select>
                      <span className="w-28 shrink-0 truncate text-right text-[11px] text-muted-foreground" title={band.stages.join(", ")}>{band.stages.join(", ")}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </DisclosureSection>
        <DisclosureSection title="Delegated work" hint="subagent tiers" defaultOpen={false}>
          <p className="mb-2 text-xs text-muted-foreground">Work the host delegates to subthreads. Empty selects revert to the band preset — except Review, where empty means no reviewer.</p>
          <div className="grid gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm">
                <span className="w-24 shrink-0">✓ Reliable</span>
                <select
                  className="cursor-pointer h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
                  value={reliablePreset?.id ?? ""}
                  onChange={(event) => {
                    const value = event.target.value || null;
                    setBusy(true);
                    void rpc.call("assignReliablePreset", { presetId: value }).then(() => { void onChanged(); reloadReliable(); }).catch(() => setMessage("Failed to set reliable preset.")).finally(() => setBusy(false));
                  }}
                >
                  <option value="">Use band preset</option>
                  {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                </select>
                <span className="w-28 shrink-0 truncate text-right text-[11px] text-muted-foreground" title="Tools, file shapes, multi-step work">reliable tier</span>
              </div>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Demanding delegated work — automation drafts, research fan-out, any burst the worker keeps rewriting. Runs with tools: pick a strong preset.</p>
            </div>
            <div>
              <div className="flex items-center gap-2 text-sm">
                <span className="w-24 shrink-0">⚡ Generation</span>
                <select
                  className="cursor-pointer h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
                  value={generationPreset?.id ?? ""}
                  onChange={(event) => {
                    const value = event.target.value || null;
                    setBusy(true);
                    void rpc.call("assignGenerationPreset", { presetId: value }).then(() => { void onChanged(); reloadGeneration(); }).catch(() => setMessage("Failed to set generation preset.")).finally(() => setBusy(false));
                  }}
                >
                  <option value="">Use band preset</option>
                  {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                </select>
                <span className="w-28 shrink-0 truncate text-right text-[11px] text-muted-foreground" title="Disposable text-only bursts judged by the worker">draft bursts</span>
              </div>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Short disposable texts your card's worker requests mid-work — a commit-message draft, a changelog line, a fresh card title. Text in, text out; the worker judges every word before using it.</p>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">Rule of thumb: when the worker rewrites over 20% of a burst&apos;s output, that call site belongs back on Reliable.</p>
          <div className="mt-3 border-t border-border/70 pt-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="w-24 shrink-0">◎ Independent review</span>
              <select
                aria-label="Artifact reviewer preset"
                className="cursor-pointer h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
                value={reviewerPreset?.id ?? ""}
                onChange={(event) => {
                  const value = event.target.value || null;
                  setBusy(true);
                  void rpc.call("assignReviewPreset", { presetId: value }).then(() => { void onChanged(); reloadReviewer(); }).catch(() => setMessage("Failed to set reviewer preset.")).finally(() => setBusy(false));
                }}
              >
                <option value="">No reviewer</option>
                {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
              </select>
              <span className="w-28 shrink-0 truncate text-right text-[11px] text-muted-foreground" title="Independent artifact review, never a worker fallback">independent review</span>
            </div>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">A second pair of eyes from a different model family, read-only. Used when a finished research, exploration, or document gets an independent review before you trust it — later, the same independence can pre-check gates and plans. Without a designation, reviews refuse instead of borrowing a worker preset.</p>
          </div>
        </DisclosureSection>
        <DisclosureSection title="Decision API" hint="Jev-compatible" defaultOpen={false}>
          <DecisionApiSection rpc={rpc} />
        </DisclosureSection>
        <DisclosureSection title="Decision routers" hint="per-judgment modes" defaultOpen={false}>
          <DecisionRoutersSection rpc={rpc} />
        </DisclosureSection>
      </DialogContent>
    </Dialog>
  );
}

type WorkspaceRecoveryData = {
  kind: "attached" | "promote" | "external-project" | "ambiguous" | "documents-only";
  message: string;
  candidates: Array<{ projectId: string; projectName: string; path: string; branch: string | null; headSha: string | null; changedFiles: number; evidence: string }>;
  looseEvidence: Array<{ path: string; kind: "folder" | "patch" }>;
  recovery: { projectId: string; projectName: string; path: string; attachedAt: number } | null;
  audit: { cardId: string; cardName: string; createdAt: number } | null;
};

function WorkspaceRecoveryPanel({ recovery, loading, onRefresh, onPromote, onAttach, onCreateAudit, onOpenAudit }: { recovery: WorkspaceRecoveryData | null; loading: boolean; onRefresh: () => void; onPromote: () => void; onAttach: (projectId: string) => void; onCreateAudit: () => void; onOpenAudit: (cardId: string) => void }) {
  return <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-950 dark:text-amber-100">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">Workspace recovery</p><Button size="sm" variant="outline" disabled={loading} onClick={onRefresh}>{loading ? "Checking…" : "Re-check evidence"}</Button></div>
    {!recovery && !loading ? <p>Checking whether this exploratory card has source material or a worker-reported registered checkout…</p> : null}
    {recovery ? <>
      <p>{recovery.message}</p>
      {recovery.kind === "documents-only" ? <p className="text-amber-900/80 dark:text-amber-100/80">Artifacts remain readable, but there is no verified code checkout to recover. New Build cards now require a project workspace.</p> : null}
      {recovery.kind === "promote" ? <Button size="sm" variant="outline" onClick={onPromote}>Turn this source workspace into a project…</Button> : null}
      {recovery.candidates.length > 0 ? <div className="space-y-2 border-t border-amber-500/20 pt-2">
        <p className="text-amber-900/80 dark:text-amber-100/80">{recovery.kind === "promote" ? "This workspace also has a checkout the worker reported writing to. If the real work lives there instead, review and attach it below." : "Only registered BB projects on the same host, explicitly named by the worker, are offered."} Attaching records provenance; it never moves files, stages changes, commits, or pushes.</p>
        {recovery.candidates.map((candidate) => <div key={`${candidate.projectId}-${candidate.path}`} className="rounded border border-amber-500/20 bg-background/60 p-2 text-foreground">
          <p className="font-medium">{candidate.projectName} · <code>{candidate.branch ?? "detached"}</code></p>
          <p className="mt-1 break-all text-muted-foreground"><code>{candidate.path}</code> · {candidate.changedFiles} changed files · HEAD {candidate.headSha?.slice(0, 12) ?? "unknown"}</p>
          <p className="mt-1 text-muted-foreground">{candidate.evidence}</p>
          <Button className="mt-2" size="sm" variant="outline" onClick={() => onAttach(candidate.projectId)} title="Records this reviewed checkout on the card. It does not change the checkout or Git.">Attach for audit trail…</Button>
        </div>)}
      </div> : null}
      {recovery.looseEvidence.length > 0 ? <div className="space-y-1 border-t border-amber-500/20 pt-2"><p className="text-amber-900/80 dark:text-amber-100/80">Reported loose evidence is preserved but never auto-applied: choose and review its destination in a recovery audit first.</p>{recovery.looseEvidence.map((entry) => <p key={entry.path} className="break-all text-muted-foreground"><code>{entry.path}</code> · {entry.kind === "patch" ? "patch/bundle" : "folder"}</p>)}</div> : null}
      {recovery.kind === "attached" && recovery.recovery ? <div className="rounded border border-emerald-500/30 bg-emerald-500/10 p-2"><p className="font-medium">Attached: {recovery.recovery.projectName}</p><p className="mt-1 break-all text-emerald-900/80 dark:text-emerald-100/80"><code>{recovery.recovery.path}</code> · attached {new Date(recovery.recovery.attachedAt).toLocaleString()}</p><p className="mt-1 text-emerald-900/80 dark:text-emerald-100/80">This original card is preserved as a mismatch record. A separate Build recovery audit owns review, tests, commits, and PRs.</p>{recovery.audit ? <Button className="mt-2" size="sm" variant="outline" onClick={() => onOpenAudit(recovery.audit!.cardId)}>Open recovery audit</Button> : <Button className="mt-2" size="sm" variant="outline" onClick={onCreateAudit}>Create recovery audit</Button>}</div> : null}
    </> : null}
  </div>;
}

// Hybrid (A+D+E): single contextual hero derived from card state. One plain
// sentence + one primary action. Replaces the scattered error / paused /
// decision banners with one ordered attention model:
// decision > error > paused > working > calm.
function PresetAssignDialog({ open, onOpenChange, cardId, onChanged }: { open: boolean; onOpenChange: (next: boolean) => void; cardId: string; onChanged: () => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const [presets, setPresets] = useState<Array<{ id: string; name: string; providerId: string; modelId: string; reasoningLevel: string; permissionMode: string; environmentKind: string; isDefault: boolean }>>([]);
  const [catalog, setCatalog] = useState<{ providers: { id: string; displayName: string; modelsAvailable: boolean }[]; models: { providerId: string; model: string; displayName: string }[] }>({ providers: [], models: [] });
  const [customProvider, setCustomProvider] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [customReasoning, setCustomReasoning] = useState("");
  const [customPermission, setCustomPermission] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const updateFade = () => {
    const el = listRef.current;
    if (el) setCanScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
  };
  useEffect(() => {
    if (!open) return;
    setSelected(null); setError(null); setCustomProvider(""); setCustomModel(""); setCustomReasoning(""); setCustomPermission("");
    void rpc.call("listPresets", {}).then((result) => setPresets(result.presets)).catch(() => setPresets([]));
    void rpc.call("listProviderModels", {}).then(setCatalog).catch(() => setCatalog({ providers: [], models: [] }));
  }, [open, rpc]);
  useEffect(() => { updateFade(); }, [open, presets, catalog]);
  const defaultPreset = presets.find((preset) => preset.isDefault) ?? null;
  const customPresets = presets.filter((preset) => !preset.isDefault);
  const optionCount = customPresets.length + catalog.models.length + 2; // default + custom rows
  async function apply() {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      if (selected === "default") {
        const result = await rpc.call("assignPreset", { cardId, presetId: null });
        if (!result.ok) setError(result.error ?? "Could not reset preset.");
        else { onOpenChange(false); onChanged(); toast.success("Preset reset to board default."); }
      } else if (selected.startsWith("preset:")) {
        const result = await rpc.call("assignPreset", { cardId, presetId: selected.slice("preset:".length) });
        if (!result.ok) setError(result.error ?? "Could not change preset.");
        else { onOpenChange(false); onChanged(); toast.success("Preset overridden for this card. Resume only continues the current worker — use Restart worker to switch to the new preset now."); }
      } else if (selected.startsWith("model:")) {
        const [providerId, ...modelParts] = selected.slice("model:".length).split("/");
        await applyCustom(providerId ?? "", modelParts.join("/"));
      } else if (selected === "custom") {
        await applyCustom(
          customProvider || defaultPreset?.providerId || "",
          customModel.trim() || defaultPreset?.modelId || "",
          customReasoning || defaultPreset?.reasoningLevel || "medium",
          (customPermission || defaultPreset?.permissionMode || "full") as "accept-edits" | "auto" | "full",
        );
      }
    } finally {
      setBusy(false);
    }
  }
  async function applyCustom(providerId: string, modelId: string, reasoningLevel?: string, permissionMode?: "accept-edits" | "auto" | "full") {
    if (!providerId || !modelId) { setError("Pick a provider and type a model id."); return; }
    const base = defaultPreset;
    const upserted = await rpc.call("upsertPreset", {
      id: `card-override-${cardId}`,
      name: `Card override ${cardId}`,
      providerId,
      modelId,
      reasoningLevel: reasoningLevel ?? base?.reasoningLevel ?? "medium",
      permissionMode: permissionMode ?? (base?.permissionMode as "accept-edits" | "auto" | "full" | undefined) ?? "full",
      environmentKind: (base?.environmentKind as "project-default" | "new-worktree" | undefined) ?? "project-default",
    });
    const result = await rpc.call("assignPreset", { cardId, presetId: upserted.preset.id });
    if (!result.ok) setError(result.error ?? "Could not change preset.");
    else { onOpenChange(false); onChanged(); toast.success("Preset overridden for this card. Resume only continues the current worker — use Restart worker to switch to the new preset now."); }
  }
  const radioRow = (value: string, title: React.ReactNode, sub?: string) => (
    <label key={value} className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm ${selected === value ? "border-primary bg-primary/10" : "border-border"}`}>
      <input type="radio" name="card-preset" checked={selected === value} onChange={() => setSelected(value)} className="accent-primary" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {sub ? <span className="block truncate font-mono text-[11px] text-muted-foreground">{sub}</span> : null}
      </span>
    </label>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agent preset for this card</DialogTitle>
          <DialogDescription>Takes effect when the worker (re)starts.</DialogDescription>
        </DialogHeader>
        <p className="text-[11px] text-muted-foreground">{optionCount} options · {catalog.providers.length} providers — scroll for more below.</p>
        <div className="relative">
          <div ref={listRef} onScroll={updateFade} className="max-h-64 space-y-1 overflow-auto">
          <div>
            <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Custom provider + model</p>
            <label className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm ${selected === "custom" ? "border-primary bg-primary/10" : "border-border"}`}>
              <input type="radio" name="card-preset" checked={selected === "custom"} onChange={() => setSelected("custom")} className="accent-primary mt-1" />
              <span className="min-w-0 flex-1" onClick={(event) => event.stopPropagation()}>
                <PresetExecutionPicker
                  value={{
                    providerId: customProvider || defaultPreset?.providerId || "",
                    modelId: customModel || defaultPreset?.modelId || "",
                    reasoningLevel: customReasoning || defaultPreset?.reasoningLevel || "medium",
                    permissionMode: (customPermission || defaultPreset?.permissionMode || "full") as "accept-edits" | "auto" | "full",
                  }}
                  onChange={(next) => { setCustomProvider(next.providerId); setCustomModel(next.modelId); setCustomReasoning(next.reasoningLevel); setCustomPermission(next.permissionMode); setSelected("custom"); }}
                />
              </span>
            </label>
          </div>
          {radioRow("default", <>Board default{defaultPreset ? ` · ${defaultPreset.name}` : ""}</>, defaultPreset ? `${defaultPreset.providerId}/${defaultPreset.modelId}` : undefined)}
          {customPresets.map((preset) => radioRow(`preset:${preset.id}`, preset.name, `${preset.providerId}/${preset.modelId}`))}
          {catalog.providers.map((provider) => {
            const providerModels = catalog.models.filter((model) => model.providerId === provider.id);
            return (
              <div key={provider.id} className="pt-1">
                <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{provider.displayName} · {providerModels.length}</p>
                <div className="space-y-1">
                  {providerModels.map((model) => radioRow(`model:${provider.id}/${model.model}`, model.displayName, `${provider.id}/${model.model}`))}
                  {providerModels.length === 0 ? <p className="px-1 text-[11px] text-muted-foreground">{provider.modelsAvailable ? "No models listed for this provider." : "Couldn't load models — use Custom below."}</p> : null}
                </div>
              </div>
            );
          })}
          {presets.length === 0 && catalog.providers.length === 0 ? <p className="text-xs text-muted-foreground">No presets or providers available.</p> : null}
          </div>
          {canScrollDown ? <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-background to-transparent" /> : null}
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button disabled={busy || !selected || (selected === "custom" && (!customProvider || !customModel.trim()))} onClick={() => void apply()}>{busy ? "Applying…" : "Apply"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Shared worker block: preset readout, state-appropriate recovery, and worker
// history. Card lifecycle actions deliberately live in the card header.

function fmtGapMs(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return hours % 24 === 0 ? `${hours / 24}d` : `${Math.floor(hours / 24)}d ${hours % 24}h`;
  return `${Math.floor(hours / 24)}d`;
}

// Build gaps: the ESCALATED → rework-scope loop surfaced on the mother
// card. Resolved live through gapSummary — counts by resolution, each
// escalation linked to its audit-gap scope status, plus lead/cycle time.
// Read-only: workers advance the loop through gap-scopes and done, whose
// refusals name the fix. Renders nothing before the first critique.
function BuildGapsSection({ cardId }: { cardId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [summary, setSummary] = useState<{
    matched: boolean; total: number; fixed: number; documented: number; escalated: number;
    items: Array<{ description: string; scopeStatus: string | null }>;
    pendingScopes: number; unscoped: number;
    leadMs: number | null; cycleMs: number | null; done: boolean;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void rpc.call("gapSummary", { cardId }).then((result) => { if (!cancelled) setSummary(result); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [rpc, cardId]);
  if (!summary?.matched) return null;
  const blocked = summary.unscoped > 0 || summary.pendingScopes > 0;
  const lead = fmtGapMs(summary.leadMs);
  const cycle = fmtGapMs(summary.cycleMs);
  return (
    <section aria-label="Gaps and rework" className="rounded-lg border p-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Gaps &amp; rework</h3>
      <p className="pt-1 text-xs text-muted-foreground" title="From the execution critique Gap Registry">
        {summary.total} gap{summary.total === 1 ? "" : "s"} · {summary.fixed} fixed · {summary.documented} documented · {summary.escalated} escalated
        {lead ? ` · lead ${lead}` : ""}{cycle ? ` · cycle ${cycle}` : ""}
      </p>
      {summary.escalated > 0 ? (
        <ul className="space-y-1 pt-2">
          {summary.items.map((item) => (
            <li key={item.description} className="flex items-start gap-2 text-xs">
              <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${item.scopeStatus && isDoneStatus(item.scopeStatus) ? "bg-emerald-500" : "bg-amber-500"}`} />
              <span className="flex-1">{item.description}</span>
              {item.scopeStatus ? <Pill tone={statusTone(item.scopeStatus)}><span className="mr-1">{statusGlyph(item.scopeStatus)}</span>{statusLabel(item.scopeStatus)}</Pill> : <span className="text-amber-700 dark:text-amber-300">no scope yet</span>}
            </li>
          ))}
        </ul>
      ) : null}
      {blocked && !summary.done ? (
        <p className="pt-2 text-xs text-amber-700 dark:text-amber-300">
          {summary.unscoped > 0 ? `Done waits on ${summary.unscoped} escalated gap${summary.unscoped === 1 ? "" : "s"} without a rework scope — this card loops back: the worker runs gap-scopes, advances to execution, executes the new scopes, and re-runs the critique. ` : ""}
          {summary.pendingScopes > 0 ? `${summary.pendingScopes} rework scope${summary.pendingScopes === 1 ? "" : "s"} still open.` : ""}
        </p>
      ) : null}
      {summary.escalated > 0 && !blocked ? <p className="pt-2 text-xs text-muted-foreground">Every escalation links a finished rework scope.</p> : null}
    </section>
  );
}

function CardDetailBody({ cardId, inboxEventId, onClose, onBack, navigate }: { cardId: string; inboxEventId: string | null; onClose: () => void; onBack?: () => void; navigate: ReturnType<typeof useBbNavigate> }) {
  const rpc = useRpc<typeof rpcContract>();
  const [card, setCard] = useState<CardItem | null>(null);
  const [detail, setDetail] = useState<CardDetailResponse | null>(null);
  const [detailRefresh, setDetailRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState<string | null>(null);
  const [pendingAdvance, setPendingAdvance] = useState<string | null>(null);
  const [repairOpen, setRepairOpen] = useState(false);
  const [restartWorkerOpen, setRestartWorkerOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [starting, setStarting] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [splitError, setSplitError] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardConfirm, setDiscardConfirm] = useState<{ title: string; body: string } | null>(null);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoteName, setPromoteName] = useState("");
  const [promoting, setPromoting] = useState(false);
  const [githubPostOpen, setGithubPostOpen] = useState(false);
  type PublicationStatus = Awaited<ReturnType<typeof rpc.call<"publicationStatus">>>;
  const [publication, setPublication] = useState<PublicationStatus | null>(null);
  const [publicationLoading, setPublicationLoading] = useState(false);
  const [publicationAction, setPublicationAction] = useState<"commit" | "squash" | "push" | "sync" | "ready" | "draft" | "merge" | null>(null);
  const [publicationSubmitting, setPublicationSubmitting] = useState(false);
  type PublicationCommitDiff = Awaited<ReturnType<typeof rpc.call<"publicationCommitDiff">>>;
  const [publicationCommitSha, setPublicationCommitSha] = useState<string | null>(null);
  const [publicationCommitDiff, setPublicationCommitDiff] = useState<PublicationCommitDiff | null>(null);
  const [publicationCommitDiffLoading, setPublicationCommitDiffLoading] = useState(false);
  // Commit file accordions start collapsed (remount per Expand/Collapse all
  // via epoch so individual toggles keep working uncontrolled afterwards).
  const [commitFilesExpanded, setCommitFilesExpanded] = useState(false);
  const [commitFilesEpoch, setCommitFilesEpoch] = useState(0);
  const [mergeMethod, setMergeMethod] = useState<"merge" | "rebase" | "squash">("squash");
  type PushTerminals = Awaited<ReturnType<typeof rpc.call<"publicationPushTerminals">>>;
  const [pushTerminals, setPushTerminals] = useState<PushTerminals | null>(null);
  const [pushTerminalsLoading, setPushTerminalsLoading] = useState(false);
  const publicationDefaultBranch = publication?.branch?.default ?? null;
  const publishesToDefaultBranch = Boolean(publicationDefaultBranch && publication?.branch?.current === publicationDefaultBranch);
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [viewerFile, setViewerFile] = useState<{ display: string; path: string; target: WorkspaceFileTarget | HostFileTarget | null; mode?: ArtifactViewerMode } | null>(null);
  const [inboxEvent, setInboxEvent] = useState<InboxEventSnapshot | null>(null);
  const inboxEventRef = useRef<HTMLElement | null>(null);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  // Workflow map open state drives its own chevron explicitly: no reliance
  // on CSS group-open variants, and the native marker stays hidden so the
  // affordance is exactly one arrow.
  const [mapOpen, setMapOpen] = useState(false);
  // Native <details> chevrons frozen before (CSS group-open never fired
  // here): every collapsible drives its arrow from explicit open state.
  const [advancedGitOpen, setAdvancedGitOpen] = useState(false);
  type CardDiff = { found: boolean; isRepo: boolean; files: Array<{ path: string; display: string; patch: string | null; isNew: boolean; absolutePath: string; hostId: string }>; truncated: boolean; entitySummary: { total: number; fileCount: number; added: number; modified: number; deleted: number; renamed: number; moved: number; cosmeticOnly: boolean } | null; changedSymbols: Array<{ symbol: string; files: string[]; callers: number; testCallers: number }> | null };
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffData, setDiffData] = useState<CardDiff | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  type WorkspaceRecovery = Awaited<ReturnType<typeof rpc.call<"workspaceRecovery">>>;
  const [workspaceRecovery, setWorkspaceRecovery] = useState<WorkspaceRecovery | null>(null);
  const [workspaceRecoveryLoading, setWorkspaceRecoveryLoading] = useState(false);
  const [recoveryAttachProjectId, setRecoveryAttachProjectId] = useState<string | null>(null);
  const [creatingRecoveryAudit, setCreatingRecoveryAudit] = useState(false);
  const artifactsRef = useRef<HTMLDivElement | null>(null);
  // One way in: the progress section's file count opens Artifacts and brings
  // it into view. Instant scroll (no smooth) to respect reduced motion.
  const showArtifacts = useCallback(() => {
    setArtifactsOpen(true);
    requestAnimationFrame(() => artifactsRef.current?.scrollIntoView({ block: "nearest" }));
  }, []);

  const load = useCallback(async () => {
    try {
      const detailResult = await rpc.call("cardDetail", { cardId });
      const eventResult = inboxEventId ? await rpc.call("getNotification", { notificationId: inboxEventId, cardId }) : null;
      setDetail(detailResult);
      setCard(detailResult.card);
      setInboxEvent(eventResult?.notification ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load card.");
    }
  }, [cardId, inboxEventId, rpc]);
  const { comment, setComment, submitComment } = useDetailComment({ cardId, onChanged: load });

  const loadWorkspaceRecovery = useCallback(async () => {
    if (card?.workspaceKind !== "exploratory") { setWorkspaceRecovery(null); return; }
    setWorkspaceRecoveryLoading(true);
    try { setWorkspaceRecovery(await rpc.call("workspaceRecovery", { cardId })); }
    catch { setWorkspaceRecovery(null); }
    finally { setWorkspaceRecoveryLoading(false); }
  }, [card?.workspaceKind, cardId, rpc]);

  useEffect(() => { void load(); }, [load, detailRefresh]);
  useEffect(() => { void loadWorkspaceRecovery(); }, [loadWorkspaceRecovery]);
  useDebouncedRealtime(["card-state", "inbox-changed"], () => void load());
  // Viewing a completed card marks its completion seen (read, never
  // resolved): the badge drops, Recent updates keeps the entry. Fires on
  // mount-if-completed and on the transition; steady state never refires
  // because the dep is the status value, not the card object.
  useEffect(() => {
    if (card?.status === "completed") void rpc.call("markCardNotificationsRead", { cardId, kind: "completed" }).catch(() => {});
  }, [cardId, card?.status, rpc]);
  // A completed card's deliverable IS its evidence, so Artifacts opens by
  // default there: the two receipts and their verification state are the first
  // thing on the card, instead of behind the disclosure that serves live work.
  useEffect(() => {
    if (card?.status === "completed") setArtifactsOpen(true);
  }, [card?.status]);
  useInboxEventFocus(inboxEventId, inboxEvent, inboxEventRef);

  const loadPublication = useCallback(async () => {
    if (card?.status !== "completed") { setPublication(null); return; }
    setPublicationLoading(true);
    try {
      setPublication(await rpc.call("publicationStatus", { cardId }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to inspect publication status.");
    } finally {
      setPublicationLoading(false);
    }
  }, [card?.status, cardId, rpc]);

  useEffect(() => { void loadPublication(); }, [loadPublication]);

  const loadPushTerminals = useCallback(async () => {
    if (card?.status !== "completed") { setPushTerminals(null); return; }
    setPushTerminalsLoading(true);
    try {
      setPushTerminals(await rpc.call("publicationPushTerminals", { cardId }));
    } catch (err) {
      setPushTerminals({ ok: false, error: err instanceof Error ? err.message : "Unable to list push shells.", remote: null, terminals: [] });
    } finally {
      setPushTerminalsLoading(false);
    }
  }, [card?.status, cardId, rpc]);

  useEffect(() => { void loadPushTerminals(); }, [loadPushTerminals]);
  // Follow-up result checks after a push run: cleared on unmount so a
  // closed card never refreshes into thin air.
  const pushRefreshTimers = useRef<number[]>([]);
  useEffect(() => () => { for (const timer of pushRefreshTimers.current) window.clearTimeout(timer); pushRefreshTimers.current = []; }, []);

  async function doArchive() {
    setArchiveOpen(false);
    try {
      const result = await rpc.call("cancelCard", { cardId });
      if (!result.archived) {
        toast.error("Archive did not take — the card is gone.");
        return;
      }
      toast.success("Card archived.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Archive failed.");
    }
  }

  async function doDelete() {
    setDeleteOpen(false);
    const result = await rpc.call("deleteCard", { cardId });
    if (!result.deleted) {
      toast.error(result.error ?? "Delete failed.");
      return;
    }
    toast.success("Card deleted.");
    onClose();
  }

  async function openDiscard() {
    try {
      const preview = await rpc.call("discardPreview", { cardId });
      if (!preview.eligible) {
        toast.error(preview.reason ?? "Nothing safe to discard.");
        return;
      }
      setDiscardConfirm({ title: preview.confirmTitle ?? "Discard this card’s work?", body: preview.confirmBody ?? "" });
      setDiscardOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not inspect the checkout.");
    }
  }

  async function doDiscard() {
    setDiscardOpen(false);
    try {
      const result = await rpc.call("discardCardChanges", { cardId });
      if (!result.ok) {
        toast.error(result.error ?? "Discard failed.");
        return;
      }
      toast.success(result.summary ?? "Card work discarded.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Discard failed.");
    }
  }

  async function doPromote() {
    if (!card) return;
    setPromoting(true);
    try {
      const result = await rpc.call("promoteCard", { cardId, name: promoteName.trim() || card.displayName });
      if (!result.ok) {
        toast.error(result.error ?? "Could not turn into project.");
        return;
      }
      setPromoteOpen(false);
      toast.success(`Project "${result.projectName}" created — a new project worker is continuing the workflow.`);
      await load();
    } finally {
      setPromoting(false);
    }
  }

  async function doAttachRecoveryCheckout() {
    if (!recoveryAttachProjectId) return;
    const result = await rpc.call("attachRecoveryCheckout", { cardId, projectId: recoveryAttachProjectId });
    if (!result.ok) {
      toast.error(result.error ?? "Could not attach the checkout.");
      return;
    }
    setRecoveryAttachProjectId(null);
    toast.success("Checkout attached for review. No files, branch, or Git history were changed.");
    await Promise.all([loadWorkspaceRecovery(), load()]);
  }

  async function doCreateRecoveryAudit() {
    setCreatingRecoveryAudit(true);
    try {
      const result = await rpc.call("createRecoveryAudit", { cardId });
      if (!result.ok || !result.auditCardId) {
        toast.error(result.error ?? "Could not create the recovery audit.");
        return;
      }
      toast.success("Recovery audit started in the registered project workspace.");
      await Promise.all([loadWorkspaceRecovery(), load()]);
      goToCard(navigate, { kind: "build" }, result.auditCardId);
    } finally {
      setCreatingRecoveryAudit(false);
    }
  }

  async function doRepair(intent?: string): Promise<boolean> {
    setRepairOpen(false);
    const result = await rpc.call("reseedCard", { cardId, ...(intent ? { intent: intent as "new-product" | "feature" | "bugfix" | "refactor" | "investigate" | "unknown" } : {}) });
    if (!result.reseeded) {
      toast.error(result.error ?? "Restart failed");
      return false;
    }
    toast.success(result.reclassified ? `Workflow reclassified as ${INTENT_LABEL[intent ?? ""] ?? intent} and restarted from triage.` : "Fresh worker started from triage.");
    await load();
    return true;
  }

  async function doRetry() {
    setRetrying(true);
    try {
      const result = await rpc.call("retryWorker", { cardId });
      if (!result.ok) toast.error(result.error ?? "Retry failed. Try Restart fresh instead.");
      else toast.success("Worker retried — continuing from the current stage.");
      await load();
    } finally {
      setRetrying(false);
    }
  }

  async function doRestartWorker() {
    setRestartWorkerOpen(false);
    setRestarting(true);
    try {
      const result = await rpc.call("restartWorker", { cardId });
      if (!result.ok) toast.error(result.error ?? "Restart failed.");
      else toast.success("Worker restarted — continuing from the current stage.");
      await load();
    } finally {
      setRestarting(false);
    }
  }

  // Leaving the Bucket is what starts a parked card: the same start path the
  // board's drag uses, so the card never claims to be running without a
  // worker behind it.
  async function doStart() {
    setStarting(true);
    try {
      const result = await rpc.call("startWorker", { cardId });
      if (!result.ok) toast.error(result.error ?? "Start failed.");
      else toast.success("Worker started — the card moved from Bucket and is triaging.");
      await load();
    } finally {
      setStarting(false);
    }
  }

  async function doRequestSplit() {
    setSplitting(true); setSplitError(null);
    try {
      const result = await rpc.call("requestSplitProposal", { cardId });
      if (!result.ok) setSplitError(result.error ?? "Could not request a split.");
      else { toast.success("Split requested — answer the worker's proposal on this card."); await load(); }
    } catch (err) {
      setSplitError(err instanceof Error ? err.message : "Could not request a split.");
    } finally {
      setSplitting(false);
    }
  }

  async function doPublicationAction() {
    const action = publicationAction;
    if (!action || publicationSubmitting) return;
    setPublicationSubmitting(true);
    try {
      if (action === "commit") {
        const result = await rpc.call("publicationCommit", { cardId });
        if (!result.ok) toast.error(result.message);
        else toast.success(result.commitSha ? `Committed ${result.commitSha.slice(0, 7)}.` : result.message);
      } else if (action === "squash") {
        const result = await rpc.call("publicationSquashMerge", { cardId });
        if (!result.ok) toast.error(result.message);
        else toast.success(result.commitSha ? `Squash merged as ${result.commitSha.slice(0, 7)}.` : result.message);
      } else if (action === "push") {
        const result = await rpc.call("publicationPushTerminal", { cardId });
        if (!result.ok) toast.error(result.message);
        else toast.success(result.message);
        await loadPushTerminals();
        // The push runs async in its shell: re-check so the result lands
        // without the user having to press Check result.
        pushRefreshTimers.current.push(window.setTimeout(() => void loadPushTerminals(), 8000));
        pushRefreshTimers.current.push(window.setTimeout(() => void loadPushTerminals(), 20000));
      } else if (action === "sync") {
        const result = await rpc.call("publicationPullPush", { cardId });
        if (!result.ok) toast.error(result.message);
        else toast.success(result.message);
        await loadPushTerminals();
        pushRefreshTimers.current.push(window.setTimeout(() => void loadPushTerminals(), 10000));
        pushRefreshTimers.current.push(window.setTimeout(() => void loadPushTerminals(), 25000));
      } else {
        const result = await rpc.call("publicationPullRequestAction", { cardId, operation: action, ...(action === "merge" ? { method: mergeMethod } : {}) });
        if (!result.ok) toast.error(result.message);
        else toast.success(result.message);
      }
    } finally {
      setPublicationSubmitting(false);
      setPublicationAction(null);
      await loadPublication();
      await load();
    }
  }

  async function openPublicationCommit(commitSha: string) {
    setPublicationCommitSha(commitSha);
    setPublicationCommitDiff(null);
    setPublicationCommitDiffLoading(true);
    setCommitFilesExpanded(false);
    setCommitFilesEpoch((epoch) => epoch + 1);
    try {
      setPublicationCommitDiff(await rpc.call("publicationCommitDiff", { cardId, commitSha }));
    } catch (err) {
      setPublicationCommitDiff({ found: false, commitSha: null, shortstat: null, files: [], truncated: false, error: err instanceof Error ? err.message : "Unable to load this commit." });
    } finally {
      setPublicationCommitDiffLoading(false);
    }
  }

  async function copyCommitSha(commitSha: string) {
    await copyText(commitSha, "Commit SHA");
  }

  async function copyText(text: string, label: string) {
    // The Clipboard API is unavailable in some panel contexts (permissions,
    // insecure frame): fall back to a hidden textarea + execCommand before
    // giving up. The final error carries the value so it stays copyable.
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied.`);
      return;
    } catch { /* fall through to the legacy path */ }
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      if (ok) {
        toast.success(`${label} copied.`);
        return;
      }
    } catch { /* fall through to the manual path */ }
    toast.error(`Copy failed — select and copy by hand: ${text}`);
  }

  async function advance(stage: string) {
    setAdvancing(stage);
    try {
      const result = await rpc.call("advanceCard", { cardId, stage });
      if (!result.ok) toast.error(result.error ?? "Advance failed");
      else toast.success(`Advanced to ${stage}`);
      await load();
    } finally {
      setAdvancing(null);
    }
  }

  // A fetched pending question wins over a possibly stale activity snapshot:
  // decision > error > paused > working > calm.
  const pendingFirst = detail?.pendingQuestions?.[0] ?? null;

  const hero = card ? heroFor(card, detail) : null;
  const heroStyle = hero ? HERO_STYLE[hero.kind] : null;
  const archivedPresentation = card ? archivedCardDetailPresentation(card, stageLabel) : null;
  const completedWorkerPreset = card?.status === "completed"
    ? detail?.workerHistory.find((worker) => worker.threadId === card.workerThreadId)?.presetName ?? detail?.card.presetName ?? "Default"
    : null;
  // Provider/model are fixed at spawn: a preset change only lands when a new
  // worker starts. Retry continues the SAME thread, so while the running
  // worker predates the override the hero must offer Restart, not Resume.
  // Staleness is the explicit restart-pending flag (set on assign, healed by
  // thread-birth comparison) with id-mismatch as backup.
  const presetStale = Boolean(detail && card?.workerThreadId && (detail.card.presetRestartPending || (detail.card.workerPresetId && detail.card.workerPresetId !== detail.card.presetId)));
  const scopeDone = detail?.scopes.filter((s) => isDoneStatus(s.status ?? "")).length ?? 0;
  const scopeTotal = detail?.scopes.length ?? 0;
  const openScope = detail?.scopes.find((s) => s.status === "in-progress") ?? null;
  const artifactTotal = detail?.artifacts.filter((artifact) => artifact.role !== "evidence").length ?? 0;
  const artifactEvidenceTotal = detail?.artifacts.filter((artifact) => artifact.role === "evidence").length ?? 0;
  // Gate review entry: the document the pending decision is actually about.
  // The pending question's own option artifact wins: board position (card.stage)
  // deliberately stays at the last advanced stage while a question waits (see
  // lib/card-question-state), so a gate-stage manifest lookup alone can point
  // at the wrong file when two planning documents exist. Manifest is the
  // second source, newest artifact only the last resort.
  const GATE_ARTIFACT_STAGE: Record<string, string> = { gate: "shape", "int-gate": "interface", selection: "interface", "plan-gate": "planning" };
  // Evidence attached to a pending or recoverable question — the document
  // under decision even when the manifest doesn't list it yet. Same
  // viewer, same shape: option artifacts carry display/path/absolute/host.
  const pendingQuestionArtifact = detail
    ? [...detail.pendingQuestions, ...detail.expiredQuestions].flatMap((q) => q.options ?? []).find((o) => o?.artifact)?.artifact ?? null
    : null;
  const reviewArtifact = detail && card && (hero?.kind === "decision" || detail.pendingQuestions.length > 0)
    ? pendingQuestionArtifact ?? detail.artifacts.filter((artifact) => artifact.role !== "evidence").find((artifact) => artifact.stage === (GATE_ARTIFACT_STAGE[card.stage] ?? "")) ?? detail.artifacts.filter((artifact) => artifact.role !== "evidence").pop() ?? null
    : null;
  // Viewer-ready shape, narrowed once here (property narrowing does not
  // survive into the onClick closure below). The button only renders when a
  // readable absolute path exists; agent-produced labels fall back plainly.
  const reviewTarget = reviewArtifact?.absolutePath
    ? { display: reviewArtifact.display ?? "artifact", path: reviewArtifact.absolutePath, relPath: reviewArtifact.path ?? reviewArtifact.absolutePath, hostId: reviewArtifact.hostId ?? "" }
    : null;

  return (
    <div className="flex h-full flex-col">
      <CardDetailHeader
        card={card}
        onBack={onBack}
        onRestartFresh={() => setRepairOpen(true)}
        onArchive={() => setArchiveOpen(true)}
        onDiscard={() => void openDiscard()}
        onDelete={() => setDeleteOpen(true)}
        onReclassify={doRepair}
        statusTone={statusTone}
        intentLabel={(intent) => INTENT_LABEL[intent]}
      />
      <div className="flex-1 overflow-auto p-4">
        <div className="mx-auto w-full max-w-3xl space-y-6">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {card && card.kind === "research" ? (
          <ResearchDetailBody
            cardId={cardId}
            inboxEventId={inboxEventId}
            inboxEvent={inboxEvent}
            card={card}
            detail={detail}
            onChanged={() => void load()}
            renderPresetDialog={({ open, onOpenChange, onChanged }) => (
              <PresetAssignDialog open={open} onOpenChange={onOpenChange} cardId={cardId} onChanged={onChanged} />
            )}
          />
        ) : null}
        {card && card.kind === "explore" ? (
          <ExploreDetailBody
            cardId={cardId}
            inboxEventId={inboxEventId}
            inboxEvent={inboxEvent}
            card={card}
            detail={detail}
            onChanged={() => void load()}
            renderPresetDialog={({ open, onOpenChange, onChanged }) => (
              <PresetAssignDialog open={open} onOpenChange={onOpenChange} cardId={cardId} onChanged={onChanged} />
            )}
          />
        ) : null}
        {card && card.kind === "build" ? (
          <>
            <InboxEventBanner visible={Boolean(inboxEventId) && shouldShowInboxEventBanner(inboxEvent, hero)} event={inboxEvent} sectionRef={inboxEventRef} />
            {/* HERO — one contextual sentence + one primary action (D primary, A type scale) */}
            {hero && heroStyle ? (
              <section aria-label="Card status" {...(heroStyle.alert ? { role: "alert" } : {})} className={`rounded-lg border p-4 ${heroStyle.wrap}`}>
                <div className="flex items-start gap-2.5">
                  <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${heroStyle.dot}`} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <h2 className="text-[16px] font-semibold leading-snug tracking-tight text-foreground">{hero.title}</h2>
                    <p className="text-sm leading-relaxed text-muted-foreground">{hero.sub}</p>
                    <p className="pt-1 text-[15px] leading-relaxed text-foreground">{card.prompt}</p>
                    {card.workspaceKind === "exploratory" ? <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" title={card.workspacePath ?? undefined}><span>Exploratory work · stored locally</span>{workspaceRecovery?.kind === "promote" ? <Button size="sm" variant="outline" onClick={() => { setPromoteName(card.displayName); setPromoteOpen(true); }} title="This workspace contains source material. Create a BB project without moving files.">Turn into project…</Button> : null}{workspaceRecovery && workspaceRecovery.kind !== "attached" && workspaceRecovery.candidates.length > 0 ? <span className="font-medium text-amber-800 dark:text-amber-200">Reported code checkout needs review below.</span> : null}</p> : null}
                    {/* One primary action per state; secondary actions are real
                        buttons (outline/ghost) so affordances never read as
                        body text. */}
                    <DetailHeroActions
                      card={card}
                      heroKind={hero.kind}
                      pending={Boolean(pendingFirst)}
                      preset={{ stale: presetStale, providerId: detail?.card.presetProviderId ?? null, modelId: detail?.card.presetModelId ?? null }}
                      state={{ starting, retrying, restarting }}
                      continuation="continuing from the current stage"
                      retryTail=" from the current stage"
                      extra={hero.kind === "decision" && reviewTarget ? (
                        <span className="w-full">
                          <Button size="sm" variant="outline" onClick={() => setViewerFile({ display: reviewTarget.display, path: reviewTarget.path, target: fileLinkTarget(card.workspaceKind === "exploratory", detail?.fileEnvironmentId ?? null, reviewTarget.relPath, reviewTarget.hostId, reviewTarget.path), mode: "review" })} title={`Read ${reviewTarget.display} before deciding`}>Review {reviewTarget.display} ↗</Button>
                        </span>
                      ) : null}
                      onStart={doStart}
                      onRetry={doRetry}
                      onRestart={() => setRestartWorkerOpen(true)}
                    />
                  </div>
                </div>
                {pendingFirst ? (
                  <div className="mt-3 space-y-2 border-t border-amber-500/20 pt-3">
                    <QuestionBatch cardId={card.id} mode="live" questions={detail?.pendingQuestions.map((q) => ({ id: q.id, title: q.title, prompt: q.question, multiple: q.multiple, kind: q.kind, options: q.options, staleness: q.staleness ?? null })) ?? []} onAnswered={() => void load()} onOpenArtifact={(a, mode) => openAskArtifact(card, detail?.fileEnvironmentId ?? null, setViewerFile, a, mode)} />
                  </div>
                ) : null}
                {detail?.splitAction?.show ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                    {detail.splitAction.ok ? (
                      <>
                        <Button size="sm" variant="outline" disabled={splitting} onClick={() => void doRequestSplit()} title="Ask the worker for a real split proposal now (one option per delivery plus Keep as one card). Only a --tag split proposal can create cards.">Propose split…</Button>
                        <span className="text-xs text-muted-foreground">One option per delivery, approved by you, executed by the host.</span>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">{detail.splitAction.reason}</span>
                    )}
                    {splitError ? <span className="w-full text-xs text-destructive">{splitError}</span> : null}
                  </div>
                ) : null}
                {detail && detail.expiredQuestions.length > 0 ? <div className="mt-3 border-t border-amber-500/20 pt-3"><ExpiredQuestionsSection cardId={card.id} questions={detail.expiredQuestions} onOpenArtifact={(a, mode) => openAskArtifact(card, detail.fileEnvironmentId, setViewerFile, a, mode)} onAnswered={() => void load()} /></div> : null}
              </section>
            ) : null}

            <WorkerSection
              card={card}
              detail={detail}
              presetStale={presetStale}
              restarting={restarting}
              onRestartWorker={() => setRestartWorkerOpen(true)}
              onPreset={() => setPresetDialogOpen(true)}
              presetPill={card.status === "completed" ? <>Completed · {completedWorkerPreset}</> : <>{card.stage ? `${BAND_LABEL[STAGE_BAND[card.stage] ?? "analysis"]} · ` : ""}{detail?.card.presetName ?? "default"}</>}
              presetNote={card.status === "completed" ? <>Preset recorded for the completed worker.</> : <>{card.stage ? <strong>{stageLabel(card.stage)}</strong> : "current"} phase{detail?.card.presetOverridden ? " — overridden for this card" : " — board default"} · applies to the next worker</>}
              pillTitle={card.status === "completed" ? "Preset used by the completed worker" : card.stage ? `Preset for the ${stageLabel(card.stage)} phase` : "Preset for the next worker"}
              githubLink={detail?.githubLink ? (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>Imported from <UrlLink href={detail.githubLink.url} className="font-medium text-primary underline-offset-4 hover:underline">{detail.githubLink.repo}#{detail.githubLink.number}</UrlLink></span>
                  {card.status === "completed" ? (
                    detail.githubLink.postedAt ? (
                      <span className="text-emerald-700 dark:text-emerald-300">✓ Completion summary posted to GitHub</span>
                    ) : (
                      <button onClick={() => setGithubPostOpen(true)} className="cursor-pointer min-h-11 font-medium text-primary hover:underline">Share completion summary on GitHub…</button>
                    )
                  ) : (
                    <span>A completion summary can be posted once this card is Done.</span>
                  )}
                </div>
              ) : null}
              checkoutNote={checkoutNoteFor(detail?.card.environmentLabel, publication?.branch?.current)}
            />

            <InputFiles card={card} detail={detail} onView={(file) => setViewerFile(file)} />

            {/* Preview sits above progress: once the card is ready, seeing the
                result matters more than following the stages. */}
            <PreviewSection cardId={card.id} />

            {/* DISCLOSURE 1 — Workflow progress: where this card is, and the
                one way to the files it produced. The reference (Workflow map)
                is its own sibling section, never nested in here. */}
            <DisclosureSection
              title={archivedPresentation?.workflow.title ?? "Workflow progress"}
              subtitle={archivedPresentation ? undefined : scopeTotal > 0 || card?.status === "completed" ? "where this card is" : <>where this card is · <CurrentStagePill stage={card.stage} /></>}
              hint={archivedPresentation?.workflow.hint ?? (scopeTotal > 0 ? `${scopeDone}/${scopeTotal} scopes${openScope ? ` · now: ${openScope.name}` : ""}` : undefined)}
              // Production rides the action slot (count + the single way to the
              // files) so no fact is printed twice once the section is open.
              action={artifactTotal > 0 ? (
                <button
                  type="button"
                  onClick={showArtifacts}
                  title="Open this card's Artifacts section"
                  className="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-md px-2 text-xs font-medium text-primary hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  {artifactTotal} file{artifactTotal === 1 ? "" : "s"} ↓
                </button>
              ) : null}
              defaultOpen={hero?.kind === "working" || hero?.kind === "calm"}
            >
              {card.stage === "select" && !archivedPresentation ? (
                <p className="text-xs text-muted-foreground">
                  Item selection: pick the item in the thread — the agent advances on its own, or advance manually below.
                </p>
              ) : null}
              {detail?.scopeSync && (detail.scopeSync.state === "human-dialect" || detail.scopeSync.state === "unsynced") ? (
                <p className="text-xs text-amber-700 dark:text-amber-300" role="status">
                  {card?.status === "completed" || card?.status === "archived"
                    ? `Scope sync parsed 0 of ${(detail.scopeSync.humanBlocks || detail.scopeSync.machineBlocks)} planned scopes — this card ended before tracking was established (pre-guard format). Its audit record below is the evidence of what was verified.`
                    : detail.scopeSync.state === "human-dialect"
                      ? `Scope sync parsed 0 of ${detail.scopeSync.humanBlocks} planned scopes — ${detail.scopeSync.specFile ?? "the spec"} uses headings instead of machine blocks. Rewrite openers as [SCOPE-N] Title, resync, then advance.`
                      : `Scope sync parsed 0 of ${detail.scopeSync.machineBlocks} planned scopes — run bb stelow sync-scopes, then advance again.`}
                </p>
              ) : null}
              {detail ? <CardChecksSection cardId={card.id} card={card} detail={detail} /> : null}
              {detail && detail.scopes.length > 0 ? <><ScopeProgress scopes={detail.scopes} flow={{ leadMs: detail.card.leadMs ?? null, cycleMs: detail.card.cycleMs ?? null }} /><ScopesList scopes={detail.scopes} statusTone={statusTone} statusGlyph={statusGlyph} statusLabel={statusLabel} /></> : <p className="text-xs text-muted-foreground">{archivedPresentation?.workflow.emptyScopes ?? (card?.status === "completed" ? "Completed without scoped execution — no scope was ever tracked (pre-guard format). Verify the work through the audit record and files below; reopen an earlier stage to continue it under tracking." : "No scopes broken down yet — the agent is still shaping the card.")}</p>}
              {detail ? (
                <div className="space-y-2 border-t pt-3">
                  <StageTimeline
                    currentStage={card.stage}
                    terminal={card?.status === "completed" ? "completed" : card?.status === "archived" ? "archived" : undefined}
                    nextStages={detail.nextStages}
                    artifacts={detail.artifacts}
                    onPick={(stage) => setPendingAdvance(stage)}
                    skips={detail.stageSkips ?? { offRoute: [], skipped: [] }}
                    offRouteReason={card.intent && card.intent !== "unknown" ? `Not in this ${INTENT_LABEL[card.intent] ?? card.intent} route` : null}
                  />
                  {/* Coaching follows the thing it explains, and only when there
                      is something to click. Archived cards already say why
                      they stopped in the summary. */}
                  {card.status === "archived" ? null : (
                    <p className="text-xs text-muted-foreground">{card.status === "completed" ? "Workflow complete — choose an earlier stage to reopen it" : "The agent advances on its own · click a lit stage to override"}</p>
                  )}
                </div>
              ) : null}
              {detail?.mentionedFiles && detail.mentionedFiles.length > 0 ? (
                <div className="space-y-1 border-t pt-3">
                  <span className="text-xs font-medium text-muted-foreground">Files named in your request ({detail.mentionedFiles.length}):</span>
                  <p className="text-[11px] text-muted-foreground">Paths your request spells out that exist in this workspace. Nothing is inferred from a file name.</p>
                  <div className="flex flex-wrap gap-1">
                    {detail.mentionedFiles.map((file) => (
                      <button
                        key={file.path}
                        onClick={() => setViewerFile({ display: file.display, path: file.absolutePath, target: fileLinkTarget(card.workspaceKind === "exploratory", detail.fileEnvironmentId, file.relPath, file.hostId, file.absolutePath) })}
                        className="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-xs text-foreground hover:bg-muted"
                        title={`Review ${file.display}`}
                      >
                        <span>📄</span>
                        <span>{file.display}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </DisclosureSection>

            {/* Gaps live on the mother card: every escalation names its
                audit-gap scope status, and blocked done states name the fix.
                Renders nothing before the first execution critique. */}
            <BuildGapsSection cardId={card.id} />

            {/* The map is a reference, not card state: it sits beside the
                progress section (same heading shape, same stage names) so
                neither has to pretend to be the other. */}
            <WorkflowMap open={mapOpen} onToggle={setMapOpen} />

            <div ref={artifactsRef}>
            <DisclosureSection
              title="Artifacts"
              hint={detail ? `${artifactTotal} file${artifactTotal === 1 ? "" : "s"}${artifactEvidenceTotal > 0 ? ` + ${artifactEvidenceTotal} evidence` : ""} · audit trail${detail.artifacts.some((artifact) => artifact.stage === "unregistered") ? " · some unregistered" : ""}` : "produced files"}
              open={artifactsOpen}
              onToggle={setArtifactsOpen}
            >
              {card.status === "completed" ? <AuditTrailStatusRow cardId={card.id} /> : null}
              {detail ? (
                <>
                  <ArtifactGroups
                    artifacts={detail.artifacts.filter((artifact) => artifact.role !== "evidence")}
                    workspaceKind={card.workspaceKind}
                    fileEnvironmentId={detail.fileEnvironmentId}
                    onView={(file) => setViewerFile(file)}
                    groupTitleForStage={artifactGroupTitle}
                  />
                  {artifactEvidenceTotal > 0 ? (
                    <section aria-label="Evidence" className="space-y-2 border-t pt-3">
                      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Evidence — machine receipts ({artifactEvidenceTotal})</h3>
                      <p className="text-[11px] text-muted-foreground">Kept for audit with the run bundle, not counted as deliverables.</p>
                      <ArtifactGroups
                        artifacts={detail.artifacts.filter((artifact) => artifact.role === "evidence")}
                        workspaceKind={card.workspaceKind}
                        fileEnvironmentId={detail.fileEnvironmentId}
                        onView={(file) => setViewerFile(file)}
                        groupTitleForStage={artifactGroupTitle}
                      />
                    </section>
                  ) : null}
                </>
              ) : <p className="text-xs text-muted-foreground">Loading…</p>}
            </DisclosureSection>
            </div>

            {/* Diff is the pre-completion review instrument (uncommitted work at
                the gates). Once completed, Git changes owns history via the
                commit viewer — except when the tree went dirty again without
                reopening: then pending changes are reviewable here while the
                commit action lives in Git changes. Evaluate in Diff, act in
                Git changes. */}
            {card && ((card.status !== "completed" && (card.stage === "diff-gate" || card.stage === "audit")) || (card.status === "completed" && publication?.workingTree?.hasUncommittedChanges) || (card.status === "completed" && workspaceRecovery?.kind === "attached")) ? (
            <DisclosureSection
              title="Diff"
              hint={diffData ? (diffData.isRepo ? `${diffData.files.length} files` : "not a git repository") : "working tree vs HEAD"}
              open={diffOpen}
              onToggle={(next) => {
                setDiffOpen(next);
                if (next && !diffData) {
                  rpc.call("cardDiff", { cardId }).then((d) => { setDiffData(d); if (!d.found && d.error) setDiffError(d.error); }).catch((err) => setDiffError(err instanceof Error ? err.message : "Unable to load diff."));
                }
              }}
            >
              {!diffData && !diffError ? <p className="text-xs text-muted-foreground">Loading…</p> : null}
              {diffError ? <p className="text-xs text-destructive">{diffError}</p> : null}
              {diffData && !diffData.isRepo ? <p className="text-xs text-muted-foreground">This card's workspace is not a git repository — no diff to review.</p> : null}
              {diffData && diffData.isRepo && diffData.files.length === 0 ? <p className="text-xs text-muted-foreground">Working tree clean — nothing to review.</p> : null}
              {diffData && diffData.files.length > 0 ? (
                <div className="space-y-3">
                  {formatEntitySummary(diffData.entitySummary) ? (
                    <p className="text-[11px] text-muted-foreground">{formatEntitySummary(diffData.entitySummary)}</p>
                  ) : null}
                  {formatChangedSymbols(diffData.changedSymbols) ? (
                    <p className="text-[11px] text-muted-foreground" title="Changed symbols with caller impact (cymbal)">{formatChangedSymbols(diffData.changedSymbols)}</p>
                  ) : null}
                  {diffData.files.map((file) => (
                    <div key={file.path} className="space-y-1">
                      <p className="text-[11px] font-semibold text-muted-foreground">{file.display}{file.isNew ? " · new" : ""}</p>
                      {file.patch ? (
                        DiffView ? (
                          <DiffView patch={file.patch} path={file.path} view="unified" />
                        ) : (
                          <pre className="whitespace-pre-wrap rounded-md border bg-background/60 p-2 font-mono text-[11px] leading-relaxed">{file.patch.slice(0, 4000)}</pre>
                        )
                      ) : (
                        <button
                          onClick={() => setViewerFile({ display: file.display, path: file.absolutePath, target: fileLinkTarget(card.workspaceKind === "exploratory", detail?.fileEnvironmentId ?? null, file.path, file.hostId, file.absolutePath) })}
                          className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-xs text-foreground hover:bg-sky-500/20"
                          title={`Open ${file.display}`}
                        >
                          <span aria-hidden>📄</span><span>Open {file.display}</span>
                        </button>
                      )}
                    </div>
                  ))}
                  {diffData.truncated ? <p className="text-xs text-muted-foreground">Truncated — the full diff is larger than shown.</p> : null}
                </div>
              ) : null}
            </DisclosureSection>
            ) : null}

            {card.status === "completed" ? (
              <DisclosureSection
                title="Git changes"
                hint={publicationLoading ? "Checking BB workspace…" : publication?.source ?? "No live BB workspace"}
                defaultOpen
                action={<Button size="sm" variant="outline" disabled={publicationLoading} onClick={() => void loadPublication()} title="Re-check the workspace and pull-request state in BB">Refresh</Button>}
              >
                {!publication && !publicationLoading ? <p className="text-xs text-muted-foreground">Publication status is unavailable.</p> : null}
                {card.workspaceKind === "exploratory" ? (
                  <WorkspaceRecoveryPanel recovery={workspaceRecovery} loading={workspaceRecoveryLoading || creatingRecoveryAudit} onRefresh={() => void loadWorkspaceRecovery()} onPromote={() => { setPromoteName(card.displayName); setPromoteOpen(true); }} onAttach={setRecoveryAttachProjectId} onCreateAudit={() => void doCreateRecoveryAudit()} onOpenAudit={(auditCardId) => goToCard(navigate, { kind: "build" }, auditCardId)} />
                ) : null}
                {publication ? (
                  <div className="space-y-3 text-xs">
                    {publication.message ? <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-amber-900 dark:text-amber-200">{publication.message}</p> : null}
                    {publication.branch ? (
                      <div className="rounded-md bg-muted/60 p-2 text-muted-foreground">
                        <span className="font-medium text-foreground">{publication.isWorktree ? "Worker worktree" : "Worker checkout"}</span>
                        {publication.branch.current ? <> · branch <code>{publication.branch.current}</code></> : null}
                        {publication.branch.default ? <> · base <code>{publication.branch.default}</code></> : null}
                        {publication.workingTree ? <> · {publication.workingTree.hasUncommittedChanges ? `${publication.workingTree.files} changed files` : "working tree clean"}</> : null}
                        {publication.mergeBase ? <> · {publication.mergeBase.ahead} ahead / {publication.mergeBase.behind} behind</> : null}
                      </div>
                    ) : null}

                    {(() => {
                      const savedCommit = publication.events.find((event) => event.action === "commit" && event.commitSha);
                      const savedSha = savedCommit?.commitSha ?? null;
                      const isCurrentHead = Boolean(savedSha && publication.branch?.headSha === savedSha);
                      if (!savedSha || publication.workingTree?.hasUncommittedChanges) {
                        const files = publication.workingTree?.files ?? 0;
                        const completedAt = card?.status === "completed" ? detail?.card.verifiedHeadSha ?? null : null;
                        return (
                          <div>
                            <p className="text-emerald-900/80 dark:text-emerald-100/80">{!savedSha && !publication.workingTree?.hasUncommittedChanges ? "Nothing saved yet." : !savedSha ? `${files} uncommitted changes on ${publication.branch?.current ?? "this branch"} — save them first.` : `${files} new changes since ${savedSha.slice(0, 7)}.`}</p>
                            {completedAt ? <p className="mt-1 text-xs text-muted-foreground">Completed at {completedAt.slice(0, 7)} — current dirt may be later work, not card leftovers.</p> : null}
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Button size="sm" disabled={!publication.capabilities.commit.available} title={publication.capabilities.commit.reason ?? "Commit the BB workspace"} onClick={() => setPublicationAction("commit")}>{publishesToDefaultBranch ? `Save local commit to ${publicationDefaultBranch}…` : "Commit workspace…"}</Button>
                            </div>
                          </div>
                        );
                      }
                      const latestPush = pushTerminals?.terminals[0] ?? null;
                      const pushed = latestPush?.pushState === "succeeded" && !latestPush.outputUnavailable;
                      const pushUnknown = !pushed && (latestPush?.outputUnavailable ?? false);
                      const behind = publication.mergeBase?.behind ?? 0;
                      const branch = publication.branch?.current ?? "this branch";
                      // Links need a branch that exists remotely: a finished
                      // push proves it, an existing PR implies it. A failed
                      // first push of a new branch would 404 either link.
                      const remoteKnown = pushTerminals?.remote ?? null;
                      const links = pushed || publication.pullRequest ? branchWebLinks(remoteKnown, publication.branch?.current ?? null, publication.mergeBase?.branch ?? publication.branch?.default ?? null) : null;
                      return (
                        <div className="space-y-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 text-emerald-950 dark:text-emerald-100">
                          <div>
                            <p className="font-medium">✓ Saved locally on <code>{branch}</code></p>
                            <p className="mt-1 text-emerald-900/80 dark:text-emerald-100/80"><code>{savedSha.slice(0, 7)}</code> · working tree clean{isCurrentHead ? " · current local HEAD" : " · followed by a newer local commit"} · {pushed ? "pushed to origin." : pushUnknown ? "last push outcome unknown — the shell ended." : "not pushed yet."}</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Button size="sm" variant="outline" onClick={() => void openPublicationCommit(savedSha)}>View commit</Button>
                              <Button size="sm" variant="outline" onClick={() => void copyCommitSha(savedSha)}>Copy SHA</Button>
                            </div>
                          </div>
                          <div className="border-t border-emerald-500/20 pt-3">
                            <p className="font-medium">{pushed ? "✓ Published" : behind > 0 ? `Behind by ${behind} — sync first.` : "Next: publish the branch."}</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {behind > 0 ? (
                                <Button size="sm" variant="outline" title="Pull with rebase, then push — one click" onClick={() => setPublicationAction("sync")}>Sync &amp; push…</Button>
                              ) : pushed ? null : (
                                <Button size="sm" variant="outline" title="Run git push in this card's checkout" onClick={() => setPublicationAction("push")}>Push now…</Button>
                              )}
                              <Button size="sm" variant="ghost" title="Copy the push command to run it yourself" onClick={() => void copyText("git push", "Push command")}>Copy command</Button>
                            </div>
                          <div className="mt-2 rounded-md border border-emerald-500/20 p-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-900/70 dark:text-emerald-100/70">Push shells</p>
                              <Button size="sm" variant="outline" disabled={pushTerminalsLoading} onClick={() => void loadPushTerminals()}>{pushTerminalsLoading ? "Checking…" : "Check result"}</Button>
                            </div>
                            {pushTerminalsLoading ? <p className="mt-1 text-emerald-900/80 dark:text-emerald-100/80">Checking push shells…</p> : null}
                            {!pushTerminalsLoading && pushTerminals && !pushTerminals.ok ? <p className="mt-1 text-emerald-900/80 dark:text-emerald-100/80">{pushTerminals.error ?? "Unable to list push shells."}</p> : null}
                            {!pushTerminalsLoading && pushTerminals?.ok && pushTerminals.terminals.length === 0 ? <p className="mt-1 text-emerald-900/80 dark:text-emerald-100/80">No push shell opened yet.</p> : null}
                            {!pushTerminalsLoading && pushTerminals?.ok ? pushTerminals.terminals.map((terminal) => (
                              <div key={terminal.id} className="mt-2 rounded border border-emerald-500/20 bg-background/60 p-2 text-foreground">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-xs"><span className="font-medium">{terminal.title}</span> · {terminal.outputUnavailable ? "○ Ended — output unavailable" : terminal.pushState === "succeeded" ? "✓ Pushed" : terminal.pushState === "failed" ? `✗ Push failed${terminal.pushExit !== null ? ` (exit ${terminal.pushExit})` : ""}` : terminal.pushState === "waiting" ? "○ Waiting — git push typed but NOT sent" : "… Running"} · {new Date(terminal.createdAt).toLocaleString()}</p>
                                  <Button size="sm" variant="ghost" title="Copy this shell's ID — paste it in BB's sidebar terminal panel to jump to the exact shell that ran this" onClick={() => void copyText(terminal.id, "Terminal ID")}>Copy terminal ID</Button>
                                </div>
                                <p className="mt-1 font-mono text-[11px] text-muted-foreground">{terminal.id}</p>
                                {terminal.pushState === "waiting" && !terminal.outputUnavailable ? <p className="mt-1 text-xs text-muted-foreground">An older shell from before pushes ran themselves. Press Enter in BB’s sidebar terminal {terminal.id} to send it, or click Push now above for a fresh tracked run.</p> : null}
                                {terminal.pushState === "running" && !terminal.outputUnavailable ? <p className="mt-1 text-xs text-muted-foreground">Push sent — waiting for the remote. If it asks for auth, finish it in BB’s sidebar terminal {terminal.id}, then Check result.</p> : null}
                                {terminal.pushState === "failed" && !terminal.outputUnavailable ? (() => {
                                  const tail = terminal.outputTail ?? "";
                                  if (/STELOW_SYNC_ABORTED:1/.test(tail)) return <p className="mt-1 text-xs text-muted-foreground">Pull conflicted — the rebase aborted itself, so your checkout is unchanged. Resolve the conflict where you edit code, then come back and Push now.</p>;
                                  if (/STELOW_SYNC_EXIT:([1-9][0-9]*)/.test(tail)) return <p className="mt-1 text-xs text-muted-foreground">Pull itself failed (network or auth?) — details above. <Button size="sm" variant="outline" onClick={() => setPublicationAction("sync")}>Sync &amp; push again…</Button></p>;
                                  return <p className="mt-1 text-xs text-muted-foreground">The remote rejected the push (usually: your branch is behind). <Button size="sm" variant="outline" onClick={() => setPublicationAction("sync")}>Sync &amp; push again…</Button> pulls with rebase, then pushes — one click, no sidebar needed.</p>;
                                })() : null}
                                {terminal.outputTail ? <><p className="mt-1 text-[11px] text-muted-foreground">Snapshot — refresh with Check result; this view is not interactive.</p><pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-muted/60 p-2 font-mono text-[11px]">{terminal.outputTail}</pre></> : null}
                                {terminal.outputUnavailable ? <p className="mt-1 text-xs text-muted-foreground">Output unavailable — the shell already exited. Its result is in the Git history / remote instead.</p> : null}
                              </div>
                            )) : null}
                          </div>
                          {links ? (
                            <div className="border-t border-emerald-500/20 pt-3">
                              <p className="font-medium">On GitHub</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <Button size="sm" variant="outline" asChild><a href={links.treeUrl} target="_blank" rel="noreferrer" title={`Open ${branch} on GitHub`}>View branch ↗</a></Button>
                                {links.compareUrl ? <Button size="sm" variant="outline" asChild><a href={links.compareUrl} target="_blank" rel="noreferrer" title="Open a pull request for this branch on GitHub">Open pull request ↗</a></Button> : null}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                      );
                    })()}
                    {publishesToDefaultBranch ? (
                      <p className="text-muted-foreground">This is the default checkout selected in BB. BB creates a local commit on <code>{publicationDefaultBranch}</code> only: it cannot fetch remote updates, merge incoming changes, push, or create a pull request from this panel. Before saving, confirm that this checkout is current and exclusively yours. Choose a feature branch or managed worktree in BB’s composer for a pull-request workflow.</p>
                    ) : (
                      <p className="text-muted-foreground">BB owns commit execution on the workspace host. Stelow never stages or runs Git commands locally.</p>
                    )}

                    {!publishesToDefaultBranch ? (
                      <details className="group border-t pt-3" open={advancedGitOpen} onToggle={(event) => setAdvancedGitOpen((event.currentTarget as HTMLDetailsElement).open)}>
                        <summary className="flex cursor-pointer items-center gap-1.5 font-medium text-foreground"><DisclosureChevron open={advancedGitOpen} />Advanced Git operations</summary>
                        <div className="mt-2 space-y-2 text-muted-foreground">
                          <p>Squash branch locally combines this branch’s already committed changes into one commit on its local base branch. It does not fetch remote updates, push, or create a pull request. Use it only when you own local integration.</p>
                          <Button size="sm" variant="outline" disabled={!publication.capabilities.squashMerge.available} title={publication.capabilities.squashMerge.reason ?? "Squash committed branch changes into the local base branch"} onClick={() => setPublicationAction("squash")}>Squash branch locally…</Button>
                        </div>
                      </details>
                    ) : null}

                    {publication.pullRequest ? (
                      <div className="space-y-2 border-t pt-3">
                        <p className="text-muted-foreground">Pull request <UrlLink href={publication.pullRequest.url} className="font-medium text-primary underline-offset-4 hover:underline">#{publication.pullRequest.number} · {publication.pullRequest.title}</UrlLink> · {publication.pullRequest.attention.replaceAll("_", " ")}</p>
                        <p className="text-muted-foreground">Review: {publication.pullRequest.review.replaceAll("_", " ")} · checks: {publication.pullRequest.checks.replaceAll("_", " ")} · mergeability: {publication.pullRequest.mergeability}</p>
                        <div className="flex flex-wrap gap-2">
                          {publication.pullRequest.state === "draft" ? (
                            <Button size="sm" variant="outline" disabled={!publication.capabilities.markReady.available} title={publication.capabilities.markReady.reason ?? "Mark this pull request ready for review"} onClick={() => setPublicationAction("ready")}>Mark ready…</Button>
                          ) : (
                            <Button size="sm" variant="outline" disabled={!publication.capabilities.markDraft.available} title={publication.capabilities.markDraft.reason ?? "Convert this pull request to draft"} onClick={() => setPublicationAction("draft")}>Mark draft…</Button>
                          )}
                          <select value={mergeMethod} onChange={(event) => setMergeMethod(event.target.value as "merge" | "rebase" | "squash")} className="min-h-9 cursor-pointer rounded-md border bg-background px-2 text-xs" aria-label="Merge method">
                            <option value="squash">Squash merge</option>
                            <option value="merge">Merge commit</option>
                            <option value="rebase">Rebase merge</option>
                          </select>
                          <Button size="sm" disabled={!publication.capabilities.mergePullRequest.available} title={publication.capabilities.mergePullRequest.reason ?? "Merge this pull request through BB"} onClick={() => setPublicationAction("merge")}>Merge PR…</Button>
                        </div>
                      </div>
                    ) : (
                      <p className="border-t pt-3 text-muted-foreground">{publication.pullRequestMessage ?? "No pull request is linked to this branch. BB can manage an existing pull request; create and push it through your Git provider or BB's native PR flow."}</p>
                    )}

                    {publication.events.length > 0 ? (
                      <div className="border-t pt-3">
                        <p className="mb-1 font-medium text-foreground">Publication history</p>
                        <ul className="space-y-1 text-muted-foreground">
                          {publication.events.map((event) => <li key={event.id}>{event.action.replaceAll("_", " ")} · {event.commitSha ? event.message.replace(event.commitSha, event.commitSha.slice(0, 7)) : event.message}{event.commitSha ? <> · <button type="button" className="cursor-pointer text-primary underline-offset-2 hover:underline" onClick={() => void openPublicationCommit(event.commitSha!)} title={`View ${event.commitSha.slice(0, 7)} in BB`}>View commit</button></> : null}{event.pullRequestUrl ? <> · <UrlLink href={event.pullRequestUrl} className="text-primary underline-offset-2 hover:underline">Open PR</UrlLink></> : null}</li>)}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </DisclosureSection>
            ) : null}

            {/* Conversation (history + composer) */}
            <CardConversation comments={detail?.comments ?? []} draft={comment} onDraftChange={setComment} onSend={() => void submitComment()} defaultOpen={hero?.kind === "decision"} threadId={card?.workerThreadId ?? null} />

          </>
        ) : null}
        </div>
      </div>
      <ConfirmActionDialog
        open={repairOpen}
        onOpenChange={setRepairOpen}
        title="Restart with a fresh worker?"
        description="Reseed state.md and stelow.json so a new worker restarts from the triage stage. Existing scope work and comments are kept. Try Retry first — restart only if the worker itself is broken."
        confirmLabel="Restart fresh"
        confirmTone="default"
        onConfirm={() => void doRepair()}
      />
      <ConfirmActionDialog
        open={restartWorkerOpen}
        onOpenChange={setRestartWorkerOpen}
        title="Restart the worker on the current preset?"
        description="Stops the running worker and starts a fresh one on this card's preset, continuing from the current stage (not from triage). Use this to apply a preset change."
        confirmLabel="Restart worker"
        confirmTone="default"
        onConfirm={doRestartWorker}
      />
      <PresetAssignDialog
        open={presetDialogOpen}
        onOpenChange={setPresetDialogOpen}
        cardId={cardId}
        onChanged={() => void load()}
      />
      <ArtifactViewerDialog
        open={viewerFile !== null}
        onOpenChange={(next) => { if (!next) setViewerFile(null); }}
        cardId={cardId}
        file={viewerFile}
        editorTarget={viewerFile?.target ?? null}
        mode={viewerFile?.mode}
        onCommented={() => void load()}
      />
      {/* Advance preview: never jump stages blindly — show where you are, where
          you'd go, and what the target stage produces before confirming. */}
      <Dialog open={pendingAdvance !== null} onOpenChange={(next) => { if (!next) setPendingAdvance(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pendingAdvance && card && stageIndex(pendingAdvance) > stageIndex(card.stage) ? "Advance to" : "Return to"} {pendingAdvance ? stageLabel(pendingAdvance) : ""}?</DialogTitle>
            <DialogDescription className="space-y-2">
              <p>
                Move this card from <strong>{stageLabel(card?.stage ?? "")}</strong> to <strong>{pendingAdvance ? stageLabel(pendingAdvance) : ""}</strong>.
              </p>
              <p className="rounded-md bg-muted p-2 text-xs">
                {pendingAdvance ? STAGE_PRODUCES[pendingAdvance] ?? "The agent works on this stage and advances on its own once done." : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                {pendingAdvance && card && stageIndex(pendingAdvance) > stageIndex(card.stage)
                  ? "This is a manual override. The agent usually advances on its own. Stage gates (product, interface, plan, diff) still apply on the next advance."
                  : "Going back is safe and reversible. The workflow will re-run earlier stages as needed."}
              </p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={advancing !== null}>Cancel</Button>
            </DialogClose>
            <Button disabled={advancing !== null || !pendingAdvance} onClick={() => { const target = pendingAdvance; setPendingAdvance(null); if (target) void advance(target); }}>{advancing ? "Applying…" : pendingAdvance && card && stageIndex(pendingAdvance) > stageIndex(card.stage) ? "Advance" : "Return"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmActionDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Archive this card?"
        description="Moves this card to Archived. If its worker is active, Stelow stops it. Comments and history are preserved."
        confirmLabel="Archive card"
        confirmTone="destructive"
        onConfirm={doArchive}
      />
      <ConfirmActionDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this card permanently?"
        description="Removes the card, its comments, history, and its Stelow run files (.stelow artifacts) — cannot be recovered. Code changes in Git checkouts are kept: committed and uncommitted work survives the delete."
        confirmLabel="Delete"
        confirmTone="destructive"
        onConfirm={doDelete}
      />
      <ConfirmActionDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={discardConfirm?.title ?? "Discard this card’s work?"}
        description={discardConfirm?.body ?? ""}
        confirmLabel="Discard work"
        confirmTone="destructive"
        onConfirm={doDiscard}
      />
      <ConfirmActionDialog
        open={recoveryAttachProjectId !== null}
        onOpenChange={(open) => { if (!open) setRecoveryAttachProjectId(null); }}
        title="Attach this reported checkout to the audit trail?"
        description="Stelow will record the reviewed project path, current branch, HEAD, changed-file count, and the worker report. It will not move files, alter the Git index, commit, push, or claim that acceptance tests have passed."
        confirmLabel="Attach reviewed checkout"
        confirmTone="default"
        onConfirm={doAttachRecoveryCheckout}
      />
      <Dialog open={publicationAction !== null} onOpenChange={(open) => { if (!open && !publicationSubmitting) setPublicationAction(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{publicationAction === "commit" ? publishesToDefaultBranch ? `Save a local commit to ${publicationDefaultBranch}?` : "Commit this workspace?" : publicationAction === "squash" ? "Squash this branch into its local base?" : publicationAction === "push" ? "Push this branch now?" : publicationAction === "sync" ? "Sync & push now?" : publicationAction === "ready" ? "Mark this pull request ready?" : publicationAction === "draft" ? "Convert this pull request to draft?" : "Merge this pull request?"}</DialogTitle>
            <DialogDescription className="space-y-2">
              {publicationAction === "commit" && publishesToDefaultBranch ? <p>BB will create a local commit on <code>{publicationDefaultBranch}</code> in the card’s selected checkout. It will not fetch remote updates, merge incoming changes, push, or create a pull request. This bypasses a pull request, so continue only when the checkout is current and direct commits are intended.</p> : null}
              {publicationAction === "commit" && !publishesToDefaultBranch ? <p>BB will commit the current changes on the card’s workspace host. This is manual and will use BB’s configured Git identity and hooks.</p> : null}
              {publicationAction === "squash" ? <p>BB will combine this branch’s committed changes into one local commit on its base branch. It will not fetch remote updates, push, or create a pull request. It bypasses pull-request review, so use it only when direct local integration is intended.</p> : null}
              {publicationAction === "push" ? <p>This panel will run <code>git push</code> in this card’s worker checkout and stream the output into Push shells below — nothing hides in a sidebar you have to hunt. Rejections and auth prompts appear there; an auth prompt is finished in BB’s sidebar terminal.</p> : null}
              {publicationAction === "sync" ? <p>This panel will run <code>git pull --rebase</code> followed by <code>git push</code> in this card’s worker checkout — one click, linear history, no merge commits. If the pull conflicts, the rebase aborts itself and nothing changes; resolve the conflict where you edit code and push again. The output streams into Push shells below.</p> : null}
              {publicationAction === "push" && (publication?.mergeBase?.behind ?? 0) > 0 ? <p>This branch is {publication?.mergeBase?.behind} behind — a push will be rejected. Cancel and use Sync &amp; push instead: it pulls with rebase, then pushes.</p> : null}
              {publicationAction === "ready" ? <p>This makes the existing pull request ready for review. It does not merge or deploy anything.</p> : null}
              {publicationAction === "draft" ? <p>This returns the existing pull request to draft. Reviews and checks remain visible.</p> : null}
              {publicationAction === "merge" ? <p>BB will re-check the PR and request a {mergeMethod} merge. Repository rules, approvals, checks, and merge queues remain authoritative.</p> : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" disabled={publicationSubmitting}>Cancel</Button></DialogClose>
            <Button disabled={publicationSubmitting} onClick={() => void doPublicationAction()}>{publicationSubmitting ? "Submitting…" : publicationAction === "commit" ? publishesToDefaultBranch ? `Save local commit to ${publicationDefaultBranch}` : "Commit workspace" : publicationAction === "squash" ? "Squash branch locally" : publicationAction === "push" ? "Push branch" : publicationAction === "sync" ? "Sync & push" : publicationAction === "ready" ? "Mark ready" : publicationAction === "draft" ? "Mark draft" : "Merge PR"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={publicationCommitSha !== null} onOpenChange={(open) => { if (!open) { setPublicationCommitSha(null); setPublicationCommitDiff(null); } }}>
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Commit {publicationCommitSha?.slice(0, 7)}</DialogTitle>
            <DialogDescription>This is the diff BB recorded for this card’s local commit. Viewing it never changes the workspace or remote repository.</DialogDescription>
          </DialogHeader>
          {publicationCommitDiffLoading ? <p className="text-xs text-muted-foreground">Loading commit diff from BB…</p> : null}
          {publicationCommitDiff?.error ? <p className="text-xs text-destructive">{publicationCommitDiff.error}</p> : null}
          {publicationCommitDiff?.found ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">{publicationCommitDiff.shortstat || `${publicationCommitDiff.files.length} changed files`}</p>
                {publicationCommitDiff.files.length > 1 ? (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => { setCommitFilesExpanded(true); setCommitFilesEpoch((epoch) => epoch + 1); }}>Expand all</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setCommitFilesExpanded(false); setCommitFilesEpoch((epoch) => epoch + 1); }}>Collapse all</Button>
                  </div>
                ) : null}
              </div>
              {publicationCommitDiff.files.map((file) => (
                <details key={`${publicationCommitSha}-${commitFilesEpoch}-${file.path}`} open={commitFilesExpanded} className="group rounded-md border">
                  <summary className="flex cursor-pointer items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                    <DisclosureChevron />
                    {file.path} · {file.changeKind} · +{file.additions}/-{file.deletions}{file.binary ? " · binary" : file.patch ? "" : file.loadMode === "too_large" ? " · too large" : " · no patch"}
                  </summary>
                  <div className="space-y-1 border-t p-2">
                    {file.binary ? <p className="text-xs text-muted-foreground">Binary file — BB does not render its patch.</p> : file.patch ? DiffView ? <DiffView patch={file.patch} path={file.path} view="unified" /> : <pre className="whitespace-pre-wrap rounded-md border bg-background/60 p-2 font-mono text-[11px] leading-relaxed">{file.patch.slice(0, 4000)}</pre> : file.loadMode === "too_large" ? <p className="text-xs text-muted-foreground">This file is too large for BB to render its patch.</p> : <p className="text-xs text-muted-foreground">BB did not return a patch for this file.</p>}
                    {file.truncated ? <p className="text-xs text-muted-foreground">This file’s patch is truncated.</p> : null}
                  </div>
                </details>
              ))}
              {publicationCommitDiff.truncated ? <p className="text-xs text-muted-foreground">The commit diff is truncated — some files may be missing.</p> : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <GithubCompletionDialog open={githubPostOpen} onOpenChange={setGithubPostOpen} cardId={cardId} issueLabel={detail?.githubLink ? `${detail.githubLink.repo}#${detail.githubLink.number}` : null} onPosted={load} />
      <Dialog open={promoteOpen} onOpenChange={setPromoteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Turn into project?</DialogTitle>
            <DialogDescription className="space-y-2">
              <p>
                Files stay in place. To keep one writer for this workflow, Stelow archives the exploratory worker and starts a new worker in the project from the current stage. Open thread then opens that project worker; the earlier thread stays in Worker history.
              </p>
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Project name</span>
            <Input value={promoteName} onChange={(event) => setPromoteName(event.target.value)} placeholder={card?.displayName ?? "Project name"} aria-label="Project name" maxLength={120} />
          </label>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={promoting}>Cancel</Button>
            </DialogClose>
            <Button disabled={promoting || !promoteName.trim()} onClick={() => void doPromote()}>{promoting ? "Creating…" : "Turn into project"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PillsyStyles() {
  if (typeof document === "undefined") return null;
  if (document.getElementById("stelow-style")) return null;
  const style = document.createElement("style");
  style.id = "stelow-style";
  style.textContent = [
    "@keyframes stelow-card-alive { 0%, 100% { border-color: hsl(220 90% 60% / 0.45); box-shadow: 0 0 0 0 hsl(220 90% 60% / 0); } 50% { border-color: hsl(220 90% 60% / 0.75); box-shadow: 0 0 0 2px hsl(220 90% 60% / 0.12); } }",
    "@keyframes stelow-card-attention { 0%, 100% { border-color: hsl(38 92% 50% / 0.50); box-shadow: 0 0 0 0 hsl(38 92% 50% / 0); } 50% { border-color: hsl(38 92% 50% / 0.88); box-shadow: 0 0 0 3px hsl(38 92% 50% / 0.16); } }",
    ".stelow-live-surface.stelow-border-running, details.stelow-border-running { border-color: hsl(220 90% 60% / 0.5) !important; animation: stelow-card-alive 3.2s ease-in-out infinite; }",
    ".stelow-live-surface.stelow-border-attention { border-color: hsl(38 92% 50% / 0.75) !important; animation: stelow-card-attention 2.4s ease-in-out infinite; }",
    ".stelow-detail-surface.stelow-border-running, .stelow-detail-surface.stelow-border-attention { box-shadow: inset 0 0 0 1px currentColor; }",
    "@media (prefers-reduced-motion: reduce) { .stelow-live-surface.stelow-border-running, .stelow-live-surface.stelow-border-attention, details.stelow-border-running { animation: none; } .stelow-live-surface.stelow-border-running { border-color: hsl(220 90% 60% / 0.7) !important; } .stelow-live-surface.stelow-border-attention { border-color: hsl(38 92% 50% / 0.85) !important; } }",
    ".stelow-pill-working { background: hsl(220 90% 60% / 0.12); animation: stelow-breathe 1.8s ease-in-out infinite; color: hsl(220 90% 40%); }",
    "@keyframes stelow-breathe { 0% { opacity: 0.55; } 50% { opacity: 1; } 100% { opacity: 0.55; } }",
    "@keyframes stelow-hill-draw { to { stroke-dashoffset: 0; } }",
    "@keyframes stelow-hill-in { from { opacity: 0; scale: 0.4; } to { opacity: 1; scale: 1; } }",
    "@keyframes stelow-hill-attn-pulse { 0%, 100% { box-shadow: 0 0 0 0 hsl(38 92% 50% / 0); } 50% { box-shadow: 0 0 0 5px hsl(38 92% 50% / 0.18); } }",
    "@keyframes stelow-hill-panel-in { from { opacity: 0; translate: 0 4px; } to { opacity: 1; translate: 0 0; } }",
    ".stelow-hill-draw { stroke-dasharray: 100; stroke-dashoffset: 100; animation: stelow-hill-draw 1.1s ease-out forwards; }",
    ".stelow-hill-dot { animation: stelow-hill-in 0.45s ease backwards; transition: scale 0.16s ease; }",
    ".stelow-hill-dot:hover { scale: 1.6; }",
    ".stelow-hill-attn { animation: stelow-hill-in 0.45s ease backwards, stelow-hill-attn-pulse 2.4s ease-in-out 0.6s infinite; }",
    ".stelow-hill-panel { animation: stelow-hill-panel-in 0.18s ease-out; }",
    "@media (prefers-reduced-motion: reduce) { .stelow-hill-draw, .stelow-hill-dot, .stelow-hill-attn, .stelow-hill-panel { animation: none; } .stelow-hill-draw { stroke-dashoffset: 0; } }",
    ".stelow-activity-pill { display: inline-flex; align-items: center; gap: 0.25rem; border-radius: 9999px; padding: 0.125rem 0.5rem; font-size: 11px; line-height: 18px; font-weight: 500; border-width: 1px; border-style: dashed; }",
    ".stelow-activity-onhold { border-color: hsl(240 5% 55% / 0.55); color: hsl(240 3% 45%); background: transparent; }",
    ".stelow-activity-waiting { border-color: hsl(38 92% 45% / 0.7); color: hsl(38 80% 28%); background: hsl(38 92% 45% / 0.10); animation: stelow-breathe 1.8s ease-in-out infinite; }",
    ".stelow-activity-error { border-color: hsl(0 84% 55% / 0.7); color: hsl(0 70% 40%); background: hsl(0 84% 55% / 0.08); }",
    ".stelow-activity-working { border-color: hsl(220 90% 60% / 0.6); color: hsl(220 60% 40%); background: hsl(220 90% 60% / 0.08); animation: stelow-breathe 1.8s ease-in-out infinite; }",
    ".dark .stelow-activity-onhold { border-color: hsl(240 5% 60% / 0.5); color: hsl(240 10% 70%); }",
    ".dark .stelow-activity-waiting { border-color: hsl(38 92% 55% / 0.65); color: hsl(40 80% 75%); }",
    ".dark .stelow-activity-error { border-color: hsl(0 84% 60% / 0.65); color: hsl(0 80% 80%); }",
    ".dark .stelow-activity-working { border-color: hsl(220 90% 65% / 0.6); color: hsl(220 70% 80%); }",
    // The open card's current stage breathes with the same effect as the
    // board card's working chip (stelow-breathe) — one pulse language for
    // "this is where work is happening", reused, never reinvented.
    ".stelow-stage-pulse { animation: stelow-breathe 1.8s ease-in-out infinite; }",
    "@media (prefers-reduced-motion: reduce) { .stelow-stage-pulse { animation: none; } }",
  ].join("\n");
  document.head.appendChild(style);
  return null;
}

function QuestionForm({ interaction, submit, cancel }: PluginPendingInteractionProps) {
  const payload = interaction.payload as { question?: string; multiple?: boolean; kind?: "standard" | "split"; options?: Array<{ label: string; description: string; preview: string | null; artifact: AskArtifact | null }>; questions?: Array<{ question?: string; multiple?: boolean; kind?: "standard" | "split"; options?: Array<{ label: string; description: string; preview: string | null; artifact: AskArtifact | null }> }> };
  // Thread payloads carry raw artifact paths (no viewer here to resolve
  // against); normalize to the shared shape so display never renders
  // undefined. Open affordances stay card-only by design.
  const toArtifact = (raw: unknown): AskArtifact | null => {
    const path = typeof raw === "string" ? raw : (raw as { path?: unknown } | null)?.path;
    const normalized = normalizeAskArtifactPath(path);
    return normalized ? { ...normalized, absolutePath: null, hostId: null } : null;
  };
  const clean = (options: unknown): BatchItem["options"] => {
    const list = Array.isArray(options)
      ? options.filter((o): o is { label: string; description: string; preview: string | null; artifact: AskArtifact | null } => !!o && typeof o === "object" && typeof (o as { label?: unknown }).label === "string").map((o) => ({ label: o.label, description: typeof o.description === "string" ? o.description : "", preview: typeof o.preview === "string" ? o.preview : null, artifact: toArtifact((o as { artifact?: unknown }).artifact) }))
      : [];
    // Same per-option policy as the card (lib/question-batch): an approval
    // here must name the document its siblings carry, never render blind.
    const inherited = inheritAskArtifact(list);
    return list.map((option, index) => ({
      ...option,
      artifact: option.artifact ?? (inherited[index] ? { ...inherited[index], absolutePath: null, hostId: null } : null),
    }));
  };
  // Batch payloads (one `bb stelow ask` call with repeated --question groups)
  // answer together; single-question payloads keep their exact shape.
  const genericTitle = /^stelow questions?(?: \(\d+\))?$/i.test(interaction.title ?? "") ? "" : interaction.title;
  const items: BatchItem[] = Array.isArray(payload.questions) && payload.questions.length > 0
    ? payload.questions.map((q, i) => ({ id: `q${i}`, title: genericTitle, prompt: typeof q?.question === "string" ? q.question : "", multiple: q?.multiple === true, kind: q?.kind, options: clean(q?.options) })).filter((q) => q.options.length > 0)
    : [{ id: "q0", title: genericTitle, prompt: payload.question ?? interaction.title, multiple: payload.multiple === true, kind: payload.kind, options: clean(payload.options) }];
  if (items.length === 0) return null;
  const batched = items.length > 1;
  const copy = questionCopy();
  return (
    <div className="space-y-3">
      <BatchStepper
        questions={items}
        allowSkip
        busy={false}
        error={null}
        submitLabel={batched ? copy.continueWithAnswers(items.length) : copy.continue}
        onSubmit={(all) => void submit(batched ? { answers: all } : { answers: all[0] ?? [] })}
      />
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => void cancel()}>Cancel</Button></div>
    </div>
  );
}

function OpenStelowAction({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [target, setTarget] = useState<{ cardId: string; kind: "build" | "research" | "explore" } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setTarget(null);
    void rpc.call("cardByWorkerThread", { threadId }).then((result) => {
      if (!cancelled && result.cardId) setTarget({ cardId: result.cardId, kind: result.kind ?? "build" });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [rpc, threadId]);
  // Not a card worker thread: render nothing instead of a generic shortcut.
  if (!target) return null;
  // Host header chrome: the same small outline button as every in-panel
  // "Open thread" affordance (h-8), never a taller custom button — the slot
  // stretches its children, so a touch-target height here filled the bar.
  return <Button size="sm" variant="outline" className="shrink-0 self-center" onClick={() => goToCard(navigate, { kind: target.kind }, target.cardId)} title="Open this card">Stelow card ↗</Button>;
}

function StelowQualityDirective({ attributes, message, openWorkspaceFile }: PluginMessageDirectiveProps) {
  const rpc = useRpc<typeof rpcContract>();
  const path = (attributes.path ?? "").replace(/^\.\//, "");
  const threadId = message.threadId;
  const [seal, setSeal] = useState<{ status: string; failures: string[]; label: string | null } | null>(null);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    void rpc.call("qualitySeal", { threadId, path }).then((result) => { if (!cancelled) setSeal(result); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [rpc, threadId, path]);
  if (!path) return null;
  // Provenance, not truth: the RPC revalidates live; unknown shapes and
  // unreadable files render unverified — a first-class state, not an error.
  const tone = seal?.status === "verified"
    ? "border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20"
    : seal?.status === "hypothesis-only"
      ? "border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20"
      : seal?.status === "needs-revision"
        ? "border-orange-500/40 bg-orange-500/10 hover:bg-orange-500/20"
        : "border-zinc-500/40 bg-zinc-500/10 hover:bg-zinc-500/20";
  const icon = seal?.status === "verified" ? "✓" : seal?.status === "hypothesis-only" ? "◐" : seal?.status === "needs-revision" ? "!" : "?";
  const text = !seal ? "quality…" : seal.status === "verified" ? "verified" : seal.status === "hypothesis-only" ? "hypothesis" : seal.status === "needs-revision" ? "needs work" : "unverified";
  const title = seal?.failures?.length ? `${seal.label ?? path}: ${seal.failures.join("; ")}` : (seal?.label ?? path);
  const openFile = () => { openWorkspaceFile?.(path); };
  return (
    <button
      onClick={openFile}
      disabled={!openWorkspaceFile}
      className={`cursor-pointer inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-60 ${tone}`}
      title={title}
    >
      <span>{icon}</span>
      <span className="text-muted-foreground">quality</span>
      <span className="font-medium">{text}</span>
    </button>
  );
}

function StelowArtifactDirective({ attributes, source, openWorkspaceFile }: PluginMessageDirectiveProps) {
  const rawPath = attributes.path ?? "";
  const display = attributes.display || rawPath.split("/").pop() || "artifact";
  const path = rawPath.replace(/^\.\//, "");
  if (!path) return <span className="text-sm text-destructive">{source}</span>;
  const openFile = () => { openWorkspaceFile?.(path); };
  return (
    <button
      onClick={openFile}
      disabled={!openWorkspaceFile}
      className="cursor-pointer inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs text-foreground hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
      title={path}
    >
      <span>📎</span>
      <span className="text-muted-foreground">artefato</span>
      <span className="font-medium">{display}</span>
    </button>
  );
}

export default definePluginApp((app) => {
  // One sidebar row for the whole plugin. All tracks live on as subPath
  // routes (see STELOW_TRACKS).
  // The badge counts what matters: unresolved inbox action items.
  // Sidebar icon truth: the host renders package.json#bb.branding.icon,
  // which WINS over this panel icon (plugin?.icon ?? panel icon in ZO).
  // Both names must be in BB's allowlist (An base map + Cn extended chunk:
  // jn = [...Object.keys(An), ...Cn]); anything else falls back to Zap.
  // Star (extended chunk) is the stellar mark. (Tab icons are unaffected —
  // they render from the plugin's own HugeIcons set.)
  app.slots.navPanel({
    id: STELOW_PANEL_ID,
    title: "Stelow • Product Hub",
    icon: "Star",
    path: STELOW_PANEL_PATH,
    component: (props) => { PillsyStyles(); return <StelowPanel subPath={props.subPath} />; },
    experimental_sidebarAccessory: StelowInboxSidebarAccessory,
  });
  app.slots.pendingInteraction({ id: "stelow-question", component: QuestionForm });
  app.slots.threadPanelAction({ id: "stelow-card-detail", title: "Stelow card", icon: "Columns2", component: CardDrawerAdapter });
  app.slots.experimental_threadHeaderAction({ id: "open-stelow", title: "Open Stelow", component: OpenStelowAction });

  // Quick-palette command (BB 0.43 `app.commands.register`): from any worker
  // thread, open its Stelow card. The palette context carries no card id, so
  // the drawer resolves threadId itself. Hosts predating `app.commands`
  // keep the deprecated `commandPaletteAction` alias with the same shape.
  const openCardCommand: PluginCommandRegistration = {
    id: "open-card-for-thread",
    title: "Stelow: open card for this thread",
    isAvailable: (context) => context.threadId !== null,
    run: (context) => {
      if (context.threadId) context.openPanel({ actionId: "stelow-card-detail", params: { threadId: context.threadId } });
    },
  };
  const appCommands = (app as unknown as { commands?: { register: (registration: PluginCommandRegistration) => void } }).commands;
  if (appCommands?.register) appCommands.register(openCardCommand);
  else app.slots.commandPaletteAction(openCardCommand);

  app.slots.messageDirective({
    id: "stelow-artifact",
    component: StelowArtifactDirective,
  });

  app.slots.messageDirective({
    id: "stelow-quality",
    component: StelowQualityDirective,
  });
});

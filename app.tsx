import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  definePluginApp,
  UrlLink,
  experimental_PermissionModePicker as PermissionModePicker,
  experimental_ProviderModelPicker as ProviderModelPicker,
  useBbContext,
  useBbNavigate,
  useComposer,
  useRpc,
  type NewThreadRequest,
  type PluginCommandRegistration,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { countsForInboxBadge } from "./lib/inbox-events.mjs";
import { DECISION_PROVIDERS } from "./lib/decision-api.mjs";
import { INBOX_EVENT_LABELS, inboxEventPresentation, inboxEventText, inboxEventTime, inboxFilterEntries, unreadInboxEntries } from "./lib/inbox-event-presentation.mjs";
import { joinStrategyLabels } from "./lib/detail-presentation.mjs";
import { relativeTime } from "./lib/relative-time.mjs";
import { researchColumnForStatus } from "./lib/card-question-state.mjs";
import {
  BUILD_BOARD_COLUMNS,
  BUILD_BOARD_COLUMN_LABELS,
  BUILD_BOARD_VISIBLE_COLUMNS,
  STAGE_SEQUENCE,
  STAGE_SKILL,
  WORKFLOW_PHASES,
  buildBoardColumnFor,
  stageInfoUrl,
  stageLabel,
} from "./lib/workflow-vocabulary.mjs";
import { isDoneStatus } from "./lib/trackables.mjs";
import { LIGHTWEIGHT_COLUMNS, LIGHTWEIGHT_COLUMN_LABELS, LIGHTWEIGHT_VISIBLE_COLUMNS } from "./lib/tracks.mjs";
import { shortRef, isPathInstall, updateAvailableFrom } from "./lib/plugin-update.mjs";
import { kanbanGridColumns, toggleFilterValue, matchesFilterValue } from "./lib/kanban-layout.mjs";
import {
  BareCardRoute,
  CardDrawerAdapter,
  INTENT_LABEL,
  StelowCardDetail,
} from "./components/detail/card-detail-route";
import { StelowPanel } from "./components/panel/stelow-panel";
import { rememberStelowReturnFocusCardId } from "./components/panel/stelow-focus.mjs";
import { FiltersBar } from "./components/board/board-filters";
import { ViewToggle } from "./components/board/board-view-toggle";
import { BuildList, ExploreList, ResearchList } from "./components/board/track-lists";
import { BoardColumn } from "./components/board/board-column";
import { BoardCard, ExploreCard, ResearchCard } from "./components/board/board-cards";
import { FlowStrip } from "./components/board/flow-strip";
import { HillBoard } from "./components/board/hill-board";
import { BucketGalleryButton, useBucketGallery } from "./components/board/card-gallery";
import {
  useBoardView,
  useCollapsedGroups,
  usePanelData,
  usePersistentCollapsedGroups,
} from "./components/panel/panel-state-hooks";
import {
  STELOW_PANEL_ID,
  STELOW_PANEL_PATH,
  cardSubPath,
  inboxCardSubPath,
  trackRootSubPath,
  trackTitle,
  type ParsedStelowRoute,
  type StelowTrack,
} from "./components/panel/stelow-route.mjs";
import { useDebouncedRealtime } from "./components/use-debounced-realtime";
import {
  Pill,
} from "./components/dashboard/build-status-pills";
import { StayInTouchStep } from "./components/dashboard/stay-in-touch-step";
import { GithubIssuesDialog, type GithubStatus } from "./components/github/github-issues-dialog";
import { WorkflowSettings, sanitizeReviewGates, type Appetite, type ResearchStrategyOption, type ReviewGates } from "./components/creation/creation-settings";
import { CreateBuildDialog } from "./components/creation/create-build-dialog";
import { CreateResearchDialog } from "./components/creation/create-research-dialog";
import { CreateExploreDialog } from "./components/creation/create-explore-dialog";
import { registerPendingInteraction } from "./components/conversation/question-form";
import { DisclosureChevron, DisclosureSection } from "./components/disclosure";
import { StelowArtifactDirective } from "./components/messages/stelow-artifact-directive";
import { StelowQualityDirective } from "./components/messages/stelow-quality-directive";
import { OpenStelowAction } from "./components/thread/open-stelow-action";
import type { rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ProjectList = Awaited<ReturnType<ReturnType<typeof useRpc<typeof rpcContract>>["call"]>>;
type ProjectItem = Extract<ProjectList, { projects: unknown }>["projects"][number];

type ProjectsResult = Awaited<ReturnType<ReturnType<typeof useRpc<typeof rpcContract>>["call"]>> extends infer R ? Extract<R, { projects?: unknown }> : never;

// Intent mapping lives server-side (lib/github-intent.mjs, single source).
// The panel no longer guesses intent; the server derives it from live labels.
// Stages are ordered workflow checkpoints; phases are board-level groups.
// Explore calls its independent, one-off choices techniques instead.
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

// Every navigation flows through goToTrack / goToCard / goToInboxCard, so
// track roots and card URLs keep one owner in the panel router feature.
type BbNavigate = ReturnType<typeof useBbNavigate>;
function goToTrack(navigate: BbNavigate, track: StelowTrack): void {
  navigate.toPluginPanel(STELOW_PANEL_ID, { subPath: trackRootSubPath(track) });
}
function goToCard(navigate: BbNavigate, card: Pick<CardItem, "kind">, cardId: string, eventId?: string | null): void {
  rememberStelowReturnFocusCardId(cardId);
  navigate.toPluginPanel(STELOW_PANEL_ID, { subPath: cardSubPath(card, cardId, eventId) });
}
function goToInboxCard(navigate: BbNavigate, cardId: string, eventId: string): void {
  navigate.toPluginPanel(STELOW_PANEL_ID, { subPath: inboxCardSubPath(cardId, eventId) });
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
type BandPresetAssignment = { band: string; presetId: string | null; stages: string[] };
type BoardPanelData = {
  boardBandPresets: BandPresetAssignment[];
  boardPresets: PresetManagerPreset[];
  cards: CardItem[];
  githubAutomationEnabled: boolean;
  githubStatus: GithubStatus | null;
  projects: Project[];
};

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
  const [filter, setFilter] = useState<"attention" | "resolved" | "archived" | "all">("attention");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const loadInbox = useCallback(async () => ({
    notifications: (await rpc.call("listNotifications", { includeArchived: true })).notifications,
  }), [rpc]);
  const {
    data: { notifications },
    isInitialLoad: firstLoad,
    load,
    loadError,
    loading,
  } = usePanelData(loadInbox, {
    errorMessage: "Unable to load Stelow Inbox.",
    initialData: { notifications: [] as InboxNotification[] },
    itemCountKey: "notifications",
    realtimeChannels: ["card-state", "inbox-changed"],
  });
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
  const fatalError = loadError && notifications.length === 0;
  const emptyTitle = unreadOnly ? "No unread updates" : filter === "attention" ? "All clear" : `No ${selected.label.toLowerCase()} updates`;
  const emptyDescription = unreadOnly ? "Everything in this view has been read." : filter === "attention" ? "Stelow will surface work only when it needs you." : selected.description;
  return <div className="h-full overflow-auto bg-background p-4 md:p-6"><div className="mx-auto max-w-4xl space-y-5"><header><h1 className="text-xl font-semibold tracking-tight">Inbox</h1><p className="mt-1 text-sm text-muted-foreground">{selected.description}{loading && !firstLoad ? " Updating…" : ""}</p></header><div className="flex flex-wrap items-center gap-x-3 gap-y-2"><div className="flex min-h-11 gap-1 overflow-x-auto rounded-md border p-1" aria-label="Inbox filters">{filters.map((entry) => <button key={entry.id} onClick={() => setFilter(entry.id)} aria-pressed={filter === entry.id} title={entry.description} className={`inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${filter === entry.id ? FILTER_ACTIVE[entry.id] ?? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"}`}><span aria-hidden className={`size-1.5 rounded-full ${FILTER_DOT[entry.id] ?? "bg-primary"}`} />{entry.label}</button>)}</div><label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} className="size-4 accent-primary" />Unread only</label></div>{firstLoad ? <PanelSkeleton rows={3} /> : fatalError ? <section className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm"><p>{loadError}</p><button onClick={() => void load()} className="cursor-pointer mt-3 min-h-11 rounded-md border px-3 text-sm font-medium hover:bg-background">Retry</button></section> : entries.length ? <Section title={selected.label} entries={entries} /> : <section className="rounded-md border border-dashed bg-muted/30 p-8 text-center"><h2 className="text-sm font-semibold">{emptyTitle}</h2><p className="mt-1 text-sm text-muted-foreground">{emptyDescription}</p></section>}</div></div>;
}

function BoardPanel({ active }: { active: boolean }) {
  const { projectId: routeProjectId } = useBbContext();
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const [collapsedColumns, setCollapsedColumns] = usePersistentCollapsedGroups(
    STORAGE_KEYS.boardColumns,
    false,
  );
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
  const [viewMode, setViewMode] = useBoardView(STORAGE_KEYS.buildView, "build");
  const [collapsedListGroups, setCollapsedListGroups] = useCollapsedGroups(STORAGE_KEYS.buildListGroups);
  const [boardPresetsOpen, setBoardPresetsOpen] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const loadBoard = useCallback(async (): Promise<BoardPanelData> => {
    const targetId = routeProjectId;
    const [projectsResult, cardsResult, presetsResult, bandPresetsResult, boardResult] = await Promise.all([
      rpc.call("projects", {}).catch(() => null),
      rpc.call("listCards", { projectId: targetId, kind: "build" }).catch(() => ({ cards: [] })),
      rpc.call("listPresets", {}).catch(() => ({ presets: [] })),
      rpc.call("listBandPresets", {}).catch(() => ({ bands: [] })),
      rpc.call("board", { projectId: targetId }).catch(() => null),
    ]);
    return {
      boardBandPresets: bandPresetsResult.bands,
      boardPresets: presetsResult.presets,
      cards: cardsResult.cards,
      githubAutomationEnabled: boardResult && "githubAutomationEnabled" in boardResult
        ? boardResult.githubAutomationEnabled !== false
        : true,
      githubStatus: boardResult?.githubStatus ?? null,
      projects: projectsResult?.projects ?? [],
    };
  }, [routeProjectId, rpc]);
  const {
    data: {
      boardBandPresets,
      boardPresets,
      cards,
      githubAutomationEnabled,
      githubStatus,
      projects,
    },
    isInitialLoad,
    load,
    loading,
  } = usePanelData(loadBoard, {
    errorMessage: "Unable to load Stelow.",
    initialData: {
      boardBandPresets: [] as BandPresetAssignment[],
      boardPresets: [] as PresetManagerPreset[],
      cards: [] as CardItem[],
      githubAutomationEnabled: true,
      githubStatus: null,
      projects: [] as Project[],
    },
    itemCountKey: "cards",
    realtimeChannels: ["card-state", "board-changed", "inbox-changed"],
  });
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

  const activeProjectId = routeProjectId;
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
  const openBucketCard = (card: CardItem) => goToCard(navigate, card, card.id);
  const bucketGallery = useBucketGallery(grouped.inbox ?? [], openBucketCard);

  async function moveCard(cardId: string, target: string) {
    if (!(COLUMNS as readonly string[]).includes(target)) return;
    const result = await rpc.call("moveCard", { cardId, status: target as "inbox" | "analysis" | "planning" | "execution" | "review" | "completed" | "archived" });
    if (!result.ok) toast.error(result.error ?? "Move failed");
  }


  return (
    <div className="flex h-full overflow-hidden bg-background">
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto max-w-[1500px] space-y-4">
          {isInitialLoad ? <TrackSkeleton /> : <>
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
              <BucketGalleryButton
                cards={grouped.inbox ?? []}
                onOpenCard={openBucketCard}
              />
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
            onChanged={() => void load()}
          />
          <PresetManagerDialog
            open={boardPresetsOpen}
            onOpenChange={setBoardPresetsOpen}
            rpc={rpc}
            presets={boardPresets}
            onChanged={() => load()}
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
                intentOptions={FILTER_INTENT_OPTIONS}
                statusOptions={FILTER_STATUS_OPTIONS}
                activityOptions={FILTER_ACTIVITY_OPTIONS}
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
            <ViewToggle view={viewMode} track="build" onChange={setViewMode} label="Build cards view" />
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
          <FlowStrip
            rpc={rpc}
            projectId={filterProjectIds.length === 1 ? filterProjectIds[0] ?? null : null}
            onOpenCard={(kind, cardId) => goToCard(navigate, { kind }, cardId)}
          />
          {viewMode === "list" ? (
            <BuildList
              groups={grouped}
              collapsed={collapsedListGroups}
              onToggle={(column) => setCollapsedListGroups((current) => ({
                ...current,
                [column]: !current[column],
              }))}
              onOpenCard={(card) => goToCard(navigate, card, card.id)}
              onOpenThread={(threadId) => navigate.toThread(threadId)}
            />
          ) : viewMode === "hill" ? (
            <HillBoard cards={Object.values(grouped).flat()} onOpenCard={(card) => goToCard(navigate, card, card.id)} />
          ) : (
            <div
              data-testid="kanban-board"
              className="grid justify-start gap-3 overflow-x-auto md:h-[clamp(20rem,calc(100dvh-17rem),48rem)] md:overflow-y-hidden"
              style={{ gridTemplateColumns: kanbanGridColumns(VISIBLE_COLUMNS, collapsedColumns) }}
            >
              {VISIBLE_COLUMNS.map((column) => (
                <BoardColumn
                  key={column}
                  column={column}
                  cards={grouped[column]}
                  collapsed={Boolean(collapsedColumns[column])}
                  onToggleCollapsed={() => setCollapsedColumns((current) => ({
                    ...current,
                    [column]: !current[column],
                  }))}
                  onDrop={(cardId) => moveCard(cardId, column)}
                  labels={COLUMN_LABELS}
                  renderCard={(card) => <BoardCard card={card} onOpen={() => goToCard(navigate, card, card.id)} />}
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

// Second track beside Build: lightweight research (Bucket / Doing / Done)
// driven by one stelow-product-* strategy per card. No stages, no gates —
// the card produces a index, and opportunities fan out into Build cards.
function ResearchPanel({ active }: { active: boolean }) {
  const { projectId: routeProjectId } = useBbContext();
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const [researchPresetsOpen, setResearchPresetsOpen] = useState(false);
  const [collapsedColumns, setCollapsedColumns] = usePersistentCollapsedGroups(
    STORAGE_KEYS.researchColumns,
    false,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [viewMode, setViewMode] = useBoardView(STORAGE_KEYS.researchView, "research");
  const [collapsedListGroups, setCollapsedListGroups] = useCollapsedGroups(STORAGE_KEYS.researchListGroups);
  const [filterProjectIds, setFilterProjectIds] = useState<string[]>([]);
  const [filterAttention, setFilterAttention] = useState(false);
  const loadResearch = useCallback(async () => {
    const targetId = routeProjectId;
    const [projectsResult, cardsResult, strategiesResult, presetsResult, bandPresetsResult] = await Promise.all([
      rpc.call("projects", {}).catch(() => null),
      rpc.call("listCards", { projectId: targetId, kind: "research" }).catch(() => ({ cards: [] })),
      rpc.call("researchStrategies", {}).catch(() => ({ strategies: [] })),
      rpc.call("listPresets", {}).catch(() => ({ presets: [] })),
      rpc.call("listBandPresets", {}).catch(() => ({ bands: [] })),
    ]);
    return {
      cards: cardsResult.cards,
      presets: presetsResult.presets,
      projects: projectsResult?.projects ?? [],
      researchBandPresets: bandPresetsResult.bands,
      strategies: strategiesResult.strategies,
    };
  }, [routeProjectId, rpc]);
  const {
    data: { cards, presets, projects, researchBandPresets, strategies },
    isInitialLoad,
    load,
  } = usePanelData(loadResearch, {
    errorMessage: "Unable to load research.",
    initialData: {
      cards: [] as CardItem[],
      presets: [] as PresetManagerPreset[],
      projects: [] as Project[],
      researchBandPresets: [] as BandPresetAssignment[],
      strategies: [] as ResearchStrategyOption[],
    },
    itemCountKey: "cards",
    realtimeChannels: ["card-state", "board-changed", "inbox-changed"],
  });

  const strategyLabelById = useMemo(() => new Map(strategies.map((entry) => [entry.id, entry.label])), [strategies]);
  const activeProjectId = routeProjectId;
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
  const openBucketCard = (card: CardItem) => goToCard(navigate, card, card.id);
  const bucketGallery = useBucketGallery(grouped.inbox ?? [], openBucketCard);
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
          {isInitialLoad ? <TrackSkeleton columns={4} /> : <>
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
              <BucketGalleryButton
                cards={grouped.inbox ?? []}
                onOpenCard={openBucketCard}
              />
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
            onChanged={() => load()}
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
            <ViewToggle view={viewMode} track="research" onChange={setViewMode} label="Research cards view" />
          </div>
          {viewMode === "board" ? (
          <p className="text-xs text-muted-foreground">
            <span className="sm:hidden">Swipe sideways to view every stage.</span>
            <span className="hidden sm:inline">Use Shift + scroll to move across stages.</span>
          </p>
          ) : null}
          {viewMode === "list" ? (
            <ResearchList
              groups={grouped}
              strategyLabelById={strategyLabelById}
              collapsed={collapsedListGroups}
              onToggle={(column) => setCollapsedListGroups((current) => ({
                ...current,
                [column]: !current[column],
              }))}
              onOpenCard={(card) => goToCard(navigate, card, card.id)}
              onOpenThread={(threadId) => navigate.toThread(threadId)}
            />
          ) : (
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
                renderCard={(card) => (
                  <ResearchCard
                    card={card}
                    strategyLabel={joinStrategyLabels(card.researchStrategies ?? [], strategyLabelById)}
                    onOpen={() => goToCard(navigate, card, card.id)}
                  />
                )}
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
  const [researchPresetsOpen, setResearchPresetsOpen] = useState(false);
  const [collapsedColumns, setCollapsedColumns] = usePersistentCollapsedGroups(
    STORAGE_KEYS.exploreColumns,
    false,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [viewMode, setViewMode] = useBoardView(STORAGE_KEYS.exploreView, "explore");
  const [collapsedListGroups, setCollapsedListGroups] = useCollapsedGroups(STORAGE_KEYS.exploreListGroups);
  const [filterProjectIds, setFilterProjectIds] = useState<string[]>([]);
  const [filterAttention, setFilterAttention] = useState(false);
  const loadExplore = useCallback(async () => {
    const targetId = routeProjectId;
    const [projectsResult, cardsResult, stagesResult, presetsResult, bandPresetsResult] = await Promise.all([
      rpc.call("projects", {}).catch(() => null),
      rpc.call("listCards", { projectId: targetId, kind: "explore" }).catch(() => ({ cards: [] })),
      rpc.call("stageCatalog", {}).catch(() => ({ stages: [] })),
      rpc.call("listPresets", {}).catch(() => ({ presets: [] })),
      rpc.call("listBandPresets", {}).catch(() => ({ bands: [] })),
    ]);
    return {
      cards: cardsResult.cards,
      presets: presetsResult.presets,
      projects: projectsResult?.projects ?? [],
      researchBandPresets: bandPresetsResult.bands,
      stages: stagesResult.stages,
    };
  }, [routeProjectId, rpc]);
  const {
    data: { cards, presets, projects, researchBandPresets, stages },
    isInitialLoad,
    load,
  } = usePanelData(loadExplore, {
    errorMessage: "Unable to load explore.",
    initialData: {
      cards: [] as CardItem[],
      presets: [] as PresetManagerPreset[],
      projects: [] as Project[],
      researchBandPresets: [] as BandPresetAssignment[],
      stages: [] as ResearchStrategyOption[],
    },
    itemCountKey: "cards",
    realtimeChannels: ["card-state", "board-changed", "inbox-changed"],
  });

  const activeProjectId = routeProjectId;
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
  const openBucketCard = (card: CardItem) => goToCard(navigate, card, card.id);
  const bucketGallery = useBucketGallery(grouped.inbox ?? [], openBucketCard);
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
          {isInitialLoad ? <TrackSkeleton columns={4} /> : <>
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
              <BucketGalleryButton
                cards={grouped.inbox ?? []}
                onOpenCard={openBucketCard}
              />
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
            onChanged={() => load()}
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
            <ViewToggle view={viewMode} track="explore" onChange={setViewMode} label="Explore cards view" />
          </div>
          {viewMode === "board" ? (
          <p className="text-xs text-muted-foreground">
            <span className="sm:hidden">Swipe sideways to view every stage.</span>
            <span className="hidden sm:inline">Use Shift + scroll to move across stages.</span>
          </p>
          ) : null}
          {viewMode === "list" ? (
            <ExploreList
              groups={grouped}
              stageLabelById={stageLabelById}
              collapsed={collapsedListGroups}
              onToggle={(column) => setCollapsedListGroups((current) => ({
                ...current,
                [column]: !current[column],
              }))}
              onOpenCard={(card) => goToCard(navigate, card, card.id)}
              onOpenThread={(threadId) => navigate.toThread(threadId)}
            />
          ) : (
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
                renderCard={(card) => (
                  <ExploreCard
                    card={card}
                    stageLabel={card.exploreStage ? (stageLabelById.get(card.exploreStage) ?? card.exploreStage) : null}
                    onOpen={() => goToCard(navigate, card, card.id)}
                  />
                )}
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

// localStorage keys in one place for board and track preferences. Renaming
// a key is one line; readers never guess at raw strings scattered through panels.
const STORAGE_KEYS = {
  boardColumns: "stelow-columns-collapsed-v1",
  researchColumns: "stelow-research-columns-collapsed-v1",
  exploreColumns: "stelow-explore-columns-collapsed-v1",
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

// Board view and collapsed-state hooks live with the other panel state.
// Card route adapters live in components/detail/card-detail-route. The app
// supplies navigation and the preset dialog factory so route behavior stays
// independent from the panel shell.

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

function renderTrackPanel(tab: StelowTrack, active: boolean) {
  if (tab === "inbox") return <InboxPanel />;
  if (tab === "build") return <BoardPanel active={active} />;
  if (tab === "research") return <ResearchPanel active={active} />;
  if (tab === "explore") return <ExplorePanel active={active} />;
  return <AboutPanel />;
}

function renderCardRoute(
  route: ParsedStelowRoute,
  navigate: BbNavigate,
  onOpenRecoveryAudit: (cardId: string) => void,
  renderPresetDialog: (cardId: string, props: { open: boolean; onOpenChange: (next: boolean) => void; onChanged: () => void }) => React.ReactNode,
) {
  const shared = {
    navigate,
    intentLabels: INTENT_LABEL,
    onOpenRecoveryAudit,
    renderPresetDialog,
  };
  if (route.kind === "bare-card") {
    return <BareCardRoute cardId={route.cardId} eventId={route.eventId} {...shared} />;
  }
  if (route.kind === "card") {
    return <StelowCardDetail cardId={route.cardId} eventId={route.eventId} backTrack={route.origin} {...shared} />;
  }
  return null;
}

type PresetDialogRendererProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onChanged: () => void;
};

function StelowPanelRoute({ subPath }: { subPath: string }) {
  const navigate = useBbNavigate();
  const inbox = useInboxAccessory();
  const build = useBuildAccessory();
  const research = useResearchAccessory();
  const aboutAlert = usePluginUpdateSignal();
  const renderPresetDialog = (cardId: string, { open, onOpenChange, onChanged }: PresetDialogRendererProps) => (
    <PresetAssignDialog open={open} onOpenChange={onOpenChange} cardId={cardId} onChanged={onChanged} />
  );
  return (
    <StelowPanel
      subPath={subPath}
      counts={{ inbox: inbox.count, build: build.count, research: research.count, explore: 0, about: 0 }}
      aboutAlert={aboutAlert}
      updateBadge={<UpdateBadge />}
      onSelectTrack={(track) => goToTrack(navigate, track)}
      renderCard={(route) => renderCardRoute(
        route,
        navigate,
        (cardId) => goToCard(navigate, { kind: "build" }, cardId),
        renderPresetDialog,
      )}
      renderTrack={renderTrackPanel}
    />
  );
}

// Timeline of the 17 workflow stages, grouped by phase (band). Each stage is a
// chip: passed / current / upcoming. Clicking an allowed target advances or
// regresses ONE stage — the timeline is the position context AND the advance
// control, so the user always sees where the card is and what it can move to.

// Palette commands open the extracted drawer with a threadId (no card context
// at the palette); its adapter resolves that thread to the owning card.
function StelowCardDrawer(props: PluginThreadPanelProps) {
  const navigate = useBbNavigate();
  const renderPresetDialog = (cardId: string, { open, onOpenChange, onChanged }: PresetDialogRendererProps) => (
    <PresetAssignDialog open={open} onOpenChange={onOpenChange} cardId={cardId} onChanged={onChanged} />
  );
  return (
    <CardDrawerAdapter
      {...props}
      intentLabels={INTENT_LABEL}
      onOpenRecoveryAudit={(cardId) => goToCard(navigate, { kind: "build" }, cardId)}
      renderPresetDialog={renderPresetDialog}
    />
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
    component: (props) => { PillsyStyles(); return <StelowPanelRoute subPath={props.subPath} />; },
    experimental_sidebarAccessory: StelowInboxSidebarAccessory,
  });
  registerPendingInteraction(app);
  app.slots.threadPanelAction({ id: "stelow-card-detail", title: "Stelow card", icon: "Columns2", component: StelowCardDrawer });
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

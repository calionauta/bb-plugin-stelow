import { Children, memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Markdown,
  experimental_SourceCode as SourceCode,
  definePluginApp,
  UrlLink,
  experimental_Diff as DiffView,
  experimental_FileLink as FileLink,
  experimental_NewThreadComposer as NewThreadComposer,
  experimental_PermissionModePicker as PermissionModePicker,
  experimental_ProviderModelPicker as ProviderModelPicker,
  useBbContext,
  useBbNavigate,
  useComposer,
  useRealtime,
  useRpc,
  type NewThreadRequest,
  type PluginMessageDirectiveProps,
  type PluginPendingInteractionProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { countsForInboxBadge } from "./lib/inbox-events.mjs";
import { CLASSIFIER_DEFAULT_ENDPOINT, DECISION_API_DEFAULT_ENDPOINT } from "./lib/decision-api.mjs";
import { INBOX_EVENT_LABELS, inboxEventPresentation, inboxFilterEntries, isOpenInboxAction, unreadInboxEntries } from "./lib/inbox-event-presentation.mjs";
import { researchColumnForStatus } from "./lib/card-question-state.mjs";
import { parseResearchIndexSections } from "./lib/research-index-sections.mjs";
import { researchOpportunityHint } from "./lib/research-opportunity-summary.mjs";
import { groupArtifactsByStage, groupResearchArtifacts } from "./lib/artifact-groups.mjs";
import { BUILD_BOARD_COLUMNS, BUILD_BOARD_COLUMN_LABELS, PHASE_LABELS, STAGE_PRODUCES, STAGE_SEQUENCE, STAGE_SKILL, STAGE_TO_BAND, WORKFLOW_PHASES, buildBoardColumnFor, stageInfoUrl, stageLabel } from "./lib/workflow-vocabulary.mjs";
import { inheritAskArtifact, normalizeAskArtifactPath } from "./lib/question-batch.mjs";
import { isSplitQuestion, splitOptionDescription, splitQuestionText, splitSelectionNotice } from "./lib/split-question-presentation.mjs";
import { questionCopy } from "./lib/question-presentation.mjs";
import { SPLIT_KEEP_LABEL } from "./lib/split-proposal.mjs";
import { expiredAnswerPayload } from "./lib/expired-question-answers.mjs";
import { LIGHTWEIGHT_COLUMNS, LIGHTWEIGHT_COLUMN_LABELS } from "./lib/tracks.mjs";
import { shortRef, isPathInstall, updateAvailableFrom } from "./lib/plugin-update.mjs";
import { kanbanGridColumns } from "./lib/kanban-layout.mjs";
import { branchWebLinks } from "./lib/remote-url.mjs";
import { workerActionPolicy, workerSectionPolicy } from "./lib/worker-action-policy.mjs";
import { canEditWorkflowIntent, canReclassifyWorkflow } from "./lib/workflow-intent-policy.mjs";
import { archivedCardDetailPresentation } from "./lib/card-detail-presentation.mjs";
import { formatTokenUsage } from "./lib/token-usage.mjs";
import { previewAction } from "./lib/preview-session.mjs";
import { ActivityPill, BuildStatusPills, CURRENT_STAGE_PILL_CLASS, CurrentStagePill, LightweightStatusPills, Pill } from "./components/dashboard/build-status-pills";
import { StayInTouchStep } from "./components/dashboard/stay-in-touch-step";
import { GithubIssuesDialog, type GithubStatus } from "./components/github-issues-dialog";
import { StartImmediatelyCheck } from "./components/start-immediately-check";
import type { PreviewInfo, rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { CONTROL_HOVER_TRANSITION } from "@/components/ui/motion";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport.js";
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
const BAND_LABEL: Record<string, string> = { ...PHASE_LABELS, research: "Research", explore: "Explore" };
// Build board topology is centralized with the workflow vocabulary. The
// aliases keep component call sites readable; they do not define columns.
const COLUMNS = BUILD_BOARD_COLUMNS;
const COLUMN_LABELS: Record<string, string> = BUILD_BOARD_COLUMN_LABELS;
// workerThreadId is part of the projection (a threadless card waits in the
// Inbox), so it must survive this pick — dropping it silently returned every
// parked card to the Analysis phase.
function boardColumnOf(card: Pick<CardItem, "status" | "stage" | "workerThreadId">): string {
  return buildBoardColumnFor(card);
}

// Lightweight-track columns (Research + Explore share them): a deliberately
// dumb Inbox / Doing / Done flow. Canonical in lib/tracks (shared with the
// server via lib/card-move) — these aliases keep existing call sites stable.
// Statuses reuse the shared enum (pending / in-progress / completed /
// archived) so no migration or guard changes are needed; the mapping lives
// in lib/card-question-state (shared with the server) so a waiting question
// — activity, never status — can never push a Doing card back to Inbox.
const RESEARCH_COLUMNS = LIGHTWEIGHT_COLUMNS as unknown as readonly ["inbox", "doing", "done", "archived"];
const RESEARCH_COLUMN_LABELS: Record<string, string> = LIGHTWEIGHT_COLUMN_LABELS;
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

// Composite strategy label: unique playbook labels joined in run order.
// Falls back to the raw id when the label map has not loaded yet, so the
// pill never renders empty while strategies fetch.
function joinStrategyLabels(ids: Array<string | null | undefined>, byId: Map<string, string>): string | null {
  const labels: string[] = [];
  for (const id of ids) {
    const label = (id && byId.get(id)) || id;
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels.length > 0 ? labels.join(" + ") : null;
}

// Position of a stage in the canonical sequence (-1 if unknown).
function stageIndex(stage: string) {
  return STAGE_SEQUENCE.indexOf(stage);
}


const FILTER_INTENT_OPTIONS = [{ value: "all", label: "All types" }, ...Object.entries(INTENT_LABEL).map(([value, label]) => ({ value, label }))];
const FILTER_STATUS_OPTIONS = [{ value: "all", label: "Any status" }, ...COLUMNS.map((column) => ({ value: column, label: COLUMN_LABELS[column] ?? column }))];
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
type CardComment = CardDetailResponse["comments"][number];
type ExpiredQuestion = CardDetailResponse["expiredQuestions"][number];

function statusTone(status: string) {
  if (["completed", "done"].includes(status)) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  if (["in-progress", "approved"].includes(status)) return "bg-primary/15 text-primary";
  if (["blocked", "failed"].includes(status)) return "bg-destructive/15 text-destructive";
  if (["escalated"].includes(status)) return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  if (["skipped", "archived"].includes(status)) return "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300";
  return "bg-muted text-muted-foreground";
}

function statusGlyph(status: string) {
  if (status === "done" || status === "completed") return "✓";
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

const APPETITE_OPTIONS = [
  { value: "Lean", label: "Lean", description: "Smallest useful cycle: 1–2 scopes and one direct direction." },
  { value: "Core", label: "Core", description: "Standard cycle: main job, obvious edge cases, and 3–5 scopes." },
  { value: "Complete", label: "Complete", description: "Broad exploration and deeper validation across the whole request." },
] as const;

const REVIEW_GATE_OPTIONS = [
  { value: "spec", label: "Product spec", description: "Review the shaped product specification and assumptions." },
  { value: "interface", label: "Interface direction", description: "Pick the interface proposal after reviewing the alternatives." },
  { value: "scope", label: "Build scopes", description: "Confirm the planned build scopes (IN/OUT)." },
  { value: "tech", label: "Technical plan", description: "Review the technical plan before execution." },
  { value: "diff", label: "Code diff", description: "Review the final code diff." },
] as const;

const REVIEW_GATE_VALUES = REVIEW_GATE_OPTIONS.map((option) => option.value);

// One-click templates write into the same multi-select state — they are
// shortcuts, never a second model. The six legacy rungs plus named
// shortcuts for combinations the ladder could never express.
const REVIEW_GATE_PRESETS: ReadonlyArray<{ label: string; gates: ReviewGate[] }> = [
  { label: "Auto", gates: [] },
  { label: "Product Spec Gate", gates: ["spec"] },
  { label: "Product Spec + Interface Gates", gates: ["spec", "interface"] },
  { label: "Product Spec + Interface + Scopes", gates: ["spec", "interface", "scope"] },
  { label: "Product Spec + Interface + Tech Review", gates: ["spec", "interface", "scope", "tech"] },
  { label: "Product Spec + Interface + Tech Review + Code Diff", gates: ["spec", "interface", "scope", "tech", "diff"] },
  { label: "Interface only", gates: ["interface"] },
  { label: "Spec + tech plan", gates: ["spec", "tech"] },
];

type Appetite = (typeof APPETITE_OPTIONS)[number]["value"];
type ReviewGate = (typeof REVIEW_GATE_OPTIONS)[number]["value"];
type ReviewGates = ReviewGate[];

function sanitizeReviewGates(value: unknown): ReviewGates {
  if (!Array.isArray(value)) return [];
  const valid: ReadonlySet<string> = new Set(REVIEW_GATE_VALUES);
  const gates = value.filter((entry): entry is ReviewGate => typeof entry === "string" && valid.has(entry));
  return REVIEW_GATE_VALUES.filter((atom): atom is ReviewGate => gates.includes(atom));
}

function reviewGatesSummary(gates: string[]): string {
  if (gates.length === 0) return "Auto — the agent decides everything";
  return gates.map((gate) => REVIEW_GATE_OPTIONS.find((option) => option.value === gate)?.label ?? gate).join(", ");
}

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
};

type InboxEventSnapshot = Pick<InboxNotification, "kind" | "summary" | "occurredAt" | "resolvedAt" | "archivedAt">;

const INBOX_COPY: Record<InboxNotification["kind"], { icon: string; label: string; tone: string }> = {
  question: { icon: "?", label: INBOX_EVENT_LABELS.question, tone: "bg-amber-500/15 text-amber-700" },
  error: { icon: "!", label: INBOX_EVENT_LABELS.error, tone: "bg-destructive/15 text-destructive" },
  paused: { icon: "Ⅱ", label: INBOX_EVENT_LABELS.paused, tone: "bg-amber-500/15 text-amber-700" },
  completed: { icon: "✓", label: INBOX_EVENT_LABELS.completed, tone: "bg-emerald-500/15 text-emerald-700" },
};

function inboxEventDescription(event: InboxEventSnapshot): string {
  const { stateLabel } = inboxEventPresentation(event);
  return stateLabel ? "This Inbox update is kept for history." : event.summary;
}

function inboxEventText(event: InboxEventSnapshot): string {
  const { label } = inboxEventPresentation(event);
  const description = inboxEventDescription(event);
  return description.toLowerCase().includes(label.toLowerCase()) ? description : `${label}. ${description}`;
}

function inboxEventTime(event: InboxEventSnapshot): string {
  const { stateAt, stateLabel } = inboxEventPresentation(event);
  return stateLabel ? `${stateLabel} ${relativeTime(stateAt)}` : relativeTime(stateAt);
}

function shouldShowInboxEventBanner(event: InboxEventSnapshot | null, hero: { kind: HeroKind } | null): boolean {
  if (!event || !isOpenInboxAction(event)) return true;
  return !((event.kind === "question" && hero?.kind === "decision")
    || (event.kind === "error" && hero?.kind === "error")
    || (event.kind === "paused" && hero?.kind === "paused"));
}

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1_000));
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Yesterday" : `${days}d ago`;
}

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
              <span className="min-w-0"><span className="flex flex-wrap items-center gap-x-2"><strong className="text-sm">{entry.cardName}</strong>{presentation.stateLabel ? <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{presentation.label}</span> : null}{!entry.readAt ? <span className="size-1.5 rounded-full bg-primary"><span className="sr-only">Unread</span></span> : null}</span><span className="mt-0.5 block text-sm text-muted-foreground">{inboxEventText(entry)}</span><span className="mt-1 block text-xs text-muted-foreground" title={new Date(inboxEventPresentation(entry).stateAt).toLocaleString()}>{entry.projectName} · {inboxEventTime(entry)}</span></span>
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

function composerExecutionOf(request: NewThreadRequest) {
  return {
    providerId: request.providerId,
    model: request.model,
    reasoningLevel: request.reasoningLevel,
    permissionMode: request.permissionMode,
    ...(request.serviceTier ? { serviceTier: request.serviceTier } : {}),
    ...(request.executionInputSources ? { executionInputSources: request.executionInputSources } : {}),
  };
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
  const [createBuildError, setCreateBuildError] = useState<string | null>(null);
  // Deferred start: unchecked parks the card in Inbox with no worker.
  // Checked (default) preserves today's behavior — spawn on submit.
  const [startImmediately, setStartImmediately] = useState(true);
  // Workflow preferences stay visible under the composer: a collapsed
  // Settings hides consequential choices (planning depth, review gates)
  // the user would otherwise never discover. The dialog frame keeps a
  // fixed max height with inner scroll, so nothing jumps or resizes.
  const [prompt, setPrompt] = useState("");
  const [intent, setIntent] = useState<"new-product" | "feature" | "bugfix" | "refactor" | "investigate" | "unknown">("unknown");
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
  const [filterProjectId, setFilterProjectId] = useState<string | "all">("all");
  const [filterStage, setFilterStage] = useState<string>("all");
  const [filterIntent, setFilterIntent] = useState<string | "all">("all");
  const [filterStatus, setFilterStatus] = useState<string | "all">("all");
  const [filterActivity, setFilterActivity] = useState<string | "all">("all");
  const [filterAttention, setFilterAttention] = useState(false);
  const [viewMode, setViewMode] = useState<"board" | "list">("board");
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
    if (filterProjectId !== "all" && card.projectId !== filterProjectId) return false;
    if (filterIntent !== "all" && card.intent !== filterIntent) return false;
    if (filterStatus !== "all" && boardColumnOf(card) !== filterStatus) return false;
    if (filterActivity !== "all" && card.activity !== filterActivity) return false;
    if (filterStage !== "all" && card.stage !== filterStage) return false;
    if (filterAttention && !card.needsAttention) return false;
    return true;
  }), [cards, filterProjectId, filterIntent, filterStatus, filterActivity, filterStage, filterAttention]);
  const stageOptions = useMemo(() => Array.from(new Set(cards.map((card) => card.stage))).sort(), [cards]);
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

  async function start(request: NewThreadRequest) {
    const targetProjectId = request.projectId || activeProjectId;
    if (!targetProjectId) return;
    // Keep files structured: a path printed in a prompt is not an attachment,
    // so BB cannot render or open it in the worker thread.
    const textPart = request.input.find((part) => part.type === "text");
    const text = textPart && "text" in textPart ? (textPart as { text: string }).text.trim() : "";
    const attachments = request.input
      .filter((part): part is { type: "localFile" | "localImage"; path: string } => (part.type === "localFile" || part.type === "localImage") && "path" in part && typeof part.path === "string" && part.path.length > 0)
      .map((part) => ({ type: part.type, path: part.path }));
    const prompt = text;
    if (!prompt.trim()) return;
    setCreateBuildError(null);
    try {
      const result = await rpc.call("createCard", { projectId: targetProjectId, environment: request.environment, prompt, attachments, intent, appetite, reviewMode: reviewGates, start: startImmediately, execution: composerExecutionOf(request) });
      setPrompt("");
      setCreateBuildOpen(false);
      navigate.openThreadPanel({ actionId: "stelow-card-detail", title: result.cardId, params: { cardId: result.cardId } });
      toast.success(startImmediately ? "Card started in Triage. Stelow will triage it." : "Card parked in Inbox. Start it from the card when ready.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start the card.";
      setCreateBuildError(message);
      toast.error(message);
      throw error;
    }
  }

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

          <Dialog open={createBuildOpen} onOpenChange={(open) => { setCreateBuildOpen(open); if (open) { setStartImmediately(true); setCreateBuildError(null); } }}>
            <DialogContent fullscreenOnMobile className="overflow-y-auto sm:max-h-[calc(100dvh-1rem)] sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle>Start new issue</DialogTitle>
                <DialogDescription>Describe the outcome, problem, or change. Planning depth and review checkpoints below start from the board defaults — keep them or adjust, then submit.</DialogDescription>
              </DialogHeader>
              {createBuildError ? <CreateCardAlert message={createBuildError} /> : null}
              <NewThreadComposer
                defaultProjectId={activeProjectId ?? undefined}
                defaultProviderId={analysisWorkerPreset?.providerId}
                defaultModel={analysisWorkerPreset?.modelId}
                defaultReasoningLevel={analysisWorkerPreset?.reasoningLevel as NewThreadRequest["reasoningLevel"] | undefined}
                defaultPermissionMode={analysisWorkerPreset?.permissionMode as NewThreadRequest["permissionMode"] | undefined}
                initialPrompt={prompt}
                placeholder="What should Stelow build?"
                layout="contained"
                draftKey="stelow-board-create"
                onSubmit={(request) => start(request)}
              />
              <div className="grid gap-4 border-t pt-4">
                <AgentConfigBox
                  lines={[`Analysis phase runs on ${analysisWorkerPreset?.name ?? "Default"}`]}
                  onConfigure={() => setBoardPresetsOpen(true)}
                />
                <StartImmediatelyCheck checked={startImmediately} onChange={setStartImmediately} />
                <WorkflowSettings appetite={appetite} reviewGates={reviewGates} onAppetiteChange={setAppetite} onReviewGatesChange={setReviewGates} groupNamePrefix="create" />
              </div>
            </DialogContent>
          </Dialog>

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
                filterProjectId={filterProjectId}
                filterStage={filterStage}
                filterIntent={filterIntent}
                filterStatus={filterStatus}
                filterActivity={filterActivity}
                filterAttention={filterAttention}
                onProject={setFilterProjectId}
                onStage={setFilterStage}
                onIntent={setFilterIntent}
                onStatus={setFilterStatus}
                onActivity={setFilterActivity}
                onAttention={setFilterAttention}
                onReset={() => { setFilterProjectId("all"); setFilterStage("all"); setFilterIntent("all"); setFilterStatus("all"); setFilterActivity("all"); setFilterAttention(false); }}
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
          {viewMode === "list" ? <BuildList groups={grouped} navigate={navigate} collapsed={collapsedListGroups} onToggle={(column) => setCollapsedListGroups((current) => ({ ...current, [column]: !current[column] }))} /> : <div data-testid="kanban-board" className="grid justify-start gap-3 overflow-x-auto md:h-[clamp(20rem,calc(100dvh-17rem),48rem)] md:overflow-y-hidden" style={{ gridTemplateColumns: kanbanGridColumns(COLUMNS, collapsedColumns) }}>
            {COLUMNS.map((column) => (
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

type ResearchStrategyOption = { id: string; label: string; skill: string; blurb: string; emoji: string; keywords: string[] };

// Second track beside Build: lightweight research (Inbox / Doing / Done)
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
  const [createError, setCreateError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [strategy, setStrategy] = useState<string | null>(null);
  const [strategyAttention, setStrategyAttention] = useState(0);
  // Deferred start: unchecked parks the card in Inbox with no worker.
  // Checked (default) preserves today's behavior — spawn on submit.
  const [startImmediately, setStartImmediately] = useState(true);
  const [viewMode, setViewMode] = useState<"board" | "list">("board");
  const [collapsedListGroups, setCollapsedListGroups] = useCollapsedGroups(STORAGE_KEYS.researchListGroups);
  const [filterProjectId, setFilterProjectId] = useState<string | "all">("all");
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
    if (filterProjectId !== "all" && card.projectId !== filterProjectId) return false;
    if (filterAttention && !card.needsAttention) return false;
    return true;
  }), [cards, filterProjectId, filterAttention]);
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
  const inbox = cards.filter((card) => card.needsAttention && card.status !== "archived");

  async function start(request: NewThreadRequest) {
    const targetProjectId = request.projectId || activeProjectId;
    if (!targetProjectId) return;
    const textPart = request.input.find((part) => part.type === "text");
    const text = textPart && "text" in textPart ? (textPart as { text: string }).text.trim() : "";
    const attachments = request.input
      .filter((part): part is { type: "localFile" | "localImage"; path: string } => (part.type === "localFile" || part.type === "localImage") && "path" in part && typeof part.path === "string" && part.path.length > 0)
      .map((part) => ({ type: part.type, path: part.path }));
    if (!text.trim()) return;
    if (!strategy) {
      toast.error("Pick a strategy first.");
      setStrategyAttention((count) => count + 1);
      // Throw so the composer keeps the draft: a blocked submit must never
      // lose what the user typed (SDK clears the draft only on resolve).
      throw new Error("Pick a strategy first.");
    }
    setCreateError(null);
    try {
      const result = await rpc.call("createResearchCard", { projectId: targetProjectId, environment: request.environment, prompt: text, attachments, strategy, start: startImmediately, execution: composerExecutionOf(request) });
      setPrompt("");
      setCreateOpen(false);
      navigate.openThreadPanel({ actionId: "stelow-card-detail", title: result.cardId, params: { cardId: result.cardId } });
      toast.success(startImmediately ? "Research started. Results will appear on this card when ready." : "Research parked in Inbox. Start it from the card when ready.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start research.";
      setCreateError(message);
      toast.error(message);
      throw error;
    }
  }

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

          <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (open) { setStrategy(null); setStartImmediately(true); setCreateError(null); } }}>
            <DialogContent fullscreenOnMobile className="overflow-y-auto sm:max-h-[calc(100dvh-1rem)] sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle>Start new research</DialogTitle>
                <DialogDescription>Pick a strategy below, then describe what to investigate. One strategy per round — run more rounds from the card to compound perspectives.</DialogDescription>
              </DialogHeader>
              {createError ? <CreateCardAlert message={createError} /> : null}
              <div className="grid gap-4">
                <div className="grid gap-1.5">
                  <span className="text-xs font-medium text-foreground">Choose a strategy</span>
                  <StrategyPicker strategies={strategies} value={strategy} onChange={setStrategy} groupName="strategy-pick" attentionSignal={strategyAttention} />
                </div>
                <AgentConfigBox
                  lines={[`Research runs on ${effectiveResearchPreset?.name ?? "Default"}${researchBandPreset ? "" : " (board default)"}`]}
                  onConfigure={() => setResearchPresetsOpen(true)}
                />
                <StartImmediatelyCheck checked={startImmediately} onChange={setStartImmediately} />
                <NewThreadComposer
                  defaultProjectId={activeProjectId ?? undefined}
                  defaultProviderId={effectiveResearchPreset?.providerId}
                  defaultModel={effectiveResearchPreset?.modelId}
                  defaultReasoningLevel={effectiveResearchPreset?.reasoningLevel as NewThreadRequest["reasoningLevel"] | undefined}
                  defaultPermissionMode={effectiveResearchPreset?.permissionMode as NewThreadRequest["permissionMode"] | undefined}
                  initialPrompt={prompt}
                  placeholder="What should Stelow investigate?"
                  layout="contained"
                  draftKey="stelow-research-create"
                  onSubmit={(request) => start(request)}
                />
              </div>
            </DialogContent>
          </Dialog>

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
                filterProjectId={filterProjectId}
                filterAttention={filterAttention}
                onProject={setFilterProjectId}
                onAttention={setFilterAttention}
                onReset={() => { setFilterProjectId("all"); setFilterAttention(false); }}
              />
            </div>
            <ViewToggle view={viewMode} onChange={setViewMode} label="Research cards view" />
          </div>
          {viewMode === "board" ? (
          <p className="text-xs text-muted-foreground">
            <span className="sm:hidden">Swipe sideways to view every stage.</span>
            <span className="hidden sm:inline">Use Shift + scroll to move across stages.</span>
          </p>
          ) : null}
          {viewMode === "list" ? <ResearchList groups={grouped} navigate={navigate} strategyLabelById={strategyLabelById} collapsed={collapsedListGroups} onToggle={(column) => setCollapsedListGroups((current) => ({ ...current, [column]: !current[column] }))} /> : (
          <div data-testid="kanban-board" className="grid justify-start gap-3 overflow-x-auto md:h-[clamp(20rem,calc(100dvh-17rem),48rem)] md:overflow-y-hidden" style={{ gridTemplateColumns: kanbanGridColumns(RESEARCH_COLUMNS, collapsedColumns) }}>
            {RESEARCH_COLUMNS.map((column) => (
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
  const [createError, setCreateError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [stage, setStage] = useState<string | null>(null);
  const [stageAttention, setStageAttention] = useState(0);
  // Deferred start: unchecked parks the card in Inbox with no worker.
  // Checked (default) preserves today's behavior — spawn on submit.
  const [startImmediately, setStartImmediately] = useState(true);
  const [viewMode, setViewMode] = useState<"board" | "list">("board");
  const [collapsedListGroups, setCollapsedListGroups] = useCollapsedGroups(STORAGE_KEYS.exploreListGroups);
  const [filterProjectId, setFilterProjectId] = useState<string | "all">("all");
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
    if (filterProjectId !== "all" && card.projectId !== filterProjectId) return false;
    if (filterAttention && !card.needsAttention) return false;
    return true;
  }), [cards, filterProjectId, filterAttention]);
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
  const inbox = cards.filter((card) => card.needsAttention && card.status !== "archived");

  async function start(request: NewThreadRequest) {
    const targetProjectId = request.projectId || activeProjectId;
    if (!targetProjectId) return;
    const textPart = request.input.find((part) => part.type === "text");
    const text = textPart && "text" in textPart ? (textPart as { text: string }).text.trim() : "";
    const attachments = request.input
      .filter((part): part is { type: "localFile" | "localImage"; path: string } => (part.type === "localFile" || part.type === "localImage") && "path" in part && typeof part.path === "string" && part.path.length > 0)
      .map((part) => ({ type: part.type, path: part.path }));
    if (!text.trim()) return;
    if (!stage) {
      toast.error("Pick a stage first.");
      setStageAttention((count) => count + 1);
      // Throw so the composer keeps the draft: a blocked submit must never
      // lose what the user typed (SDK clears the draft only on resolve).
      throw new Error("Pick a stage first.");
    }
    setCreateError(null);
    try {
      const result = await rpc.call("createExploreCard", { projectId: targetProjectId, environment: request.environment, prompt: text, attachments, stageId: stage, start: startImmediately, execution: composerExecutionOf(request) });
      setPrompt("");
      setCreateOpen(false);
      navigate.openThreadPanel({ actionId: "stelow-card-detail", title: result.cardId, params: { cardId: result.cardId } });
      toast.success(startImmediately ? "Exploration started. The result will appear on this card when ready." : "Exploration parked in Inbox. Start it from the card when ready.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start exploration.";
      setCreateError(message);
      toast.error(message);
      throw error;
    }
  }

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

          <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (open) { setStage(null); setStartImmediately(true); setCreateError(null); } }}>
            <DialogContent fullscreenOnMobile className="overflow-y-auto sm:max-h-[calc(100dvh-1rem)] sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle>Start new exploration</DialogTitle>
                  <DialogDescription>Pick one technique below, then describe the input — an idea, an existing proposal, a codebase, or a URL. The agent runs that approach and returns a focused result.</DialogDescription>
              </DialogHeader>
              {createError ? <CreateCardAlert message={createError} /> : null}
              <div className="grid gap-4">
                <div className="grid gap-1.5">
                  <span className="text-xs font-medium text-foreground">Choose a technique</span>
                  <StrategyPicker strategies={stages} value={stage} onChange={setStage} groupName="stage-pick" attentionSignal={stageAttention} noun="techniques" legend="Technique" />
                </div>
                <AgentConfigBox
                  lines={[`Explore runs on ${effectiveExplorePreset?.name ?? "Default"}${exploreBandPreset ? "" : " (board default)"}`]}
                  onConfigure={() => setResearchPresetsOpen(true)}
                />
                <StartImmediatelyCheck checked={startImmediately} onChange={setStartImmediately} />
                <NewThreadComposer
                  defaultProjectId={activeProjectId ?? undefined}
                  defaultProviderId={effectiveExplorePreset?.providerId}
                  defaultModel={effectiveExplorePreset?.modelId}
                  defaultReasoningLevel={effectiveExplorePreset?.reasoningLevel as NewThreadRequest["reasoningLevel"] | undefined}
                  defaultPermissionMode={effectiveExplorePreset?.permissionMode as NewThreadRequest["permissionMode"] | undefined}
                  initialPrompt={prompt}
                  placeholder="What should Stelow explore?"
                  layout="contained"
                  draftKey="stelow-explore-create"
                  onSubmit={(request) => start(request)}
                />
              </div>
            </DialogContent>
          </Dialog>

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
                filterProjectId={filterProjectId}
                filterAttention={filterAttention}
                onProject={setFilterProjectId}
                onAttention={setFilterAttention}
                onReset={() => { setFilterProjectId("all"); setFilterAttention(false); }}
              />
            </div>
            <ViewToggle view={viewMode} onChange={setViewMode} label="Explore cards view" />
          </div>
          {viewMode === "board" ? (
          <p className="text-xs text-muted-foreground">
            <span className="sm:hidden">Swipe sideways to view every stage.</span>
            <span className="hidden sm:inline">Use Shift + scroll to move across stages.</span>
          </p>
          ) : null}
          {viewMode === "list" ? <ExploreList groups={grouped} navigate={navigate} stageLabelById={stageLabelById} collapsed={collapsedListGroups} onToggle={(column) => setCollapsedListGroups((current) => ({ ...current, [column]: !current[column] }))} /> : (
          <div data-testid="kanban-board" className="grid justify-start gap-3 overflow-x-auto md:h-[clamp(20rem,calc(100dvh-17rem),48rem)] md:overflow-y-hidden" style={{ gridTemplateColumns: kanbanGridColumns(RESEARCH_COLUMNS, collapsedColumns) }}>
            {RESEARCH_COLUMNS.map((column) => (
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
} as const;

// Collapsible list-view groups with archived collapsed by default. Stored
// choices win over the default (spread after), matching the kanban column
// behavior; unknown keys are inert.
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
      ? `Up to date${shortRef(update.installed, update.installedDisplay) ? ` (${shortRef(update.installed, update.installedDisplay)})` : ""}`
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

// Persistent submit-failure alert for the create dialogs. A toast alone
// fades; this stays until the next submit or reopen, and the throw that
// preserves the composer draft (the SDK clears it only on resolve) keeps
// the dialog open so the cause can be fixed and retried in place.
function CreateCardAlert({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-5">
      <span aria-hidden className="text-amber-600 dark:text-amber-400">⚠</span>
      <div>
        <p className="font-medium text-foreground">Couldn’t start this card</p>
        <p className="text-muted-foreground">{message} Nothing was lost — fix it above and submit again.</p>
      </div>
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
            <section className="space-y-2">
              <h2 className="text-base font-semibold text-foreground">
                bb-plugin-stelow {buildInfo ? <span className="text-[11px] font-normal text-muted-foreground" title={buildInfo.builtAt ? `Built ${new Date(buildInfo.builtAt).toLocaleString()}` : "Running build"}>v{buildInfo.version}</span> : null}
              </h2>
              {buildInfo ? (
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
              ) : null}
              <p className="text-sm leading-6 text-muted-foreground">This plugin hosts Stelow inside bb: Build, Research, and Explore boards, a quiet inbox that only interrupts when the agent needs you, and a worker CLI with deterministic artifact checks.</p>
              {buildInfo ? (
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p className="flex items-center gap-1.5">
                    <span aria-hidden className="text-emerald-500">●</span>
                    <button type="button" onClick={() => setSkillsOpen(true)} className="cursor-pointer underline decoration-dotted underline-offset-2 hover:text-foreground" title={`Pinned to Stelow ${buildInfo.stelowVersion ?? "at this plugin release"} — click to see which skills shipped`}>
                      {buildInfo.skills.length} skills · pinned to Stelow {buildInfo.stelowVersion ?? "this release"}
                    </button>
                  </p>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
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
              {pluginUpdateError ? <p className="text-xs text-destructive" role="alert">{pluginUpdateError}</p> : null}
              {pluginUpdateNotice ? <p className="text-xs text-primary" role="status">{pluginUpdateNotice}</p> : null}
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

// Choice cards for planning depth + human review gates: every option visible
// with its description, real radio inputs (keyboard + screen-reader native),
// min-h-11 touch targets. Replaces a cramped native select whose gray micro
// copy failed lay users and low vision — same option values, new surface.
// labelHidden lets a collapsible wrapper own the visible heading so the
// legend is never announced twice.
function ChoiceCards<T extends string>({ label, hint, value, options, onChange, groupName, labelHidden = false }: { label: string; hint?: string; value: T; options: readonly { value: T; label: string; description: string }[]; onChange: (value: T) => void; groupName: string; labelHidden?: boolean }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      {labelHidden ? null : <legend className="text-sm font-medium text-foreground">{label}</legend>}
      {hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
      <div className="grid gap-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label key={option.value} className={`flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md border p-2.5 transition focus-within:outline focus-within:outline-2 focus-within:outline-primary ${selected ? "border-primary bg-primary/5" : "hover:border-primary/50"}`}>
              <input type="radio" name={groupName} value={option.value} checked={selected} onChange={() => onChange(option.value)} className="mt-0.5 size-4 shrink-0 accent-primary" />
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-5 text-foreground">{option.label}</span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{option.description}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

// A named visual boundary for configuration controls. It can wrap any
// settings content, so disclosures do not leave their revealed controls
// looking detached from the heading that opened them.
function SettingsSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-md border bg-muted/20 p-3">
      <div className="mb-3">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}

// One preference category as a compact summary row: the title and the
// current value are always visible (so the setting is discoverable without
// scrolling), and one tap reveals the full ChoiceCards. Showing all nine
// radio cards at once pushed Pause for my review below the fold and read
// as a wall of text; a native select would hide the options again. This
// keeps both virtues: compact like a select, explicit like radio cards,
// reusing the same ChoiceCards instead of a second option renderer.
function CollapsibleChoiceCards<T extends string>({ label, hint, value, options, onChange, groupName }: { label: string; hint?: string; value: T; options: readonly { value: T; label: string; description: string }[]; onChange: (value: T) => void; groupName: string }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];
  return (
    <div className="group rounded-md border bg-background/60">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={`${label}: ${selected ? selected.label : "not set"}. ${open ? "Collapse" : "Change"}`}
        className="flex min-h-11 w-full cursor-pointer items-center gap-2 px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        <DisclosureChevron open={open} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium leading-5 text-foreground">{label}</span>
          {selected ? <span className="block truncate text-xs leading-5 text-muted-foreground" title={selected.description}>{selected.label} — {selected.description}</span> : null}
        </span>
        <span className="shrink-0 text-xs font-medium text-primary">{open ? "Less" : "Change"}</span>
      </button>
      {open ? (
        <div className="border-t px-3 pb-3 pt-2">
          <ChoiceCards label={label} labelHidden hint={hint} value={value} options={options} onChange={onChange} groupName={groupName} />
        </div>
      ) : null}
    </div>
  );
}

function WorkflowSettings({ appetite, reviewGates, onAppetiteChange, onReviewGatesChange, groupNamePrefix }: {
  appetite: Appetite;
  reviewGates: ReviewGates;
  onAppetiteChange: (value: Appetite) => void;
  onReviewGatesChange: (value: ReviewGates) => void;
  groupNamePrefix: string;
}) {
  return (
    <SettingsSection title="Workflow preferences" description="Planning depth sets how much the agent plans before building; review checkpoints are where it stops and waits for your decision. These are the board defaults — kept for every new card until you change them.">
      <CollapsibleChoiceCards label="Planning depth" hint="Deeper planning takes longer up front but means fewer surprises during execution." value={appetite} options={APPETITE_OPTIONS} onChange={onAppetiteChange} groupName={`${groupNamePrefix}-appetite`} />
      <ReviewGatePicker label="Pause for my review" hint="The agent stops at each checkpoint you pick and waits — nothing advances until you answer. Nothing picked means Auto: the agent decides everything itself." value={reviewGates} onChange={onReviewGatesChange} groupName={`${groupNamePrefix}-review`} />
    </SettingsSection>
  );
}

// Review checkpoints as a pure multi-select: real checkboxes (keyboard +
// screen-reader native), Select all / Clear, and one-click preset
// templates that write into the same state. Empty ≡ Auto.
function ReviewGatePicker({ label, hint, value, onChange, groupName }: { label: string; hint?: string; value: ReviewGates; onChange: (value: ReviewGates) => void; groupName: string }) {
  const [open, setOpen] = useState(false);
  const summary = reviewGatesSummary(value);
  function toggle(atom: ReviewGate) {
    onChange(value.includes(atom) ? value.filter((entry) => entry !== atom) : [...value, atom].sort((a, b) => REVIEW_GATE_VALUES.indexOf(a) - REVIEW_GATE_VALUES.indexOf(b)));
  }
  return (
    <div className="group rounded-md border bg-background/60">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={`${label}: ${summary}. ${open ? "Collapse" : "Change"}`}
        className="flex min-h-11 w-full cursor-pointer items-center gap-2 px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        <DisclosureChevron open={open} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium leading-5 text-foreground">{label}</span>
          <span className="block truncate text-xs leading-5 text-muted-foreground" title={summary}>{summary}</span>
        </span>
        <span className="shrink-0 text-xs font-medium text-primary">{open ? "Less" : "Change"}</span>
      </button>
      {open ? (
        <div className="grid gap-2 border-t px-3 pb-3 pt-2">
          <fieldset className="flex min-w-0 flex-col gap-1.5">
            <legend className="sr-only">{label}</legend>
            {hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
            <div className="flex gap-2">
              <button type="button" onClick={() => onChange([...REVIEW_GATE_VALUES])} className="min-h-11 cursor-pointer rounded-md border px-3 text-xs font-medium hover:bg-muted">Select all</button>
              <button type="button" onClick={() => onChange([])} className="min-h-11 cursor-pointer rounded-md border px-3 text-xs font-medium hover:bg-muted">Clear</button>
            </div>
            <div className="grid gap-2">
              {REVIEW_GATE_OPTIONS.map((option) => {
                const selected = value.includes(option.value);
                return (
                  <label key={option.value} className={`flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md border p-2.5 transition focus-within:outline focus-within:outline-2 focus-within:outline-primary ${selected ? "border-primary bg-primary/5" : "hover:border-primary/50"}`}>
                    <input type="checkbox" name={groupName} value={option.value} checked={selected} onChange={() => toggle(option.value)} className="mt-0.5 size-4 shrink-0 accent-primary" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium leading-5 text-foreground">{option.label}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{option.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">Start from a template:</p>
            <div className="flex flex-wrap gap-1.5">
              {REVIEW_GATE_PRESETS.map((preset) => (
                <button key={preset.label} type="button" onClick={() => onChange([...preset.gates])} title={preset.gates.length === 0 ? "Auto" : preset.gates.join(", ")} className="min-h-11 cursor-pointer rounded-md border px-2.5 text-xs font-medium hover:bg-muted">{preset.label}</button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Visual strategy picker shared by the creation modal and the follow-up
// round dialog: search field over emoji radio-cards, single select, no
// preselected default. RunIds (follow-up) only badge already-run rows.
function StrategyPicker({ strategies, value, onChange, runIds = [], groupName, disabled = false, attentionSignal = 0, noun = "strategies", legend = "Research strategy" }: {
  strategies: ResearchStrategyOption[];
  value: string | null;
  onChange: (id: string) => void;
  runIds?: string[];
  groupName: string;
  disabled?: boolean;
  // Increment to draw attention to the picker (focus search + transient
  // ring). Used when submit is blocked for want of a selection.
  attentionSignal?: number;
  noun?: string;
  legend?: string;
}) {
  const [query, setQuery] = useState("");
  const [flash, setFlash] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  // Compact (mobile): the list keeps its ~4-row cap with inner scroll on
  // every viewport — capped over expanded, per explicit preference.
  // Autofocus is desktop-only so the keyboard doesn't cover the list on open.
  const compact = useIsCompactViewport();
  useEffect(() => {
    if (attentionSignal === 0) return;
    searchRef.current?.focus();
    setFlash(true);
    const timer = window.setTimeout(() => setFlash(false), 1800);
    return () => window.clearTimeout(timer);
  }, [attentionSignal]);
  const needle = query.trim().toLowerCase();
  const visible = needle.length === 0
    ? strategies
    : strategies.filter((entry) => [entry.id, entry.label, entry.blurb, ...entry.keywords].join(" ").toLowerCase().includes(needle));
  function focusSearch() {
    searchRef.current?.focus();
  }
  return (
    <div
      className="grid gap-2"
      onKeyDown={(event) => {
        const target = event.target as HTMLElement | null;
        if (event.key === "/" && target && !/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) {
          event.preventDefault();
          focusSearch();
        }
      }}
    >
      <div className="relative">
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${noun}…`}
          autoFocus={!compact}
          disabled={disabled}
          aria-label={`Search ${noun}`}
          className="h-11 w-full rounded-md border bg-background pr-9 pl-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        />
        {query.length > 0 ? (
          <button onClick={() => { setQuery(""); focusSearch(); }} aria-label="Clear search" className="cursor-pointer absolute top-1/2 right-1 flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">×</button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {strategies.length === 0
          ? `Loading ${noun}…`
          : needle.length > 0
            ? `${visible.length} of ${strategies.length} ${noun}`
            : `${strategies.length} ${noun}`}
      </p>
      {visible.length === 0 && strategies.length > 0 ? (
        <div className="rounded-md border border-dashed p-4 text-center">
          <p className="text-sm text-muted-foreground">No {noun} match “{query.trim()}”.</p>
          <button onClick={() => { setQuery(""); focusSearch(); }} className="cursor-pointer mt-2 min-h-11 rounded-md border px-3 text-sm font-medium hover:bg-muted">Clear search</button>
        </div>
      ) : (
        <div className={`relative max-h-72 min-w-0 overflow-y-auto overscroll-contain p-1 ${flash ? "rounded-md ring-2 ring-destructive/60" : ""}`}>
          <fieldset className="grid gap-2">
          <legend className="sr-only">{legend}</legend>
          {visible.map((entry) => {
            const selected = value === entry.id;
            const ran = runIds.includes(entry.id);
            return (
              <label
                key={entry.id}
                className={`flex min-w-0 items-start gap-2.5 rounded-md border p-3 focus-within:outline focus-within:outline-2 focus-within:outline-primary ${disabled ? "opacity-60" : "cursor-pointer"} ${selected ? "border-primary bg-primary/5" : disabled ? "" : "hover:bg-muted/50"}`}
              >
                <input
                  type="radio"
                  name={groupName}
                  checked={selected}
                  onChange={() => onChange(entry.id)}
                  disabled={disabled}
                  className="sr-only"
                  aria-label={`${entry.label}${ran ? " (already ran)" : ""}`}
                />
                <span aria-hidden className="text-xl leading-none">{entry.emoji}</span>
                <span className="min-w-0 flex-1">
                  <span className={`flex flex-wrap items-center gap-2 text-sm ${selected ? "font-semibold text-foreground" : "font-medium text-foreground"}`}>
                    {entry.label}
                    {ran ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">already ran — runs again</span> : null}
                    {selected ? <span aria-hidden className="text-primary">✓</span> : null}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground" title={entry.blurb}>{entry.blurb}</span>
                </span>
              </label>
            );
          })}
          </fieldset>
        </div>
      )}
    </div>
  );
}

// Agent configuration as its own block (not inline muted text): which
// agent runs, with a Configure entry point. Shared by the Build settings
// and the research creation dialog so it reads as one configuration.
function AgentConfigBox({ lines, onConfigure }: { lines: string[]; onConfigure: () => void }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground">Agent configuration</span>
        <Button size="sm" variant="outline" className="shrink-0" onClick={onConfigure}>Configure presets</Button>
      </div>
      <ul className="mt-0.5 space-y-0.5">
        {lines.map((line) => (
          <li key={line} className="text-xs text-muted-foreground">{line}</li>
        ))}
      </ul>
    </div>
  );
}

// Deferred start for lightweight creation dialogs: unchecked parks the
// card in Inbox with no worker. One component, every creation dialog.
function ProjectPill({ value, onChange, projects }: { value: string | null; onChange: (v: string | null) => void; projects: Project[] }) {
  const selected = projects.find((project) => project.id === value);
  return (
    <select
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value || null)}
      aria-label="Project"
      className={`h-10 cursor-pointer rounded-md border px-3 text-sm ${selected ? "border-primary/40 bg-primary/5 text-foreground" : "border-border bg-background text-muted-foreground"}`}
    >
      <option value="">Choose a project</option>
      {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
    </select>
  );
}

// One filter bar for both boards (Archetype A: same components, same
// affordances). Project + attention are the shared facets; build adds
// stage/type/status/activity by passing their value + handler. Facets
// without a handler are not rendered — Research gets the identical popover,
// pills, and checkbox without a forked filter row.
function FiltersBar({ projects, filterProjectId, filterAttention, onProject, onAttention, onReset, stageOptions, filterStage, onStage, filterIntent, onIntent, filterStatus, onStatus, filterActivity, onActivity }: {
  projects: Project[];
  filterProjectId: string;
  filterAttention: boolean;
  onProject: (v: string) => void;
  onAttention: (v: boolean) => void;
  onReset: () => void;
  stageOptions?: string[];
  filterStage?: string;
  onStage?: (v: string) => void;
  filterIntent?: string;
  onIntent?: (v: string) => void;
  filterStatus?: string;
  onStatus?: (v: string) => void;
  filterActivity?: string;
  onActivity?: (v: string) => void;
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
  const projectOptions = useMemo(() => [{ value: "all", label: "All projects" }, ...projects.map((project) => ({ value: project.id, label: project.name }))], [projects]);
  const stageOptionsList = useMemo(() => [{ value: "all", label: "Any stage" }, ...(stageOptions ?? []).map((stage) => ({ value: stage, label: stage }))], [stageOptions]);
  const activeCount = (filterProjectId !== "all" ? 1 : 0) + (filterAttention ? 1 : 0)
    + (onStage && filterStage !== undefined && filterStage !== "all" ? 1 : 0)
    + (onIntent && filterIntent !== undefined && filterIntent !== "all" ? 1 : 0)
    + (onStatus && filterStatus !== undefined && filterStatus !== "all" ? 1 : 0)
    + (onActivity && filterActivity !== undefined && filterActivity !== "all" ? 1 : 0);
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
      {filterAttention ? <button onClick={() => onAttention(!filterAttention)} className="cursor-pointer inline-flex h-7 items-center gap-1.5 rounded-full border border-amber-500 bg-amber-500/15 px-3 text-xs font-medium text-amber-700 dark:text-amber-300" aria-label="Remove attention filter" aria-pressed="true">
        <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
        Needs attention
        <span aria-hidden className="ml-1">×</span>
      </button> : null}
      {activeCount > 0 ? <button onClick={onReset} className="cursor-pointer inline-flex h-7 items-center rounded-full border bg-background px-3 text-xs text-muted-foreground hover:text-foreground">Clear</button> : null}
      {open ? (
        <div role="dialog" aria-label="Filters" className="absolute left-0 top-10 z-20 w-[min(36rem,calc(100vw-2rem))] rounded-md border bg-card p-3 shadow-lg">
          <div className="grid gap-3 sm:grid-cols-2">
            <FilterSelect label="Project" value={filterProjectId} onChange={onProject} options={projectOptions} />
            {onIntent ? <FilterSelect label="Type" value={filterIntent ?? "all"} onChange={onIntent} options={FILTER_INTENT_OPTIONS} /> : null}
            {onStatus ? <FilterSelect label="Status" value={filterStatus ?? "all"} onChange={onStatus} options={FILTER_STATUS_OPTIONS} /> : null}
            {onStage ? <FilterSelect label="Stage" value={filterStage ?? "all"} onChange={onStage} options={stageOptionsList} /> : null}
            {onActivity ? <FilterSelect label="Activity" value={filterActivity ?? "all"} onChange={onActivity} options={FILTER_ACTIVITY_OPTIONS} /> : null}
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

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  const isAll = value === "all";
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className={`cursor-pointer rounded-md border px-2 py-1 text-sm ${isAll ? "border-border bg-background text-muted-foreground" : "border-primary bg-primary/10 text-foreground"}`}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

// Quiet view switcher shared by both boards. Icon-only and chromeless on
// purpose: changing how the cards below render is a view preference, not an
// action — so it lives beside the filters, never in the CTA row, and never
// looks like a primary button.
function ViewToggle({ view, onChange, label }: { view: "board" | "list"; onChange: (view: "board" | "list") => void; label: string }) {
  const options = [
    { value: "board" as const, title: "Board view", icon: "GridView" as const },
    { value: "list" as const, title: "List view", icon: "ListView" as const },
  ];
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

function BuildList({ groups, navigate, collapsed, onToggle }: { groups: Record<string, CardItem[]>; navigate: ReturnType<typeof useBbNavigate>; collapsed: Record<string, boolean>; onToggle: (column: string) => void }) {
  return <div className="space-y-5">{COLUMNS.map((column) => {
    const cards = groups[column] ?? [];
    if (!cards.length) return null;
    const isCollapsed = collapsed[column] === true;
    const label = COLUMN_LABELS[column] ?? column;
    return <section key={column} className="space-y-2"><div className="flex items-center gap-2"><button type="button" onClick={() => onToggle(column)} aria-expanded={!isCollapsed} aria-label={isCollapsed ? `Expand ${label}` : `Collapse ${label}`} title={isCollapsed ? `Expand ${label}` : `Collapse ${label}`} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-sm font-semibold hover:bg-foreground/5 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><DisclosureChevron open={!isCollapsed} className="text-foreground/60" />{label}</button><span className="text-xs text-muted-foreground">{cards.length}</span></div>{!isCollapsed ? <div className="overflow-hidden rounded-md border">{cards.map((card) => <TrackListRow key={card.id} card={card} meta={`${card.status === "completed" ? "Completed" : stageLabel(card.stage)}${card.scopeSummary.scopesTotal > 0 ? ` · ✓ ${card.scopeSummary.scopesDone}/${card.scopeSummary.scopesTotal} scopes · ${card.scopeSummary.tasksDone}/${card.scopeSummary.tasksTotal} tasks` : ""}`} onOpen={() => goToCard(navigate, card, card.id)} />)}</div> : null}</section>;
  })}</div>;
}

// One list row for all three tracks (convention over configuration):
// Build's row geometry is the standard; per-track context rides the meta
// line (stage + scopes, strategy, technique). Kanban tiles stay rich;
// list rows stay dense and keyboard-native.
function TrackListRow({ card, meta, onOpen }: {
  card: CardItem;
  meta: string | null;
  onOpen: () => void;
}) {
  const navigate = useBbNavigate();
  const returnFocusRef = useReturnFocus<HTMLButtonElement>(card.id);
  return <button ref={returnFocusRef} onClick={onOpen} onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === "w" || event.key === "W") { event.preventDefault(); if (card.workerThreadId) navigate.toThread(card.workerThreadId); } }} title={card.workerThreadId ? "Open card · W opens the worker thread" : "Open card"} aria-label={`Open card ${card.displayName}.`} className="cursor-pointer flex min-h-11 w-full flex-col items-stretch gap-1.5 border-b p-3 text-left last:border-b-0 hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:flex-row sm:items-center sm:gap-3"><span className="flex min-w-0 flex-1 items-start gap-2"><span className={`mt-1 size-2 shrink-0 rounded-full ${card.needsAttention ? "bg-amber-500" : pendingReview(card) ? "bg-emerald-500" : card.activity === "running" ? "bg-primary" : "bg-muted-foreground/40"}`} /><span className="min-w-0 flex-1"><strong className="block break-words text-sm leading-5">{card.displayName}</strong><span className="mt-0.5 block break-words text-xs leading-5 text-muted-foreground">{card.projectName}{meta ? ` · ${meta}` : ""}</span></span></span><span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><ActivityPill activity={card.activity} />{card.needsAttention ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-300">{attentionLabel(card)}</span> : null}{pendingReview(card) ? <ReviewChip /> : null}<span className="whitespace-nowrap">{new Date(card.updatedAt).toLocaleString()}</span></span></button>;
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
// Every "open the worker thread" affordance: one definition with the
// inspect-title everywhere (it is always an inspection). Renders nothing
// without a thread instead of a dead button that swallows clicks.
function OpenThreadButton({ threadId }: { threadId: string | null | undefined }) {
  const navigate = useBbNavigate();
  if (!threadId) return null;
  return <Button size="sm" variant="outline" onClick={() => navigate.toThread(threadId)} title="Open the worker thread to inspect what happened.">Open thread ↗</Button>;
}

// A decision hero wins over the error hero by design — the open question is
// the recovery path — so a concurrent failure must be named inside it.
// Otherwise the Failed chip reads as unexplained next to an actionable
// question. Shared by all three track detail bodies.
function HeroErrorNote({ card }: { card: Pick<CardItem, "activity" | "lastError"> }) {
  if (card.activity !== "error" || !card.lastError) return null;
  return (
    <p className="w-full rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs leading-5 text-destructive" title={card.lastError}>
      <span className="font-semibold">Last worker error:</span> {card.lastError} Answering below resumes the worker.
    </p>
  );
}

// Tiles signal; the open card explains. A failure's full text and its
// retry live in the detail hero — never on the tile — so board columns stay
// scannable. The Failed chip keeps the reason one hover away via title.
function CardMetaRows({ card }: { card: CardItem }) {
  const attention = card.needsAttention;
  return (
    <>
      {attention && card.activity !== "error" && card.activity !== "awaiting-answer" ? (
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
          <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
          <span>{attentionLabel(card)}</span>
        </div>
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

// Activity is transient and is communicated by the surface itself. Keeping
// this mapping here lets every card shape use the exact same live language.
function liveBorderClass(card: Pick<CardItem, "activity" | "needsAttention">): string {
  if (card.activity === "running") return "stelow-border-running";
  if (card.activity === "awaiting-answer" || card.needsAttention) return "stelow-border-attention";
  return "";
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

function BoardCard({ card }: { card: CardItem }) {
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
      aria-label={`Open card ${card.displayName}.`}
    >
      <CardHeading title={card.displayName}
        action={stuck && card.activity !== "error" ? <CardRetryButton cardId={card.id} label="Resume work" /> : null}
        status={<BuildStatusPills {...buildStatusPillProps(card)} />}
      />
      {card.scopeSummary.scopesTotal > 0 ? <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        {card.scopeSummary.scopesTotal > 0 ? <span className="whitespace-nowrap text-muted-foreground" title={`${card.scopeSummary.scopesDone} of ${card.scopeSummary.scopesTotal} scopes done · ${card.scopeSummary.tasksDone} of ${card.scopeSummary.tasksTotal} tasks done`}>✓ {card.scopeSummary.scopesDone}/{card.scopeSummary.scopesTotal} scopes · {card.scopeSummary.tasksDone}/{card.scopeSummary.tasksTotal} tasks</span> : null}
      </div> : null}
      <CardMetaRows card={card} />
    </div>
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
  return <div className="space-y-5">{RESEARCH_COLUMNS.map((column) => {
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
type WorkspaceFileTarget = { kind: "workspace"; environmentId: string; path: string };
type HostFileTarget = { kind: "host"; hostId: string; path: string };

// Workspace-kind links open in bb's official file viewer (with comments).
// Host-kind links cannot resolve exploratory paths, which live outside
// provisioned environments — so exploratory cards use the worker thread's
// environment + worktree-relative path, everything else keeps host links.
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

function fileLinkTarget(useWorkspace: boolean, environmentId: string | null, relPath: string | null, hostId: string, absolutePath: string): WorkspaceFileTarget | HostFileTarget {
  if (useWorkspace && environmentId && relPath) return { kind: "workspace", environmentId, path: relPath };
  return { kind: "host", hostId, path: absolutePath };
}

// Open an ask-option artifact in the card viewer. Same target convention
// as every other artifact button: workspace target for exploratory cards,
// host target otherwise.
function openAskArtifact(
  card: Pick<CardItem, "workspaceKind">,
  fileEnvironmentId: string | null,
  setViewerFile: (file: { display: string; path: string; target: WorkspaceFileTarget | HostFileTarget | null; mode?: ArtifactViewerMode } | null) => void,
  artifact: AskArtifact,
  mode: ArtifactViewerMode,
): void {
  setViewerFile({
    display: artifact.display,
    path: artifact.absolutePath ?? artifact.path,
    target: fileLinkTarget(card.workspaceKind === "exploratory", fileEnvironmentId, artifact.path, artifact.hostId ?? "", artifact.absolutePath ?? artifact.path),
    mode,
  });
}

function StageTimeline({ currentStage, nextStages, artifacts, onPick, skips, offRouteReason, terminal }: { currentStage: string; nextStages: string[]; artifacts: Array<{ stage: string }>; onPick: (stage: string) => void; skips: { offRoute: string[]; skipped: Array<{ stage: string; reason: string }> }; offRouteReason: string | null; terminal?: "completed" | "archived" }) {
  const curIdx = STAGE_SEQUENCE.indexOf(currentStage);
  // A finished card has no current stage: park the cursor past the end so
  // every reached stage reads as passed and nothing stays lit (or pulsing)
  // as if work were still there. Earlier completed stages remain revisit-able;
  // the terminal checkpoint and every archived stage are intentionally inert.
  const current = terminal ? STAGE_SEQUENCE.length : curIdx >= 0 ? curIdx : 0;
  const legal = new Set(nextStages.filter((stage) => stage && !stage.includes("(")));
  const offRoute = new Set(skips.offRoute);
  const skipReasonByStage = new Map(skips.skipped.map((entry) => [entry.stage, entry.reason]));
  // group consecutive STAGE_SEQUENCE entries by STAGE_BAND
  const bands = new Map<string, string[]>();
  for (const stage of STAGE_SEQUENCE) {
    const band = STAGE_BAND[stage] ?? "other";
    if (!bands.has(band)) bands.set(band, []);
    bands.get(band)!.push(stage);
  }
  return (
    <div className="space-y-3">
      {Array.from(bands.entries()).map(([band, stages]) => {
        const bandActive = stages.some((stage) => stage === currentStage);
        const hasAnyPassed = stages.some((stage) => STAGE_SEQUENCE.indexOf(stage) < current);
        const hasAnyUpcoming = stages.some((stage) => STAGE_SEQUENCE.indexOf(stage) > current);
        return (
          <div key={band}>
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{BAND_LABEL[band] ?? band}</span>
              <span className={`h-px flex-1 ${bandActive ? "bg-primary/40" : hasAnyPassed ? "bg-emerald-500/30" : "bg-border"}`} />
            </div>
            <div className="flex gap-1 overflow-x-auto pb-0.5 md:flex-wrap md:overflow-visible">
              {stages.map((stage) => {
                const idx = STAGE_SEQUENCE.indexOf(stage);
                const isCurrent = !terminal && stage === currentStage;
                // A completed card retains its final stage as a completion
                // record. It is not an earlier stage to reopen from the UI.
                const isTerminalCheckpoint = terminal === "completed" && stage === currentStage;
                const isOffRoute = !isCurrent && offRoute.has(stage);
                const skipReason = !isCurrent ? skipReasonByStage.get(stage) ?? null : null;
                const passed = idx >= 0 && idx < current && !isOffRoute && !skipReason;
                const canAdvance = idx === current + 1 && legal.has(stage);
                const canRegress = terminal !== "archived" && passed && !isCurrent && !isTerminalCheckpoint;
                const clickable = canAdvance || canRegress;
                const produced = artifacts.filter((artifact) => artifact.stage === stage);
                const dimmedTitle = skipReason ?? (isOffRoute ? offRouteReason ?? "Not in this workflow's route" : [STAGE_PRODUCES[stage], STAGE_SKILL[stage] ? `Defined by ${STAGE_SKILL[stage]} — see the Workflow map below for the link.` : null].filter(Boolean).join(" "));
                return (
                  <span key={stage} className={`inline-flex shrink-0 items-center gap-1 ${isOffRoute ? "opacity-60" : ""}`}>
                    <button
                      type="button"
                      disabled={!clickable || isCurrent}
                      title={dimmedTitle}
                      onClick={() => onPick(stage)}
                      className={`disabled:cursor-not-allowed cursor-pointer relative inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                      isCurrent
                        ? CURRENT_STAGE_PILL_CLASS
                        : passed
                        ? "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
                        : skipReason ?? isOffRoute
                        ? "border border-dashed border-border text-muted-foreground/70 hover:border-primary/50 hover:text-foreground"
                        : canAdvance
                        ? "cursor-pointer border border-primary/40 text-primary hover:bg-primary/10"
                        : "cursor-pointer border border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                    }`}
                      >
                        {passed ? <span aria-hidden>✓</span> : isCurrent ? "●" : skipReason ? <span aria-hidden>⊘</span> : canAdvance ? "·" : "·"}
                        <span className={isOffRoute ? "line-through" : ""}>{stageLabel(stage)}</span>
                        {/* Count-only, never a control: files and navigation
                            keep one shape each, and the pill stays one
                            click target (advance/return). */}
                        {produced.length > 0 ? <span className="text-muted-foreground">· {produced.length} file{produced.length === 1 ? "" : "s"}</span> : null}
                        {canAdvance ? <span aria-hidden className="text-[9px]">→</span> : null}
                    </button>
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type ArtifactInventoryFile = { kind: string; path: string; display: string; generatedAt: string; absolutePath: string; hostId: string; note?: string | null };
type ArtifactInventoryGroup = { id: string; title: string; items: ArtifactInventoryFile[] };

// A document the workflow wrote but never registered still belongs on the
// audit trail — it just says so instead of claiming a stage it cannot prove.
function artifactGroupTitle(stage: string): string {
  return stage === "unregistered" ? "Produced but not registered" : stageLabel(stage);
}

function artifactFilename(path: string): string {
  const clean = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return clean.split("/").pop() || path;
}

function formatArtifactDate(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

// One visual inventory for every card type. Each track supplies its durable
// grouping axis (Build stage, Research round, Explore technique); rows always mean
// an actual file that opens in the viewer.
function ArtifactInventory({ groups, workspaceKind, fileEnvironmentId, onView }: {
  groups: ArtifactInventoryGroup[];
  workspaceKind: string;
  fileEnvironmentId: string | null;
  onView: (file: { display: string; path: string; target: WorkspaceFileTarget | HostFileTarget | null }) => void;
}) {
  if (groups.length === 0) return <p className="text-xs text-muted-foreground">No artifacts yet — they appear here as work completes.</p>;
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.id} className="space-y-1 rounded-md p-1">
          <div className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <p>{group.title}</p>
            <span className="shrink-0 normal-case tracking-normal">{group.items.length} artifact{group.items.length === 1 ? "" : "s"}</span>
          </div>
          <div className="divide-y divide-border rounded-md border">
            {group.items.map((file) => (
              <button
                key={file.path}
                onClick={() => onView({ display: file.display, path: file.absolutePath, target: fileLinkTarget(workspaceKind === "exploratory", fileEnvironmentId, file.path, file.hostId, file.absolutePath) })}
                className="flex min-h-11 w-full cursor-pointer items-start gap-2 px-2 py-2 text-left text-xs hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                title={`Open ${file.display} (${file.path})`}
              >
                <span className="mt-0.5" aria-hidden>📄</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">{file.display}</span>
                  <span className="block truncate text-muted-foreground">{[formatArtifactDate(file.generatedAt), `File: ${artifactFilename(file.path)}`].filter(Boolean).join(" · ")}</span>
                  {file.note ? <span className="mt-0.5 block text-muted-foreground">{file.note}</span> : null}
                </span>
                <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden>↗</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Build and Explore use stages as their canonical grouping axis. Keeping this
// adapter preserves the shared inventory while avoiding a second renderer.
function ArtifactGroups({ artifacts, workspaceKind, fileEnvironmentId, onView, groupTitleForStage }: {
  artifacts: Array<{ stage: string; kind: string; path: string; display: string; generatedAt: string; absolutePath: string; hostId: string }>;
  workspaceKind: string;
  fileEnvironmentId: string | null;
  onView: (file: { display: string; path: string; target: WorkspaceFileTarget | HostFileTarget | null }) => void;
  groupTitleForStage?: (stage: string) => string;
}) {
  const groups = useMemo<ArtifactInventoryGroup[]>(() => groupArtifactsByStage(artifacts).map((group) => ({
    id: group.stage,
    title: groupTitleForStage?.(group.stage) ?? stageLabel(group.stage),
    items: group.items,
  })), [artifacts, groupTitleForStage]);
  return <ArtifactInventory groups={groups} workspaceKind={workspaceKind} fileEnvironmentId={fileEnvironmentId} onView={onView} />;
}

// A completed Build card carries two receipts whose names differ by one word,
// so only their freshness tells them apart — and only Stelow can say that.
// This asks the helper on demand (never on every board read: `check` re-derives
// the projection and samples the worktree) and re-asks on the button, so a card
// whose tree moved after completion says so instead of reading as verified
// forever.
type AuditTrailStatus = {
  state: "verified" | "changed" | "missing" | "refused" | "unsupported" | "unavailable";
  detail: string | null; head: string | null; path: string | null; contract: string | null;
  recon: { state: "recorded" | "missing" | "invalid"; detail: string } | null;
};

const AUDIT_TRAIL_COPY: Record<AuditTrailStatus["state"], { label: string; tone: string; sub: string | null }> = {
  verified: { label: "Audit trail verified", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", sub: null },
  changed: { label: "Changed since completion", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300", sub: "The repository or the workflow documents moved after this card was audited, so its receipt no longer describes the current tree. Re-check after committing, or re-run the audit." },
  missing: { label: "No audit trail", tone: "bg-muted text-muted-foreground", sub: "This card has no portable Stelow receipt. Cards completed before the receipt existed read this way." },
  refused: { label: "Audit trail refused", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300", sub: null },
  unsupported: { label: "Audit trail unreadable", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300", sub: null },
  unavailable: { label: "Audit trail unavailable", tone: "bg-muted text-muted-foreground", sub: null },
};

function AuditTrailStatusRow({ cardId }: { cardId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [status, setStatus] = useState<AuditTrailStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const check = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await rpc.call("auditTrailStatus", { cardId }));
    } catch {
      setStatus({ state: "unavailable", detail: "The host could not read the audit trail.", head: null, path: null, contract: null, recon: null });
    } finally {
      setChecking(false);
    }
  }, [cardId, rpc]);
  useEffect(() => { void check(); }, [check]);
  if (!status) return <p className="text-xs text-muted-foreground">Checking the audit trail…</p>;
  const copy = AUDIT_TRAIL_COPY[status.state];
  const detail = copy.sub ?? (status.state === "verified" ? (status.head ? `Attests HEAD ${status.head.slice(0, 12)}.` : null) : status.detail);
  return (
    <div className="mb-3 rounded-md border p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`rounded-full px-2 py-0.5 font-medium ${copy.tone}`}>{copy.label}</span>
        <button
          type="button"
          onClick={() => void check()}
          disabled={checking}
          className="min-h-11 cursor-pointer rounded-md px-2 text-xs font-medium text-primary hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-default disabled:opacity-60"
        >
          {checking ? "Checking…" : "Re-check"}
        </button>
      </div>
      {detail ? <p className="mt-1 text-muted-foreground">{detail}</p> : null}
      {status.recon && status.recon.state !== "recorded" ? <p className="mt-1 text-amber-700 dark:text-amber-300">Recon warning: {status.recon.detail}</p> : null}
    </div>
  );
}

function InputFiles({ card, detail, onView }: { card: CardItem; detail: CardDetailResponse | null; onView: (file: { display: string; path: string; target: WorkspaceFileTarget | HostFileTarget | null }) => void }) {
  const files = detail?.attachments ?? [];
  if (files.length === 0) return null;
  return (
    <CardDisclosure title="Input files" hint={`${files.length} file${files.length === 1 ? "" : "s"}`} defaultOpen>
      <p className="text-xs text-muted-foreground">Files attached when this card was started.</p>
      <div className="mt-2 divide-y divide-border rounded-md border">
        {files.map((file) => {
          const canOpen = Boolean(file.hostId && file.absolutePath);
          const body = <>
            <span className="mt-0.5" aria-hidden>{file.type === "localImage" ? "🖼️" : "📎"}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-foreground">{file.display}</span>
              <span className="block truncate text-muted-foreground">File: {artifactFilename(file.path)}</span>
            </span>
            {canOpen ? <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden>↗</span> : null}
          </>;
          return canOpen ? (
            <button
              key={`${file.type}:${file.path}`}
              onClick={() => onView({ display: file.display, path: file.absolutePath, target: fileLinkTarget(card.workspaceKind === "exploratory", detail?.fileEnvironmentId ?? null, file.relPath ?? file.path, file.hostId!, file.absolutePath) })}
              className="flex min-h-11 w-full cursor-pointer items-start gap-2 px-2 py-2 text-left text-xs hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              title={`Open ${file.display}`}
            >
              {body}
            </button>
          ) : <div key={`${file.type}:${file.path}`} className="flex min-h-11 items-start gap-2 px-2 py-2 text-xs">{body}</div>;
        })}
      </div>
    </CardDisclosure>
  );
}

function CardDrawerAdapter(props: PluginThreadPanelProps) {
  const params = props.params;
  const cardId = typeof params === "object" && params && "cardId" in params && typeof params.cardId === "string" ? params.cardId : "";
  const navigate = useBbNavigate();
  if (!cardId) return <p className="p-4 text-sm text-muted-foreground">Pick a card from Stelow {trackTitle("build")} to see its details here.</p>;
  return <CardDetailBody cardId={cardId} inboxEventId={null} onClose={() => { /* host tab close */ }} navigate={navigate} />;
}

function CardActionsMenu({ card, onRestartFresh, onArchive, onDiscard, onDelete, onReclassify }: {
  card: CardItem;
  onRestartFresh: () => void;
  onArchive: () => void;
  onDiscard: () => void;
  onDelete: () => void;
  onReclassify: (intent: string) => Promise<boolean>;
}) {
  const actions = workerActionPolicy(card, card.needsAttention);
  const [open, setOpen] = useState(false);
  const [reclassifyOpen, setReclassifyOpen] = useState(false);
  const [nextIntent, setNextIntent] = useState(card.intent);
  const [reclassifying, setReclassifying] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", closeOnOutsidePress);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsidePress);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);
  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };
  const canReclassify = canReclassifyWorkflow(card);
  return (
    <>
      <div ref={rootRef} className="relative shrink-0">
        <Button
          ref={triggerRef}
          size="icon"
          variant="ghost"
          aria-label="Card actions"
          aria-expanded={open}
          aria-controls={`card-actions-${card.id}`}
          title="Card actions"
          onClick={() => setOpen((value) => !value)}
          className="min-h-11 min-w-11"
        >
          <Icon name="MoreHorizontal" className="h-4 w-4" aria-hidden />
        </Button>
        {open ? (
          <div id={`card-actions-${card.id}`} role="group" aria-label="Card actions" className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-md border bg-popover p-1 text-sm shadow-md">
            {canReclassify ? (
              <button type="button" onClick={() => choose(() => { setNextIntent(card.intent); setReclassifyOpen(true); })} className="flex min-h-11 w-full cursor-pointer items-center rounded-sm px-2 text-left hover:bg-state-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Reclassify workflow…</button>
            ) : null}
            {actions.showRestartFresh ? (
              <button type="button" onClick={() => choose(onRestartFresh)} className="flex min-h-11 w-full cursor-pointer items-center rounded-sm px-2 text-left hover:bg-state-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Restart fresh…</button>
            ) : null}
            {(canReclassify || actions.showRestartFresh) && (actions.showArchive || actions.showDiscard || actions.showDelete) ? <div className="my-1 border-t" /> : null}
            {actions.showArchive ? (
              <button type="button" onClick={() => choose(onArchive)} className="flex min-h-11 w-full cursor-pointer items-center rounded-sm px-2 text-left text-destructive hover:bg-destructive/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Archive card…</button>
            ) : null}
            {actions.showDiscard ? (
              <button type="button" onClick={() => choose(onDiscard)} className="flex min-h-11 w-full cursor-pointer items-center rounded-sm px-2 text-left text-destructive hover:bg-destructive/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Discard work…</button>
            ) : null}
            {actions.showDelete ? (
              <button type="button" onClick={() => choose(onDelete)} className="flex min-h-11 w-full cursor-pointer items-center rounded-sm px-2 text-left text-destructive hover:bg-destructive/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Delete permanently…</button>
            ) : null}
          </div>
        ) : null}
      </div>
      <Dialog open={reclassifyOpen} onOpenChange={setReclassifyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reclassify and restart from triage?</DialogTitle>
            <DialogDescription>
              This starts a fresh worker from triage on the selected workflow type. Existing comments and history stay as the record of the previous attempt; its route, pending stages, and plan are recalculated.
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Workflow type</span>
            <select value={nextIntent} onChange={(event) => setNextIntent(event.target.value)} className="h-10 rounded-md border bg-background px-2 text-sm">
              <option value="new-product">New product</option>
              <option value="feature">Feature</option>
              <option value="bugfix">Bug fix</option>
              <option value="refactor">Refactor</option>
              <option value="investigate">Investigate</option>
              <option value="unknown">Unknown intent</option>
            </select>
          </label>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" disabled={reclassifying}>Cancel</Button></DialogClose>
            <Button disabled={reclassifying || nextIntent === card.intent} onClick={() => {
              setReclassifying(true);
              void onReclassify(nextIntent).then((restarted) => { if (restarted) setReclassifyOpen(false); }).finally(() => setReclassifying(false));
            }}>{reclassifying ? "Restarting…" : "Reclassify & restart"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CardDetailHeader({ card, onBack, onRestartFresh, onArchive, onDiscard, onDelete, onReclassify }: {
  card: CardItem | null;
  onBack?: () => void;
  onRestartFresh: () => void;
  onArchive: () => void;
  onDiscard: () => void;
  onDelete: () => void;
  onReclassify: (intent: string) => Promise<boolean>;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!onBack) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);
  async function applyIntent(nextIntent: string) {
    if (!card) return;
    const result = await rpc.call("updateCardIntent", { cardId: card.id, intent: nextIntent as "new-product" | "feature" | "bugfix" | "refactor" | "investigate" | "unknown" });
    if (!result.ok) {
      toast.error(result.error ?? "Could not change intent.");
      return;
    }
    toast.success(`Workflow type changed to ${INTENT_LABEL[nextIntent] ?? nextIntent}`);
  }
  return (
    <header className="flex items-center gap-2 border-b bg-card/80 px-3 py-1.5">
      {onBack ? <button onClick={onBack} title="Back to board (Esc)" className="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-md bg-background px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
        <span aria-hidden>←</span>
        <span>Board</span>
      </button> : null}
      <nav className="min-w-0 flex-1 truncate text-xs text-muted-foreground" aria-label="Breadcrumb">
        <span>Stelow</span>
        <span aria-hidden className="mx-1 text-border">/</span>
        <span className="font-medium text-foreground">{card?.displayName ?? card?.name ?? "Loading…"}</span>
        {card ? <span className="ml-2 inline-flex flex-wrap items-center gap-1.5 align-middle"><BuildStatusPills {...buildStatusPillProps(card)} /></span> : null}
      </nav>
      {card ? <>
        {card.kind === "build" && canEditWorkflowIntent(card) ? (
        <select
          aria-label="Intent"
          title="Workflow type — correct it while this card is still in triage."
          value={card.intent}
          onChange={(event) => {
            const nextIntent = event.target.value;
            if (nextIntent === card.intent) return;
            void applyIntent(nextIntent);
          }}
          className="h-6 max-w-32 cursor-pointer truncate rounded-full border border-transparent bg-transparent text-xs font-medium text-muted-foreground hover:border-border hover:text-foreground"
        >
          <option value="new-product">New Product</option>
          <option value="feature">Feature</option>
          <option value="bugfix">Bugfix</option>
          <option value="refactor">Refactor</option>
          <option value="investigate">Investigate</option>
          <option value="unknown">Unknown intent</option>
        </select>
        ) : null}
        <CardActionsMenu card={card} onRestartFresh={onRestartFresh} onArchive={onArchive} onDiscard={onDiscard} onDelete={onDelete} onReclassify={onReclassify} />
      </> : null}
      {onBack ? <button ref={closeRef} onClick={onBack} title="Close (Esc)" aria-label="Close card details" className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md bg-background text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
        <Icon name="X" className="h-4 w-4" aria-hidden />
      </button> : null}
    </header>
  );
}


// Status rank for sorting work (tasks): active first, then committed, then
// blocked, then finished. Used to give a sensible vertical reading.
const STATUS_RANK: Record<string, number> = {
  "in-progress": 0,
  draft: 1,
  planning: 1,
  pending: 1,
  blocked: 2,
  failed: 2,
  skipped: 3,
  done: 4,
  completed: 4,
};
const statusRank = (s: string | undefined) => STATUS_RANK[s ?? ""] ?? 3;

// Topological order of scopes by dependency. A scope that depends on / is
// blocked by another comes AFTER its dependency, so reading top→bottom follows
// execution order. Ties keep the original (state.md) order — deterministic.
// Returns scopes in dependency-order plus a map of scope-id → ids it is
// waiting on (dependencies not yet finished).
function orderScopes(scopes: Extract<CardDetailResponse, { scopes: unknown }>["scopes"]): { ordered: typeof scopes; waitingOn: Map<string, string[]> } {
  const byId = new Map(scopes.map((s) => [s.id, s]));
  const done = new Set(scopes.filter((s) => ["done", "completed"].includes(s.status ?? "")).map((s) => s.id));
  // dependency ids: dependsOn must precede; blockedBy must precede
  const deps = (s: (typeof scopes)[number]) => [
    ...(s.dependsOn ?? []).filter((id) => byId.has(id)),
    ...(s.blockedBy ?? []).filter((id) => byId.has(id)),
  ];
  const ordered: typeof scopes = [];
  const placed = new Set<string>();
  const chain = new Set<string>();
  const waitingOn = new Map<string, string[]>();
  const visit = (s: (typeof scopes)[number]): void => {
    if (placed.has(s.id)) return;
    if (chain.has(s.id)) return; // cycle guard: keep original position
    chain.add(s.id);
    // visit each live dependency first (finished deps are fine in any order)
    for (const depId of deps(s)) {
      const dep = byId.get(depId);
      if (dep && !done.has(depId)) visit(dep); // still-pending deps push order
    }
    chain.delete(s.id);
    placed.add(s.id);
    ordered.push(s);
    const wait = deps(s).filter((id) => !done.has(id));
    if (wait.length) waitingOn.set(s.id, wait);
  };
  scopes.forEach(visit);
  return { ordered, waitingOn };
}

// Scope progress hero: one glanceable readout above the per-scope list.
// Presentation only — same scopes/tasks contract, no new data. Shows
// overall scope + task bars, what is actively doing now, and what waits.
function ScopeProgress({ scopes }: { scopes: Extract<CardDetailResponse, { scopes: unknown }>["scopes"] }) {
  const isDone = (status: string | undefined) => status === "done" || status === "completed";
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
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold">✓ {scopesDone}/{scopes.length} scopes</span>
        {bar(scopePct, "bg-emerald-500")}
        <span className="tabular-nums text-muted-foreground">{scopePct}%</span>
      </div>
      {tasksAll.length > 0 ? (
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold">✓ {tasksDone}/{tasksAll.length} tasks</span>
          {bar(taskPct, "bg-primary")}
          <span className="tabular-nums text-muted-foreground">{taskPct}%</span>
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

function ScopesList({ scopes }: { scopes: Extract<CardDetailResponse, { scopes: unknown }>["scopes"] }) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set(scopes.filter((scope) => scope.status === "in-progress").map((scope) => scope.id)));
  const { ordered, waitingOn } = orderScopes(scopes);
  const byId = new Map(scopes.map((s) => [s.id, s]));
  const finished = (id: string) => ["done", "completed"].includes(byId.get(id)?.status ?? "");
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Scopes ({scopes.length})</h3>
      {scopes.length > 1 ? <p className="text-[11px] text-muted-foreground">Ordered by dependency — ⛔ waits on unfinished work.</p> : null}
      {ordered.map((scope) => {
        const isOpen = openIds.has(scope.id);
        const wait = waitingOn.get(scope.id) ?? [];
        const blockedNow = wait.length > 0;
        const tasksSorted = [...scope.tasks].sort((a, b) => statusRank(a.status) - statusRank(b.status));
        const tasksDone = scope.tasks.filter((task) => statusRank(task.status) === 4).length;
        return (
          <details key={scope.id} open={isOpen} onToggle={(event) => { const next = new Set(openIds); if ((event.currentTarget as HTMLDetailsElement).open) next.add(scope.id); else next.delete(scope.id); setOpenIds(next); }} className={`group rounded-md border p-3 ${scope.status === "in-progress" ? "stelow-border-running" : blockedNow ? "border-amber-500/50" : "border-border"}`}>
            <summary className="cursor-pointer list-none space-y-1">
              <div className="flex flex-wrap items-center gap-1">
                <DisclosureChevron />
                <span className="font-mono text-xs text-muted-foreground">{scope.id}</span>
                <span className="font-medium">{scope.name}</span>
                {scope.type ? <Pill>{scope.type}</Pill> : null}
                {scope.source === "audit-gap" ? <Pill tone="bg-amber-500/15 text-amber-700 dark:text-amber-300" title={scope.gap ? `Rework for escalated gap: ${scope.gap}` : "Rework scope from an escalated gap"}>↻ rework</Pill> : null}
                <Pill tone={statusTone(scope.status)}><span className="mr-1">{statusGlyph(scope.status)}</span>{statusLabel(scope.status)}</Pill>
                {scope.tasks.length > 0 ? <span className="text-[11px] text-muted-foreground" title={`${tasksDone} of ${scope.tasks.length} tasks done`}>{tasksDone}/{scope.tasks.length} tasks</span> : null}
                {blockedNow ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300" title={wait.join(", ")}>⛔ waiting on {wait.length}</span> : null}
              </div>
              {(scope.blockedBy?.length || scope.dependsOn?.length) ? (
                <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                  {scope.dependsOn?.filter((id) => byId.has(id)).map((dep) => <span key={dep} className={`rounded-md border px-2 py-0.5 ${finished(dep) ? "border-border" : "border-amber-500/40 bg-amber-500/10"}`}>after {byId.get(dep)!.name}</span>)}
                  {scope.blockedBy?.filter((id) => byId.has(id)).map((dep) => <span key={dep} className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5">blocked by {byId.get(dep)!.name}</span>)}
                  {scope.dependsOn?.filter((id) => !byId.has(id)).map((dep) => <span key={dep} className="rounded-md border border-dashed px-2 py-0.5">after {dep} (missing)</span>)}
                </div>
              ) : null}
            </summary>
            <div className="mt-3 space-y-1 border-l pl-3">
              {tasksSorted.length === 0 ? <p className="text-xs text-muted-foreground">No tasks tracked.</p> : tasksSorted.map((task) => (
                <div key={task.id} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 font-mono">{statusGlyph(task.status)}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={statusRank(task.status) === 4 ? "line-through text-muted-foreground" : ""}>{task.name}</span>
                      <span className="text-xs text-muted-foreground">({statusLabel(task.status)})</span>
                      {task.source ? <Pill>{task.source}</Pill> : null}
                    </div>
                    {task.note ? <div className="text-xs text-muted-foreground">{task.note}</div> : null}
                    {(task.blockedBy?.length || task.dependsOn?.length) ? (
                      <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                        {task.dependsOn?.map((dep) => <span key={dep} className="rounded-md border border-dashed px-1.5 py-0.5">after {dep}</span>)}
                        {task.blockedBy?.map((dep) => <span key={dep} className="rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5">blocked by {dep}</span>)}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </details>
        );
      })}
    </section>
  );
}

type AskArtifact = { path: string; display: string; absolutePath: string | null; hostId: string | null };
type ArtifactViewerMode = "review" | "comment";
type QuestionStalenessNotice = { docRevised: boolean; docRemoved: boolean; checkoutMoved: boolean; commitCount: number; touchedPaths: string[] };
type BatchItem = { id: string; title: string; prompt: string; multiple: boolean; kind?: "standard" | "split"; options: Array<{ label: string; description: string; preview: string | null; artifact: AskArtifact | null }>; staleness?: QuestionStalenessNotice | null };

function artifactViewerModeForOption(label: string): ArtifactViewerMode {
  // An approval is a decision after reading, not a request to alter the
  // document. All other choices — especially Request/Review changes — keep
  // the full quote-and-comment path to communicate precise feedback.
  return /\b(approve|accept|proceed)\b/i.test(label) ? "review" : "comment";
}

// Per-option evidence: the document opens from inside the option row
// (right side), the inline glance expands below. The artifact opens in the
// viewer where a file opener exists (card), and degrades to a plain
// filename where it doesn't (thread) — never a dead button pretending
// to open, never one shared button after the options.
function OptionPreview({ preview }: { preview: string | null }) {
  if (!preview) return null;
  return (
    <div className="ml-1 space-y-1 border-l-2 border-muted pl-2">
      <details className="group">
        <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-xs font-medium text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><DisclosureChevron />Preview</summary>
        <pre className="whitespace-pre-wrap rounded-md border bg-background/60 p-2 font-mono text-[11px] leading-relaxed">{preview}</pre>
      </details>
    </div>
  );
}

// Advisory only: names what moved since a question was asked — a revised or
// removed document, a moved checkout with the touched paths — and points at
// the existing exits (re-open the doc, request changes, regress the stage).
// It never blocks answering and adds no new actions of its own.
function StalenessNotice({ staleness }: { staleness: QuestionStalenessNotice }) {
  if (!staleness.docRevised && !staleness.docRemoved && !staleness.checkoutMoved) return null;
  return (
    <div className="rounded-md border border-amber-600/40 bg-amber-600/10 p-2 text-xs leading-relaxed text-amber-900 dark:text-amber-200" role="note" aria-label="Evidence changed since asked">
      <p className="font-semibold">Something changed since this question was asked</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {staleness.docRevised ? <li>A linked document was revised — open the current version from the options below before answering.</li> : null}
        {staleness.docRemoved ? <li>A linked document can no longer be opened at its recorded path.</li> : null}
        {staleness.checkoutMoved ? <li>{staleness.commitCount > 0
          ? `${staleness.commitCount} commit${staleness.commitCount === 1 ? "" : "s"} landed since${staleness.touchedPaths.length > 0 ? `, touching ${staleness.touchedPaths.join(", ")}` : ""}. The plan may assume code that changed.`
          : "The checkout moved since this question was asked. The plan may assume code that changed."}</li> : null}
      </ul>
      <p className="mt-1 text-amber-900/70 dark:text-amber-200/70">If the plan no longer matches the code, request changes or return it to an earlier stage from Workflow progress.</p>
    </div>
  );
}

// radio (single) / checkbox (multi) options plus a free-text "Other", explicit
// skip, and a single atomic submit — one worker resume, one inbox resolution.
function BatchStepper({ questions, allowSkip, busy, error, submitLabel, showHeading = true, onSubmit, onOpenArtifact }: {
  questions: BatchItem[];
  allowSkip: boolean;
  busy: boolean;
  error: string | null;
  submitLabel: string;
  showHeading?: boolean;
  onSubmit: (answers: string[][]) => void;
  onOpenArtifact?: (artifact: AskArtifact, mode: ArtifactViewerMode) => void;
}) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  if (questions.length === 0) return null;
  const current = questions[Math.min(index, questions.length - 1)]!;
  const copy = questionCopy();
  const splitKeepLabel = SPLIT_KEEP_LABEL;
  const isSplitProposal = isSplitQuestion(current);
  const prompt = isSplitProposal ? splitQuestionText(current.prompt) : current.prompt;
  const splitNotice = isSplitProposal ? splitSelectionNotice(current.options, selected[current.id] ?? []) : null;
  const merged = (id: string): string[] => {
    if (skipped.has(id)) return [];
    const out = [...(selected[id] ?? [])];
    const text = (custom[id] ?? "").trim();
    if (text) out.push(text);
    return out;
  };
  const doneCount = questions.filter((q) => skipped.has(q.id) || merged(q.id).length > 0).length;
  const remainingCount = questions.length - doneCount;
  const complete = remainingCount === 0;
  const isLastQuestion = index === questions.length - 1;
  const pick = (question: BatchItem, label: string) => {
    setSkipped((prev) => { const next = new Set(prev); next.delete(question.id); return next; });
    setSelected((prev) => {
      const has = (prev[question.id] ?? []).includes(label);
      if (question === current && isSplitProposal) {
        // Delivery cards form a multi-select. The explicit keep choice is an
        // alternative, not a fourth delivery: choosing either side clears
        // the other so a card answer can never encode two contradictory
        // outcomes.
        if (label === splitKeepLabel) return { ...prev, [question.id]: has ? [] : [splitKeepLabel] };
        const withoutKeep = (prev[question.id] ?? []).filter((item) => item !== splitKeepLabel);
        return { ...prev, [question.id]: has ? withoutKeep.filter((item) => item !== label) : [...withoutKeep, label] };
      }
      if (question.multiple) return { ...prev, [question.id]: has ? prev[question.id]!.filter((item) => item !== label) : [...(prev[question.id] ?? []), label] };
      // Single-select: an option and a custom text are mutually exclusive.
      if (!has) setCustom((c) => ({ ...c, [question.id]: "" }));
      return { ...prev, [question.id]: has ? [] : [label] };
    });
  };
  const typeCustom = (question: BatchItem, value: string) => {
    setCustom((prev) => ({ ...prev, [question.id]: value }));
    if (value.trim() && !question.multiple) setSelected((prev) => ({ ...prev, [question.id]: [] }));
    if (value.trim()) setSkipped((prev) => { const next = new Set(prev); next.delete(question.id); return next; });
  };
  const skip = (question: BatchItem) => {
    setSkipped((prev) => new Set(prev).add(question.id));
    setSelected((prev) => ({ ...prev, [question.id]: [] }));
    setCustom((prev) => ({ ...prev, [question.id]: "" }));
  };
  const unskip = (question: BatchItem) => setSkipped((prev) => { const next = new Set(prev); next.delete(question.id); return next; });
  return (
    <div role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300">?</span>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            {showHeading ? <div className="text-sm font-medium text-amber-900 dark:text-amber-200">
              {questions.length > 1 ? copy.answersNeeded(questions.length) : copy.answerNeeded}
            </div> : null}
            {questions.length > 1 ? <div className="text-xs text-amber-900/70 dark:text-amber-200/70">{copy.questionOf(index + 1, questions.length)}</div> : null}
          </div>
          {questions.length > 1 ? (
            <div className="flex flex-wrap gap-1" role="group" aria-label={copy.questions}>
              {questions.map((q, i) => {
                const done = skipped.has(q.id) || merged(q.id).length > 0;
                return (
                  <button
                    key={q.id}
                    aria-current={i === index ? "step" : undefined}
                    aria-label={`${copy.questionOf(i + 1, questions.length)}${done ? ` (${copy.answered})` : ""}`}
                    onClick={() => setIndex(i)}
                    className={`inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md border px-2 text-xs font-medium ${i === index ? "border-primary bg-primary/15 text-foreground" : done ? "border-emerald-500/50 bg-emerald-500/10 text-foreground" : "border-border bg-background/40 text-muted-foreground"}`}
                  >
                    {done && i !== index ? "✓ " : ""}{i + 1}
                  </button>
                );
              })}
            </div>
          ) : null}
          {current.title ? <div className="text-sm font-medium text-amber-900 dark:text-amber-200">{current.title}</div> : null}
          {prompt ? <p className="text-sm text-amber-900/80 dark:text-amber-200/80">{prompt}</p> : null}
          {current.staleness ? <StalenessNotice staleness={current.staleness} /> : null}
          {isSplitProposal ? <p className="rounded-md border border-amber-500/30 bg-background/50 p-2 text-xs leading-5 text-amber-900/80 dark:text-amber-100/80">Choose deliveries or <strong className="text-amber-900 dark:text-amber-100">Keep as one card</strong> — not both.</p> : null}
          <div className="grid gap-1" role={current.multiple ? "group" : "radiogroup"} aria-label={current.title}>
            {current.options.map((option) => {
              const active = (selected[current.id] ?? []).includes(option.label);
              const isKeepOption = isSplitProposal && option.label === splitKeepLabel;
              const optionLabel = option.label;
              const description = isSplitProposal ? splitOptionDescription(option.description) : option.description;
              const artifact = option.artifact;
              return (
                <div key={option.label} className={`space-y-1 ${isKeepOption ? "mt-2 border-t border-amber-500/30 pt-2" : ""}`}>
                  <div className={`flex min-h-11 items-stretch overflow-hidden rounded-md border ${active ? "border-primary bg-primary/10" : "border-border bg-background/40 hover:border-primary/50"}`}>
                    <button
                      role={current.multiple ? "checkbox" : "radio"}
                      aria-checked={active}
                      onClick={() => pick(current, option.label)}
                      className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-start gap-3 p-3 text-left text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <span aria-hidden className={`mt-0.5 flex size-5 shrink-0 items-center justify-center border-2 text-xs font-bold ${current.multiple && !isKeepOption ? "rounded-sm" : "rounded-full"} ${active ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/70 bg-background"}`}>{active ? "✓" : ""}</span>
                      <span className="min-w-0"><span className="block font-medium">{optionLabel}</span>{description ? <span className="mt-1 block whitespace-pre-line text-xs leading-5 text-muted-foreground">{description}</span> : null}</span>
                    </button>
                    {artifact ? (
                      onOpenArtifact ? (
                        // The option's own document, not a second decision: it
                        // sits inside the row instead of forming a slab beside
                        // it, and borrows the shared outline treatment so it
                        // harmonizes with the amber panel and the primary
                        // accents instead of introducing a third color.
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onOpenArtifact(artifact, artifactViewerModeForOption(option.label))}
                          title={`Open document: ${artifact.display}`}
                          aria-label={`Open document ${artifact.display}`}
                          className="mr-2 min-h-11 shrink-0 gap-1 self-center"
                        >Open document<span aria-hidden>↗</span></Button>
                      ) : (
                        <span className="inline-flex shrink-0 items-center self-center px-1 text-[11px] text-muted-foreground" title={artifact.path}>{artifact.display}</span>
                      )
                    ) : null}
                  </div>
                  <OptionPreview preview={option.preview} />
                </div>
              );
            })}
          </div>
          {splitNotice ? <p role="status" className="rounded-md border border-primary/40 bg-primary/10 p-2 text-xs leading-5 text-foreground">{splitNotice.text}</p> : null}
          {!isSplitProposal ? <label className="block text-xs font-medium text-amber-900/80 dark:text-amber-200/80">
            <span>{copy.other}</span>
            <input
              value={custom[current.id] ?? ""}
              onChange={(event) => typeCustom(current, event.target.value)}
              placeholder={copy.customPlaceholder}
              className="mt-1 min-h-11 w-full cursor-text rounded-md border border-border bg-background/60 px-2 text-sm font-normal text-foreground placeholder:text-muted-foreground"
            />
          </label> : null}
          {allowSkip && !isSplitProposal ? (
            skipped.has(current.id)
              ? <button onClick={() => unskip(current)} className="min-h-11 cursor-pointer text-xs font-medium text-primary hover:underline">{copy.skipped}</button>
              : <button onClick={() => skip(current)} className="min-h-11 cursor-pointer text-xs text-amber-900/70 hover:underline dark:text-amber-200/70">{copy.skip}</button>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {questions.length > 1 ? (
            <p className="text-xs text-amber-900/60 dark:text-amber-200/60">{copy.batchProgress(doneCount, questions.length, allowSkip)}</p>
          ) : current.multiple && !isSplitProposal ? (
            <p className="text-xs text-amber-900/60 dark:text-amber-200/60">{copy.pickOneOrMore}</p>
          ) : null}
          {isLastQuestion && !complete ? <p role="status" className="text-xs text-amber-900/70 dark:text-amber-200/70">{copy.answersRemaining(remainingCount, allowSkip)}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            {questions.length > 1 ? <Button size="sm" variant="outline" disabled={index === 0 || busy} onClick={() => setIndex((i) => Math.max(0, i - 1))}>{copy.back}</Button> : null}
            {questions.length > 1 && index < questions.length - 1 ? <Button size="sm" variant="outline" disabled={busy} onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}>{copy.next}</Button> : null}
            {isLastQuestion ? <Button size="sm" disabled={!complete || busy} onClick={() => onSubmit(questions.map((q) => merged(q.id)))}>{busy ? copy.sending : submitLabel}</Button> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function QuestionBatch({ cardId, questions, mode, onAnswered, onOpenArtifact }: { cardId: string; questions: BatchItem[]; mode: "live" | "expired"; onAnswered: () => void; onOpenArtifact?: (artifact: AskArtifact, mode: ArtifactViewerMode) => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (questions.length === 0) return null;
  const copy = questionCopy();
  async function submit(all: string[][]) {
    setBusy(true); setError(null);
    try {
      if (mode === "live") {
        const result = await rpc.call("answerQuestions", { cardId, answers: questions.map((q, i) => ({ questionId: q.id, answers: all[i] ?? [] })) });
        if (!result.ok) { setError(result.error ?? "Could not send the answers."); return; }
      } else {
        // Timed-out questions retain every selected option. The batch stays
        // atomic, so a later answer cannot revise work already resumed.
        const payload = expiredAnswerPayload(questions, all);
        if (payload.length === 0) return;
        const result = await rpc.call("answerExpiredQuestions", { cardId, answers: payload });
        if (!result.ok) { setError(result.error ?? "Could not send the answers."); return; }
      }
      onAnswered();
    } finally {
      setBusy(false);
    }
  }
  return (
      <BatchStepper
        questions={questions}
        allowSkip={mode === "live"}
        busy={busy}
        error={error}
        submitLabel={questions.length > 1 ? copy.submitAnswers : copy.submitAnswer}
        showHeading={mode !== "expired"}
        onSubmit={(all) => void submit(all)}
        onOpenArtifact={onOpenArtifact}
      />
  );
}

function ExpiredQuestionsSection({ cardId, questions, onAnswered, onOpenArtifact }: { cardId: string; questions: ExpiredQuestion[]; onAnswered: () => void; onOpenArtifact?: (artifact: AskArtifact, mode: ArtifactViewerMode) => void }) {
  if (questions.length === 0) return null;
  const copy = questionCopy();
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">{copy.recoveryHeading}</h3>
        <QuestionBatch
          cardId={cardId}
          mode="expired"
          questions={questions.map((q) => ({ id: q.id, title: "", prompt: q.question, multiple: q.multiple, kind: q.kind, options: q.options, staleness: q.staleness ?? null }))}
          onAnswered={onAnswered}
          onOpenArtifact={onOpenArtifact}
        />
    </section>
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

type DecisionApiConfig = { endpoint: string; model: string; hasKey: boolean; keySource: string | null; keyRequired: boolean; disabled: boolean; provider: string };
type DecisionRouterPoint = { id: string; label: string; description: string; modes: string[]; mode: string; thresholds: Record<string, number> };
type ManagerRpc = ReturnType<typeof useRpc<typeof rpcContract>>;

function modeLabel(mode: string): string {
  if (mode === "api") return "Decision API";
  return "Built-in rules (default)";
}

// One Jev-compatible endpoint for every router below. Endpoint, key, and
// model live here once — points only pick a mode and thresholds, so a key
// rotation touches exactly one field.
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
    const otherDefault = next === "classifier" ? DECISION_API_DEFAULT_ENDPOINT : CLASSIFIER_DEFAULT_ENDPOINT;
    if (endpoint === otherDefault) setEndpoint(next === "classifier" ? CLASSIFIER_DEFAULT_ENDPOINT : DECISION_API_DEFAULT_ENDPOINT);
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
  const keyHint = !status ? "Loading…" : status.disabled ? "Disabled on this host (STELOW_DECISION_API=0)." : provider === "classifier" ? "No key needed (free tier, rate-limited per IP)." : status.keySource === "env" ? "Key from environment (env wins over stored)." : status.hasKey ? "Key stored — leave blank to keep it." : "No key yet. Routers fall back to built-in rules.";
  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">One decision endpoint for every router below. TypeSafe AI&apos;s Jev-compatible APIs (state + questions schema) take endpoint + key + model — any provider speaking that schema works here; classifier.dev (labels schema) takes endpoint only, no key.</p>
      {status?.disabled ? <p className="text-xs text-muted-foreground" role="status">Decision API is disabled on this host (STELOW_DECISION_API=0). Routers answer with built-in rules.</p> : null}
      <label className="flex flex-col gap-1 text-xs text-muted-foreground"><span>Provider</span>
        <select
          className="cursor-pointer h-9 rounded-md border bg-background px-2 text-sm"
          value={provider}
          disabled={status?.disabled}
          onChange={(event) => pickProvider(event.target.value)}
        >
          <option value="jev">Jev-compatible (state + questions)</option>
          <option value="classifier">classifier.dev (labels, keyless)</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground"><span>Endpoint</span><Input value={endpoint} disabled={status?.disabled} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://api.typesafe.ai/v1/systemone" /></label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground"><span>Model</span><Input value={model} disabled={status?.disabled || provider === "classifier"} onChange={(event) => setModel(event.target.value)} placeholder="jev-latest" /></label>
      {provider === "classifier" ? <p className="text-[11px] text-muted-foreground">classifier.dev answers on its fast tier; model does not apply.</p> : null}
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

function DecisionRouterRow({ rpc, point, onChanged }: { rpc: ManagerRpc; point: DecisionRouterPoint; onChanged: () => Promise<void> }) {
  const [routeAt, setRouteAt] = useState(String(point.thresholds.routeAt ?? 0.6));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function setMode(mode: string) {
    setBusy(true); setMessage(null);
    try {
      const result = await rpc.call("setDecisionPoint", { point: point.id, mode });
      if (result.error) setMessage(result.error); else await onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }
  async function saveThreshold() {
    setBusy(true); setMessage(null);
    try {
      const result = await rpc.call("setDecisionPoint", { point: point.id, mode: point.mode, thresholds: { routeAt: Number(routeAt) } });
      if (result.error) setMessage(result.error); else await onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }
  const dirty = Number(routeAt) !== (point.thresholds.routeAt ?? 0.6);
  const valid = routeAt.trim() !== "" && Number.isFinite(Number(routeAt)) && Number(routeAt) >= 0 && Number(routeAt) <= 1;
  return (
    <div className="space-y-1 rounded-md border bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate" title={point.description}><span className="font-medium">{point.label}</span></span>
        <select
          className="cursor-pointer h-9 shrink-0 rounded-md border bg-background px-2 text-sm"
          value={point.mode}
          disabled={busy}
          onChange={(event) => void setMode(event.target.value)}
        >
          {point.modes.map((mode) => <option key={mode} value={mode}>{modeLabel(mode)}</option>)}
        </select>
      </div>
      <p className="text-[11px] text-muted-foreground">{point.description}</p>
      {point.mode === "api" ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <label className="flex flex-1 items-center gap-2"><span className="shrink-0">Act at confidence ≥</span>
            <Input type="number" min="0" max="1" step="0.05" className="h-9" value={routeAt} onChange={(event) => setRouteAt(event.target.value)} />
          </label>
          <Button size="sm" variant="outline" disabled={busy || !dirty || !valid} onClick={() => void saveThreshold()}>Save</Button>
        </div>
      ) : null}
      {message ? <p className="text-[11px] text-muted-foreground" role="status">{message}</p> : null}
    </div>
  );
}

function DecisionRoutersSection({ rpc, onChanged }: { rpc: ManagerRpc; onChanged: () => Promise<void> }) {
  const [points, setPoints] = useState<DecisionRouterPoint[]>([]);
  const [keyMissing, setKeyMissing] = useState(false);
  const reload = useCallback(() => {
    void rpc.call("listDecisionPoints", {}).then((result) => setPoints(result.points)).catch(() => setPoints([]));
    void rpc.call("getDecisionApiConfig", {}).then((result) => setKeyMissing(result.keyRequired && !result.hasKey)).catch(() => setKeyMissing(false));
  }, [rpc]);
  useEffect(() => { reload(); }, [reload]);
  const keylessApi = keyMissing && points.some((point) => point.mode === "api");
  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">Each router picks how one judgment runs. Built-in rules are offline and free; Decision API needs the section above. Anything unconfigured answers with built-in rules.</p>
      {keylessApi ? <p className="text-xs text-muted-foreground" role="status">Decision API has no key — api routers answer with built-in rules until one is set.</p> : null}
      {points.map((point) => <DecisionRouterRow key={point.id} rpc={rpc} point={point} onChanged={async () => { await onChanged(); reload(); }} />)}
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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const reloadGeneration = useCallback(() => {
    void rpc.call("getGenerationPreset", {}).then((result) => setGenerationPreset(result.preset)).catch(() => setGenerationPreset(null));
  }, [rpc]);
  const reloadReliable = useCallback(() => {
    void rpc.call("getReliablePreset", {}).then((result) => setReliablePreset(result.preset)).catch(() => setReliablePreset(null));
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
  }, [open, rpc, reloadGeneration, reloadReliable]);

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
          <p className="mb-2 text-xs text-muted-foreground">Subagents come in two tiers. Reliable does tools, web, exact file shapes, multi-step work — it runs on the band preset unless a reliable override is set below. Generation is the cheap preset for disposable text-only bursts (`bb stelow draft`); the worker judges every word before using it. Empty means the band preset (today&apos;s behavior).</p>
          <div className="grid gap-2">
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
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">Rule of thumb: when the worker rewrites over 20% of a burst&apos;s output, that call site belongs back on Reliable.</p>
        </DisclosureSection>
        <DisclosureSection title="Decision API" hint="Jev-compatible" defaultOpen={false}>
          <DecisionApiSection rpc={rpc} />
        </DisclosureSection>
        <DisclosureSection title="Decision routers" hint="per-judgment modes" defaultOpen={false}>
          <DecisionRoutersSection rpc={rpc} onChanged={onChanged} />
        </DisclosureSection>
        <div className="mt-3 rounded-md border bg-muted/30 p-3">
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
      </DialogContent>
    </Dialog>
  );
}

// Read-only artifact viewer with discuss-to-agent: Markdown for prose,
// source renderer for code, plus a comment box that posts to the card
// (card comments route to the worker). The bb editor stays one click away
// for edits, but review never needs it.
function ArtifactViewerDialog({ open, onOpenChange, cardId, file, editorTarget, mode = "comment", onCommented }: {
  open: boolean; onOpenChange: (next: boolean) => void; cardId: string;
  file: { display: string; path: string } | null;
  editorTarget: WorkspaceFileTarget | HostFileTarget | null;
  mode?: ArtifactViewerMode;
  onCommented: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [content, setContent] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState<Array<{ id: number; quote: string; comment: string }>>([]);
  const [sending, setSending] = useState(false);
  const nextDraftId = useRef(1);
  function quoteSelection() {
    const text = typeof window !== "undefined" ? window.getSelection()?.toString().trim() ?? "" : "";
    if (!text) {
      toast.message("Select a passage in the preview first, then quote it.");
      return;
    }
    const id = nextDraftId.current++;
    setDrafts((current) => [...current, { id, quote: text.slice(0, 2000), comment: "" }]);
  }
  function removeDraft(id: number) {
    setDrafts((current) => current.filter((draft) => draft.id !== id));
  }
  useEffect(() => {
    if (!open || !file) return;
    setContent(null); setTruncated(false); setLoadError(null); setDrafts([]);
    setLoading(true);
    let cancelled = false;
    void rpc.call("readCardFile", { cardId, path: file.path }).then((result) => {
      if (cancelled) return;
      if (result.error) setLoadError(result.error);
      else { setContent(result.content); setTruncated(result.truncated); }
    }).catch((err) => { if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load the file."); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, file, cardId, rpc]);
  async function sendAll() {
    if (drafts.length === 0 || !file) return;
    setSending(true);
    try {
      const body = [`Re ${file.display}:`, ...drafts.map((draft, index) => {
        const quoted = draft.quote.split("\n").map((line) => `> ${line}`).join("\n");
        const note = draft.comment.trim() || "(no note — for context)";
        return `#### Excerpt ${index + 1}\n${quoted}\n\n${note}`;
      })].join("\n\n");
      const result = await rpc.call("addCardComment", { cardId, target: "card", targetId: cardId, body });
      if (result.error) toast.error(result.error);
      else { setDrafts([]); toast.success(drafts.length === 1 ? "Comment sent to the agent." : `${drafts.length} comments sent to the agent.`); onCommented(); }
    } finally {
      setSending(false);
    }
  }
  const isMarkdown = file ? /\.mdx?$/i.test(file.display) || /\.mdx?$/i.test(file.path) : false;
  const canComment = mode === "comment";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] max-w-4xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="truncate">{file?.display ?? "Artifact"}</DialogTitle>
          <DialogDescription>{canComment ? "Read-only preview. Discuss below — notes go to the agent." : "Read the document before deciding. This review does not modify it."}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          <div className="max-h-[46dvh] overflow-auto rounded-md border bg-muted/20 p-3">
            {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
            {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}
            {!loading && !loadError && content !== null ? (
              isMarkdown ? <div className="text-sm leading-relaxed"><Markdown content={content} /></div> : <SourceCode content={content} path={file?.display ?? "file.txt"} />
            ) : null}
            {truncated ? <p className="mt-2 text-xs text-muted-foreground">Truncated preview — open in the editor for the full file.</p> : null}
          </div>
          {canComment ? (
            <div className="space-y-2 pb-1">
              <span className="flex min-h-11 items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
                <span>Discuss excerpts with the agent{drafts.length ? ` (${drafts.length})` : ""}</span>
                <button onClick={quoteSelection} className="cursor-pointer rounded-md border px-2 py-1 text-xs hover:bg-muted" title="Quote the passage currently selected in the preview above as a new draft">Quote selection</button>
              </span>
              {drafts.length === 0 ? (
                <p className="text-xs text-muted-foreground">Select passages above and quote each one, then send them together.</p>
              ) : null}
              {drafts.map((draft, index) => (
                <div key={draft.id} className="space-y-1 rounded-md border bg-muted/20 p-2">
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-semibold text-muted-foreground">#{index + 1}</span>
                    <blockquote className="min-w-0 flex-1 border-l-2 border-primary/50 pl-2 text-xs text-muted-foreground">{draft.quote.length > 300 ? `${draft.quote.slice(0, 300)}…` : draft.quote}</blockquote>
                    <button onClick={() => removeDraft(draft.id)} aria-label={`Remove excerpt ${index + 1}`} className="cursor-pointer rounded px-1 text-muted-foreground hover:text-foreground">×</button>
                  </div>
                  <textarea value={draft.comment} onChange={(event) => setDrafts((current) => current.map((entry) => entry.id === draft.id ? { ...entry, comment: event.target.value } : entry))} rows={2} className="min-h-16 w-full rounded-md border bg-background p-2 text-sm leading-relaxed focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" placeholder={`Comment on excerpt ${index + 1}… (Cmd/Ctrl+Enter sends all)`} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && drafts.length > 0) void sendAll(); }} />
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          {canComment && editorTarget ? (
            <FileLink target={editorTarget} location={null} className="mr-auto inline-flex min-h-11 cursor-pointer items-center rounded-md px-2 text-xs font-medium text-primary hover:underline">Open in bb editor ↗</FileLink>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {canComment ? <Button disabled={drafts.length === 0 || sending} onClick={() => void sendAll()}>{sending ? "Sending…" : drafts.length > 1 ? `Send ${drafts.length} to agent` : "Send to agent"}</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmActionDialog({ open, onOpenChange, title, description, confirmLabel, confirmTone, onConfirm }: { open: boolean; onOpenChange: (next: boolean) => void; title: string; description: string; confirmLabel: string; confirmTone?: "destructive" | "default"; onConfirm: () => void | Promise<void> }) {  const [pending, setPending] = useState(false);
  useEffect(() => { if (!open) setPending(false); }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>Cancel</Button>
          </DialogClose>
          <Button variant={confirmTone === "destructive" ? "destructive" : "default"} disabled={pending} onClick={async () => { setPending(true); try { await onConfirm(); } finally { setPending(false); } }}>{pending ? "Working…" : confirmLabel}</Button>
        </DialogFooter>
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

// Open-card building blocks: one contextual hero (heroFor) + one disclosure
// pattern (DisclosureSection) for secondary content. Previously every zone —
// banners, meta grid, timeline, preset, comments — used its own ad-hoc
// spacing and heading style.
// One open/close affordance for every collapsible in the panel: a chevron
// that points right when closed and rotates down when open. Native
// <details>/<summary> use the `group-open:` variant; controlled buttons pass
// `open` directly. Native controls already expose expanded state to assistive
// tech; this mirrors it visually for sighted, low-vision, and lay users.
function DisclosureChevron({ className = "", open }: { className?: string; open?: boolean }) {
  const rotation = open === undefined ? "group-open:rotate-90" : open ? "rotate-90" : "rotate-0";
  return <span aria-hidden className={`inline-flex size-5 shrink-0 items-center justify-center text-sm leading-none text-muted-foreground transition-transform duration-150 motion-reduce:transition-none ${rotation} ${className}`}>▶</span>;
}

function DisclosureSection({ title, subtitle, hint, action, children, defaultOpen = false, open, onToggle }: { title: string; subtitle?: React.ReactNode; hint?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; open?: boolean; onToggle?: (open: boolean) => void }) {
  const controlled = open !== undefined;
  return (
    <details
      open={controlled ? open : defaultOpen}
      onToggle={(event) => onToggle?.((event.currentTarget as HTMLDetailsElement).open)}
      className="group rounded-lg border bg-muted/20"
    >
      <summary className={`flex cursor-pointer list-none items-center px-3 py-2 text-sm font-medium marker:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden ${subtitle ? "min-h-12" : "min-h-11"}`}>
        <DisclosureChevron className="mr-1.5" />
        {/* A subtitle is how a section names its job; the Workflow map uses the
            same two-line shape, so the pair reads as one family. */}
        {subtitle ? (
          <span className="min-w-0">
            <span className="block font-semibold leading-5 text-foreground">{title}</span>
            <span className="block text-xs font-normal leading-5 text-muted-foreground">{subtitle}</span>
          </span>
        ) : <span>{title}</span>}
        {typeof hint === "string" ? (
          hint ? <span className="ml-2 truncate text-xs font-normal text-muted-foreground">{hint}</span> : null
        ) : (
          hint ? <span className="ml-auto inline-flex shrink-0 items-center overflow-visible pl-2 text-xs font-normal text-muted-foreground">{hint}</span> : null
        )}
        {action ? <span className="ml-auto inline-flex shrink-0 pl-2" onClick={(event) => event.stopPropagation()}>{action}</span> : null}
      </summary>
      <div className="space-y-3 px-3 pb-3">{children}</div>
    </details>
  );
}

// Legacy name retained while card-specific call sites migrate; the component
// itself is deliberately generic and now also owns configuration disclosures.
const CardDisclosure = DisclosureSection;

// The workflow reference is intentionally separate from the very large card
// body: it is a stable explainer, not card-state orchestration. Keeping it
// here makes its visual density and accessibility contract independently
// reviewable while the parent owns only whether it is expanded.
function WorkflowMap({ open, onToggle }: { open: boolean; onToggle: (open: boolean) => void }) {
  return (
    // No self-margin: as a sibling of the progress section it inherits the
    // card's section rhythm instead of stacking its own offset on top.
    <details className="group overflow-hidden rounded-lg border bg-background/60" onToggle={(event) => onToggle(event.currentTarget.open)}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 py-2.5 marker:hidden hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
        <DisclosureChevron open={open} className="text-base text-foreground" />
        <span className="min-w-0">
          <span className="block text-sm font-semibold leading-5 text-foreground">Workflow map</span>
          <span className="block text-xs leading-5 text-muted-foreground">What each stage does</span>
        </span>
      </summary>
      <div className="space-y-4 border-t px-3 py-3 sm:px-4 sm:py-4">
        <p className="max-w-4xl text-sm leading-6 text-muted-foreground">Analysis, Planning, Execution, and Review are workflow phases. Review contains automated checks (Diff gate and Audit), not human review. Done is the completed outcome after Audit, not a stage; Needs attention can occur in any phase. Each stage links to the upstream Stelow skill or behavior document that defines it.</p>
        <div className="space-y-4">
          {WORKFLOW_PHASES.map((phase) => {
            const stages = STAGE_SEQUENCE.filter((stage) => STAGE_BAND[stage] === phase.id);
            return (
              <section key={phase.id} aria-labelledby={`workflow-map-${phase.id}`} className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <h5 id={`workflow-map-${phase.id}`} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{phase.label}</h5>
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-xs text-muted-foreground">{stages.length} {stages.length === 1 ? "stage" : "stages"}</span>
                </div>
                <ul className="grid gap-2.5 lg:grid-cols-2">
                  {stages.map((stage) => {
                    const url = stageInfoUrl(stage);
                    const skill = STAGE_SKILL[stage] ?? null;
                    return (
                      <li key={stage} className="flex min-w-0 gap-2.5 rounded-md border bg-muted/30 px-3 py-2.5">
                        <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-background text-[11px] font-semibold text-muted-foreground ring-1 ring-border">{STAGE_SEQUENCE.indexOf(stage) + 1}</span>
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <span className="font-medium leading-5 text-foreground">{stageLabel(stage)}</span>
                            {url && skill ? (
                              <UrlLink href={url} title={`How ${stageLabel(stage)} works — ${skill} on GitHub`} aria-label={`${stageLabel(stage)} stage definition in ${skill} on GitHub`} className="text-xs leading-5 text-primary underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                                {skill}
                              </UrlLink>
                            ) : null}
                          </div>
                          <p className="text-xs leading-5 text-muted-foreground">{STAGE_PRODUCES[stage]}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </details>
  );
}

// --- Preview: run the card's web app and look at it. ------------------------
//
// Three properties matter here more than features:
//
// 1. Re-render discipline. This plugin reloads board data in the background,
//    so the frame is memoized on its address alone and the only polling is a
//    bounded wait while a server is starting. Nothing else re-renders it.
// 2. No dead ends. Every state has one obvious action, and every framed
//    preview keeps "Open in a new tab" visible — the escape hatch for an app
//    that refuses framing, or a browser stricter than the verdict.
// 3. Honesty. The exact command, the port, the checkout, and which checkout it
//    is (worker worktree vs project source) are always on screen.
const PreviewFrame = memo(function PreviewFrame({ url, title }: { url: string; title: string }) {
  return (
    <iframe
      key={url}
      src={url}
      title={title}
      // allow-same-origin keeps the dev app's own localStorage and cookies
      // working. That is safe only because the verdict refuses to frame bb's own
      // origin (see previewFrameVerdict), so the framed document is always a
      // different origin from the app that frames it.
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      loading="lazy"
      className="h-[420px] w-full rounded-md border border-border bg-background"
    />
  );
});

function PreviewAddress({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed — select the address and copy it by hand.");
    }
  }
  return (
    <div className="relative max-w-full">
      <code className="block w-full truncate rounded-md border border-border bg-background/60 py-1 pl-2 pr-10 font-mono text-xs" title={url}>{url}</code>
      {/* Copy lives inside the address it copies, height-matched and always
          pointer-shaped: a sibling button never quite aligns with its input. */}
      <button type="button" onClick={() => void copy()} aria-label="Copy preview address" title={copied ? "Copied" : "Copy preview address"} className={`absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-xs text-muted-foreground ${CONTROL_HOVER_TRANSITION} hover:bg-muted hover:text-foreground`}>
        {copied ? "✓" : "⧉"}
      </button>
    </div>
  );
}

const PREVIEW_STATE_TONE: Record<PreviewInfo["state"], string> = {
  stopped: "text-muted-foreground",
  starting: "text-amber-600 dark:text-amber-400",
  running: "text-emerald-600 dark:text-emerald-400",
  failed: "text-destructive",
};

function PreviewSection({ cardId }: { cardId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [info, setInfo] = useState<PreviewInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [frameHidden, setFrameHidden] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const logAutoOpened = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await rpc.call("previewState", { cardId, appOrigin: window.location.origin });
      setInfo(next);
      return next;
    } catch {
      return null;
    }
  }, [rpc, cardId]);

  // Load once per card. Never on every parent render: the board reloads in the
  // background, and a preview must not re-probe Connect — or re-mount a frame —
  // because of it.
  useEffect(() => { void load(); }, [load]);

  async function act(action: "previewStart" | "previewStop" | "previewShare") {
    setBusy(true);
    try {
      const result = await rpc.call(action, { cardId });
      if (!result.ok) toast.error(result.error ?? "The preview could not be changed.");
      setFrameHidden(false);
      await load();
    } catch {
      toast.error("The preview could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  // A server that is still starting is the ONE thing worth waiting for, and
  // the wait is bounded: once it is running or failed, the loop ends. The
  // same tick drives the elapsed clock, and the log opens itself while
  // starting or failed: that is exactly when the read-only terminal is
  // needed, not after hunting for the toggle. The ref keeps a manual hide
  // from being re-opened by the next poll.
  const starting = info?.state === "starting";
  useEffect(() => {
    if (!starting) return;
    let tries = 0;
    setNowTick(Date.now());
    const timer = setInterval(() => {
      tries += 1;
      setNowTick(Date.now());
      void load().then((next) => { if (!next || next.state !== "starting" || tries >= 30) clearInterval(timer); });
    }, 1000);
    return () => clearInterval(timer);
  }, [starting, load]);
  useEffect(() => {
    const state = info?.state ?? null;
    if ((state === "starting" || state === "failed") && info?.log && logAutoOpened.current !== state) {
      logAutoOpened.current = state;
      setShowLog(true);
    }
    if (state !== "starting" && state !== "failed") logAutoOpened.current = null;
  }, [info?.state, info?.log]);

  if (info === null) return null;
  // No web app here: stay out of the way. A missing workspace is worth saying,
  // because the user expected a card they can look at.
  if (!info.available) return info.error ? <p className="text-xs text-muted-foreground">{info.error}</p> : null;

  const running = info.state === "running";
  // Carrying the address in the condition (rather than a separate boolean) keeps
  // the frame's `src` narrowed to a string without a non-null assertion.
  const framedUrl = running && info.frame === "frame" && info.url && !frameHidden ? info.url : null;
  const framed = framedUrl !== null;
  // The same narrowing for the open-in-a-tab affordance.
  const openUrl = running && info.url ? info.url : null;
  const elapsedSecs = starting && info.startedAt ? Math.max(0, Math.round((nowTick - info.startedAt) / 1000)) : null;
  const stateLabel = info.state === "starting" ? `Starting…${elapsedSecs != null ? ` ${elapsedSecs}s` : ""}` : info.state === "running" ? "Running" : info.state === "failed" ? "Failed" : "Not running";

  return (
    <CardDisclosure
      title="Preview"
      hint={running && info.url ? info.url.replace(/^https?:\/\//, "") : `${info.label ?? "Web app"} · ${info.source ?? ""}`.trim()}
      defaultOpen
      action={
        <span className="flex items-center gap-2">
          <span className={`text-xs font-medium ${PREVIEW_STATE_TONE[info.state]}`}>{stateLabel}</span>
          {/* The canonical action decision, so the button and the runtime can
              never disagree about what a state offers. `available` is always
              true here (the early return above), passed explicitly so the
              call states its real input instead of a magic literal. */}
          {previewAction(info.state, info.available) === "stop" ? (
            <Button size="sm" variant="outline" className="cursor-pointer" disabled={busy} onClick={() => void act("previewStop")}>{busy ? "Stopping…" : "Stop"}</Button>
          ) : (
            <Button size="sm" variant="outline" className="cursor-pointer" disabled={busy} onClick={() => void act("previewStart")}>{busy ? "Starting…" : "Start"}</Button>
          )}
          {/* Same Button pattern and height as Start/Stop: one row, one shape. */}
          <Button size="sm" variant="outline" className="cursor-pointer" onClick={() => void load()} aria-label="Refresh preview state">Refresh</Button>
        </span>
      }
    >
      {info.command ? (
        <p className="font-mono text-[11px] leading-relaxed text-muted-foreground" title={info.evidence ?? undefined}>
          {info.source ? `${info.source} · ` : ""}{info.checkout ? `${info.checkout} · ` : ""}$ {info.command}
        </p>
      ) : null}
      {info.error ? <p className="text-xs text-destructive">{info.error}</p> : null}
      {info.url ? <PreviewAddress url={info.url} /> : <p className="text-xs text-muted-foreground">Starting the server will show its address here.</p>}
      {info.reason ? <p className="text-[11px] text-muted-foreground">{info.reason}</p> : null}

      {framedUrl ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">Live preview</span>
            <span className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setFrameHidden(true)}>Hide</Button>
              <Button size="sm" variant="outline" onClick={() => navigate.openUrl(framedUrl)}>Open in a new tab</Button>
            </span>
          </div>
          <PreviewFrame url={framedUrl} title={`Preview of ${info.label ?? "the workspace"}`} />
        </div>
      ) : null}

      {openUrl && !framed ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => navigate.openUrl(openUrl)}>Open in a new tab</Button>
          {info.frame === "frame" ? <Button size="sm" variant="ghost" onClick={() => setFrameHidden(false)}>Show preview</Button> : null}
        </div>
      ) : null}
      {running && info.frame !== null && info.frame !== "frame" && info.frameReason ? (
        <p className="text-[11px] text-muted-foreground">Showing this inline is not possible: {info.frameReason}.</p>
      ) : null}

      {info.hints.length > 0 ? (
        <ul className="space-y-1">
          {info.hints.map((hint) => (
            <li key={hint.text} className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[11px] text-muted-foreground">
              <span>{hint.text}</span>
              {/* A highlighted action that opens nothing is a lie — every
                  hint action here does something real: an href navigates
                  (pairing dashboard), otherwise it retries the port share. */}
              {hint.action ? hint.href ? (
                <Button size="sm" variant="outline" className="h-7 cursor-pointer px-2 text-[11px]" onClick={() => navigate.openUrl(hint.href!)}>{hint.action}</Button>
              ) : (
                <Button size="sm" variant="outline" className="h-7 cursor-pointer px-2 text-[11px]" disabled={busy} onClick={() => void act("previewShare")}>{busy ? "Sharing…" : hint.action}</Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {info.log ? (
        <div className="space-y-1">
          <button type="button" onClick={() => setShowLog((value) => !value)} className={`min-h-11 text-[11px] font-medium text-primary hover:underline`}>
            {showLog ? "Hide server log" : "Show server log"}
          </button>
          {showLog ? (
            <pre className="max-h-64 overflow-auto rounded-md border border-border bg-background/60 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap animate-in fade-in-0 slide-in-from-top-2 duration-150 motion-reduce:animate-none">{info.log}</pre>
          ) : null}
        </div>
      ) : null}
    </CardDisclosure>
  );
}

// Hybrid (A+D+E): single contextual hero derived from card state. One plain
// sentence + one primary action. Replaces the scattered error / paused /
// decision banners with one ordered attention model:
// decision > error > paused > working > calm.
type HeroKind = "decision" | "error" | "paused" | "working" | "calm";
function heroFor(card: CardItem, detail: CardDetailResponse | null): { kind: HeroKind; title: string; sub: string } {
  const archived = archivedCardDetailPresentation(card, stageLabel);
  if (archived) return archived.hero;
  const pending = (detail?.pendingQuestions?.length ?? 0) + (detail?.expiredQuestions?.length ?? 0);
  if (pending > 0) {
    return {
      kind: "decision",
      title: pending === 1 ? "Needs your decision to continue" : `Needs your decision — ${pending} questions`,
      sub: "Answer below and the agent resumes on its own.",
    };
  }
  if (card.activity === "awaiting-answer") {
    return {
      kind: "working",
      title: `Waiting — ${stageLabel(card.stage)}`,
      sub: "The agent is preparing a question. Nothing needs you yet.",
    };
  }
  if (card.activity === "error") {
    return {
      kind: "error",
      title: "The worker stopped",
      sub: card.lastError ?? "Something went wrong. Retry continues in place; restart begins fresh.",
    };
  }
  // A completed card is done being worked — say so plainly, before any
  // idle-based branch can misfire on it. "At Audit" on a finished card read
  // as "the agent is auditing" or "waiting for me", when neither is true:
  // the outcome below is ready to review. (includes() like statusTone
  // below: the contract narrows this union upstream of here.)
  if (["completed", "done"].includes(card.status)) {
    return {
      kind: "calm",
      title: "Done — ready to review",
      sub: "The workflow passed its final audit verification. The result is below.",
    };
  }
  // Prominent paused state only when the idle is known-stuck (past the grace
  // period), never for the routine seconds-long idle between agent turns.
  // Firing it on every turn would cry wolf and teach the signal to be ignored.
  // Fresh idles still get the subtle resume row in the calm hero below.
  if (card.activity === "idle" && card.workerThreadId != null && detail?.card.needsAttention) {
    const stalls = detail?.card.stallCount ?? 0;
    return {
      kind: "paused",
      title: "Paused",
      sub: stalls >= 3
        ? `Stalled ${stalls} times in ${stageLabel(card.stage)} with no progress — inspect the thread before retrying, or restart fresh.`
        : card.lastError
          ? "The worker failed with unfinished work. Retry continues in place; restart begins fresh from triage."
          : "The worker is idle with unfinished work. Resume continues in place; restart begins fresh from triage.",
    };
  }
  if (card.activity === "running") {
    return {
      kind: "working",
      title: `Working — ${stageLabel(card.stage)}`,
      sub: "The agent advances on its own. Nothing needs you right now.",
    };
  }
  // A completed research index is represented by the Done column, not a
  // separate review state. Keep the hero calm and let the board carry status.
  // A parked card names no checkpoint either: without a worker nothing has
  // started, whatever the seeded stage says.
  if (card.workerThreadId == null) {
    return {
      kind: "calm",
      title: "Not started",
      sub: "Parked in Inbox. Nothing runs until you start it.",
    };
  }
  return {
    kind: "calm",
    title: `At ${stageLabel(card.stage)} — nothing needs you`,
    sub: "Follow along below, or send a note to the agent.",
  };
}
const HERO_STYLE: Record<HeroKind, { wrap: string; dot: string; alert: boolean }> = {
  decision: { wrap: "border-amber-500/50 bg-amber-500/5", dot: "bg-amber-500", alert: true },
  error: { wrap: "border-destructive/40 bg-destructive/5", dot: "bg-destructive", alert: true },
  paused: { wrap: "border-amber-500/40 bg-amber-500/5", dot: "bg-amber-500", alert: false },
  working: { wrap: "border-emerald-500/30 bg-emerald-500/5", dot: "bg-emerald-500", alert: false },
  calm: { wrap: "border-border bg-card", dot: "bg-muted-foreground", alert: false },
};

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

type ResearchIndexState = {
  found: boolean;
  indexPath: string | null;
  content: string | null;
  truncated: boolean;
  opportunities: Array<{ id: string; title: string; checked: boolean; group: string | null }>;
  rounds: Array<{ n: number; strategyId: string; label: string; emoji: string; at: string; status: "ready" | "pending" | "missing"; missing: string[]; substeps: Array<{ slug: string; status: "ready" | "missing" | "invalid" | "needs-depth" }>; files: Array<{ display: string; path: string; absolutePath: string; hostId: string; generatedAt: string }> }>;
  error: string | null;
};

// Fan-out: turn checked opportunities into build cards. Mirrors the
// GitHub-import dialog (checkbox list + bulk confirm); the server re-parses
// the index, spawns, and flips exactly the spawned boxes.
function FanOutDialog({ open, onOpenChange, cardId, opportunities, onFanned }: {
  open: boolean; onOpenChange: (next: boolean) => void; cardId: string;
  opportunities: ResearchIndexState["opportunities"];
  onFanned: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  // Selection resets ONLY when the dialog opens. The `opportunities` prop is
  // a fresh array on every parent render (realtime index reloads), so it must
  // never be a dependency here — otherwise a background reload re-checks
  // everything while the user is mid-selection.
  useEffect(() => {
    if (!open) return;
    setSelected({});
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const available = opportunities.filter((item) => !item.checked);
  const groups = useMemo(() => {
    const seen: string[] = [];
    for (const item of available) {
      const group = item.group ?? "Opportunities";
      if (!seen.includes(group)) seen.push(group);
    }
    return seen;
  }, [available]);
  const chosen = available.filter((item) => selected[item.id]);
  async function confirm() {
    if (chosen.length === 0) return;
    setBusy(true);
    try {
      const result = await rpc.call("fanOutResearch", { cardId, opportunityIds: chosen.map((item) => item.id) });
      if (!result.ok) {
        toast.error(result.error ?? "Could not create build cards.");
        if (result.created.length > 0) {
          onOpenChange(false);
          onFanned();
        }
        return;
      }
      toast.success(`Created ${result.created.length} ${result.created.length === 1 ? "build card" : "build cards"}.`);
      onOpenChange(false);
      onFanned();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Select To Build</DialogTitle>
          <DialogDescription>Select which opportunities become build cards (starting at triage) — nothing is created until you confirm. Created cards are marked here so retrying never duplicates them.</DialogDescription>
        </DialogHeader>
        {available.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing available — every opportunity was already fanned out or checked.</p>
        ) : (
          <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border">
            {groups.map((group) => (
              <li key={group}>
                <p className="bg-muted/40 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{group}</p>
                {available.filter((item) => (item.group ?? "Opportunities") === group).map((item) => (
                  <label key={item.id} className="flex cursor-pointer items-start gap-2 p-2 hover:bg-muted/40">
                    <input
                      className="mt-1 h-4 w-4 shrink-0 cursor-pointer"
                      type="checkbox"
                      checked={Boolean(selected[item.id])}
                      onChange={() => setSelected((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                      disabled={busy}
                    />
                    <span className="min-w-0 text-sm leading-5">{item.title}</span>
                  </label>
                ))}
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>Cancel</Button>
          </DialogClose>
          <Button onClick={() => void confirm()} disabled={busy || chosen.length === 0}>{busy ? "Creating…" : chosen.length === 0 ? "Select opportunities" : `Create ${chosen.length} ${chosen.length === 1 ? "card" : "cards"}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Composite research: run another strategy round on the same request. One
// round at a time (single-select) — rounds accumulate as ### sections in
// the index, so the card stays a deterministic sequence, never a parallel
// batch to merge.
function StrategyRunDialog({ open, onOpenChange, cardId, strategies, runIds, onStarted }: {
  open: boolean; onOpenChange: (next: boolean) => void; cardId: string;
  strategies: ResearchStrategyOption[];
  runIds: string[];
  onStarted: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setBusy(false);
    setPicked((current) => current ?? strategies.find((entry) => !runIds.includes(entry.id))?.id ?? strategies[0]?.id ?? null);
  }, [open]);
  const active = strategies.find((entry) => entry.id === picked) ?? null;
  async function confirm() {
    if (!active) return;
    setBusy(true);
    try {
      const result = await rpc.call("runResearchStrategy", { cardId, strategy: active.id });
      if (!result.ok) {
        toast.error(result.error ?? "Could not start the strategy round.");
        return;
      }
      toast.success(`Started a ${active.label} research round. Results will be added to this card.`);
      onOpenChange(false);
      onStarted();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Explore another strategy</DialogTitle>
          <DialogDescription>A fresh worker applies another approach to the same request. Its findings are added without overwriting existing results.</DialogDescription>
        </DialogHeader>
        <StrategyPicker strategies={strategies} value={picked} onChange={setPicked} runIds={runIds} groupName="research-strategy-round" disabled={busy} />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>Cancel</Button>
          </DialogClose>
          <Button onClick={() => void confirm()} disabled={busy || !active}>{busy ? "Starting…" : active ? `Run ${active.label}` : "Pick a strategy"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Shared detail leaves. Build and research bodies render identical
// worker history, conversation, and inbox-event banners — one definition
// each instead of drifting copies.
function WorkerHistoryList({ history, separated = false }: { history: CardDetailResponse["workerHistory"]; separated?: boolean }) {
  const navigate = useBbNavigate();
  if (history.length === 0) return null;
  return (
    <details className={`group${separated ? " mt-3 border-t pt-2" : ""}`}>
      <summary className="flex min-h-11 cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><DisclosureChevron />Worker history ({history.length}) — archived threads stay readable</summary>
      <div className="mt-1 divide-y divide-border rounded-md border">
        {history.map((entry) => (
          <div key={entry.threadId}>
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
        ))}
      </div>
    </details>
  );
}

function CardConversation({ comments, draft, onDraftChange, onSend, defaultOpen = false, threadId }: {
  comments: CardDetailResponse["comments"]; draft: string; onDraftChange: (value: string) => void; onSend: () => void; defaultOpen?: boolean; threadId?: string | null;
}) {
  return (
    <CardDisclosure
      title="Conversation"
      hint={comments.length ? `${comments.length}` : "talk to the agent"}
      defaultOpen={defaultOpen}
    >
      <div className="space-y-2">
        {comments.length ? comments.map((entry) => {
          const mine = entry.author !== "agent";
          return (
            <div key={entry.id} className={`rounded-lg border p-2.5 ${mine ? "border-primary/25 bg-primary/5" : "border-border bg-muted/30"}`}>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${mine ? "bg-primary" : "bg-muted-foreground"}`} />
                <span className="font-medium text-foreground">{mine ? "You" : "Agent"}</span>
                <span title={new Date(entry.createdAt).toLocaleString()}>{new Date(entry.createdAt).toLocaleString()}</span>
              </div>
              <div className="mt-1 text-sm leading-relaxed"><Markdown content={entry.body} /></div>
            </div>
          );
        }) : <p className="text-xs text-muted-foreground">No comments yet — send the first note to the agent below.</p>}
      </div>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Write to the agent</span>
        <textarea value={draft} onChange={(event) => onDraftChange(event.target.value)} rows={3} className="min-h-24 w-full rounded-md border bg-background p-2 text-sm leading-relaxed focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" placeholder="Ask, correct, or add context... (Cmd/Ctrl+Enter to send)" onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && draft.trim()) onSend(); }} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-muted-foreground">⌘/Ctrl + Enter sends · attachments and @mentions live in the worker thread</span>
        <span className="ml-auto inline-flex items-center gap-2">
          {threadId ? <OpenThreadButton threadId={threadId} /> : null}
          <Button disabled={!draft.trim()} onClick={() => onSend()}>Send to agent</Button>
        </span>
      </div>
    </CardDisclosure>
  );
}

function InboxEventBanner({ visible, event, sectionRef }: {
  visible: boolean;
  event: InboxEventSnapshot | null;
  sectionRef: React.RefObject<HTMLElement | null>;
}) {
  if (!visible) return null;
  const presentation = event ? inboxEventPresentation(event) : null;
  return (
    <section ref={sectionRef} tabIndex={-1} className={`rounded-lg border p-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${presentation?.tone ? "border-border bg-muted/40" : "border-amber-500/40 bg-amber-500/10"}`} aria-label="Inbox notification">
      <p className="text-sm font-semibold">{presentation ? `${presentation.label}.` : "Opened from Stelow Inbox."}</p>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{event ? inboxEventDescription(event) : "This notification is no longer available."}</p>
      {event && presentation ? <p className="mt-1 text-xs text-muted-foreground" title={new Date(presentation.stateAt).toLocaleString()}>{inboxEventTime(event)}</p> : null}
    </section>
  );
}

function useInboxEventFocus(eventId: string | null, event: InboxEventSnapshot | null, sectionRef: React.RefObject<HTMLElement | null>) {
  const focusedEventId = useRef<string | null>(null);
  useEffect(() => {
    if (!eventId || !event || focusedEventId.current === eventId) return;
    focusedEventId.current = eventId;
    sectionRef.current?.scrollIntoView({ block: "nearest" });
    sectionRef.current?.focus({ preventScroll: true });
  }, [event, eventId, sectionRef]);
}

// Shared worker block: preset readout, state-appropriate recovery, and worker
// history. Card lifecycle actions deliberately live in the card header.
// Checkout identity in plain words: the card reads its stored spawn
// environment instead of guessing shared-vs-worktree from paths.
// Exploratory cards already say so elsewhere, so they get no line here.
const CHECKOUT_LABEL: Record<string, string> = {
  worktree: "Isolated worktree",
  shared: "Shared project checkout",
  managed: "BB-managed checkout",
  personal: "Personal workspace",
};
function checkoutNoteFor(environmentLabel: string | null | undefined, branch?: string | null) {
  if (!environmentLabel || environmentLabel === "unknown" || environmentLabel === "exploratory") return null;
  const label = CHECKOUT_LABEL[environmentLabel] ?? environmentLabel;
  return <>Checkout: {label}{branch ? <> · branch <code>{branch}</code></> : null}</>;
}

function WorkerSection({ card, detail, presetStale, restarting, onRestartWorker, onPreset, presetPill, presetNote, pillTitle, githubLink, checkoutNote }: {
  card: CardItem | null;
  detail: CardDetailResponse | null;
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

// Research-track card detail: hero + index + fan-out + artifacts + worker +
// conversation. Build-only surfaces (stages, timeline, gates, intent)
// never render here; every leaf below is shared with the build body.
type SubstepQuality = { slug: string; status: "ready" | "missing" | "invalid" | "needs-depth" };

const SUBSTEP_STATUS_LABEL: Record<SubstepQuality["status"], string> = {
  ready: "ready",
  missing: "missing",
  invalid: "thin or mirrored",
  "needs-depth": "needs depth",
};

const SUBSTEP_STATUS_DOT: Record<SubstepQuality["status"], string> = {
  ready: "bg-emerald-500",
  missing: "bg-zinc-400",
  invalid: "bg-orange-500",
  "needs-depth": "bg-amber-500",
};

// Quality section for research rounds: per-substep status from the same
// predicates verify enforces (rounds carry substeps from researchIndex),
// plus one Repair action that posts the failure list as a comment and
// resumes the worker. Read-only otherwise — no second lifecycle here.
function ResearchQualitySection({ rounds, repairing, onRepair }: {
  rounds: Array<{ n: number; label: string; status: "ready" | "pending" | "missing"; substeps: SubstepQuality[] }>;
  repairing: boolean;
  onRepair: (lines: string[]) => void;
}) {
  const composite = rounds.filter((round) => round.substeps.length > 0);
  if (composite.length === 0) return null;
  const open = composite.flatMap((round) =>
    round.substeps.filter((sub) => sub.status !== "ready").map((sub) => ({ round, sub })),
  );
  const lines = open.map(({ round, sub }) => `Round ${round.n} (${round.label} — ${sub.slug}): ${SUBSTEP_STATUS_LABEL[sub.status]} — rewrite per the playbook completeness contract, then run verify again.`);
  return (
    <section aria-label="Artifact quality" className="rounded-lg border p-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Quality</h3>
      {open.length === 0 ? (
        <p className="pt-1 text-xs text-muted-foreground">All composite substeps meet their contracts. {rounds.length === 1 ? "1 round" : `${rounds.length} rounds`} checked.</p>
      ) : (
        <div className="space-y-2 pt-2">
          <ul className="space-y-1">
            {open.map(({ round, sub }) => (
              <li key={`${round.n}-${sub.slug}`} className="flex items-start gap-2 text-xs">
                <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${SUBSTEP_STATUS_DOT[sub.status]}`} />
                <span>Round {round.n} ({sub.slug}): {SUBSTEP_STATUS_LABEL[sub.status]}</span>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="outline" disabled={repairing} onClick={() => onRepair(lines)} title="Post the failure list as a comment and resume the worker to fix it.">{repairing ? "Repairing…" : "Repair this artifact"}</Button>
        </div>
      )}
    </section>
  );
}

// Explore quality: one file, one seal, resolved live through qualitySeal.
function ExploreQualitySection({ cardId, filePath, repairing, onRepair }: {
  cardId: string;
  filePath: string | null;
  repairing: boolean;
  onRepair: (lines: string[]) => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [seal, setSeal] = useState<{ status: string; failures: string[]; label: string | null } | null>(null);
  useEffect(() => {
    if (!filePath) return;
    let cancelled = false;
    void rpc.call("qualitySeal", { cardId, path: filePath }).then((result) => { if (!cancelled) setSeal(result); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [rpc, cardId, filePath]);
  if (!filePath) return null;
  const bad = (seal?.failures ?? []).length > 0;
  const lines = (seal?.failures ?? []).map((failure) => `${seal?.label ?? filePath}: ${failure} — rewrite it, then run verify again.`);
  return (
    <section aria-label="Artifact quality" className="rounded-lg border p-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Quality</h3>
      {!seal ? <p className="pt-1 text-xs text-muted-foreground">Checking…</p> : null}
      {seal && !bad ? <p className="pt-1 text-xs text-muted-foreground">Stage deliverable meets its contract.</p> : null}
      {seal && bad ? (
        <div className="space-y-2 pt-2">
          <ul className="space-y-1">
            {seal.failures.map((failure, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-amber-500" />
                <span>{failure}</span>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="outline" disabled={repairing} onClick={() => onRepair(lines)} title="Post the failure list as a comment and resume the worker to fix it.">{repairing ? "Repairing…" : "Repair this artifact"}</Button>
        </div>
      ) : null}
    </section>
  );
}

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
              <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${item.scopeStatus && ["done", "completed"].includes(item.scopeStatus) ? "bg-emerald-500" : "bg-amber-500"}`} />
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

function ResearchDetailBody({ cardId, inboxEventId, inboxEvent, onClose, navigate, card, detail, onChanged }: {
  cardId: string; inboxEventId: string | null; onClose: () => void; navigate: ReturnType<typeof useBbNavigate>;
  inboxEvent: InboxEventSnapshot | null; card: CardItem | null; detail: CardDetailResponse | null; onChanged: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [index, setIndex] = useState<ResearchIndexState | null>(null);
  const [indexRefresh, setIndexRefresh] = useState(0);
  const [strategies, setStrategies] = useState<ResearchStrategyOption[]>([]);
  const [comment, setComment] = useState("");
  const [restartWorkerOpen, setRestartWorkerOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [starting, setStarting] = useState(false);
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [viewerFile, setViewerFile] = useState<{ display: string; path: string; target: WorkspaceFileTarget | HostFileTarget | null; mode?: ArtifactViewerMode } | null>(null);
  const [fanOutOpen, setFanOutOpen] = useState(false);
  const [strategyRunOpen, setStrategyRunOpen] = useState(false);
  const inboxEventRef = useRef<HTMLElement | null>(null);

  const loadIndex = useCallback(async () => {
    try {
      const [indexResult, strategiesResult] = await Promise.all([
        rpc.call("researchIndex", { cardId }),
        rpc.call("researchStrategies", {}).catch(() => ({ strategies: [] })),
      ]);
      setIndex(indexResult);
      setStrategies(strategiesResult.strategies);
    } catch {
      setIndex({ found: false, indexPath: null, content: null, truncated: false, opportunities: [], rounds: [], error: "Unable to load the index." });
    }
  }, [cardId, rpc]);

  useEffect(() => { void loadIndex(); }, [loadIndex, indexRefresh]);
  // Viewing a completed card marks its completion seen (read, never
  // resolved): the badge drops, Recent updates keeps the entry.
  useEffect(() => {
    if (card?.status === "completed") void rpc.call("markCardNotificationsRead", { cardId, kind: "completed" }).catch(() => {});
  }, [cardId, card?.status, rpc]);
  useInboxEventFocus(inboxEventId, inboxEvent, inboxEventRef);

  async function submitComment() {
    if (!comment.trim()) return;
    const result = await rpc.call("addCardComment", { cardId, target: "card", targetId: cardId, body: comment.trim() });
    if (result.error) {
      toast.error(result.error);
      return;
    }
    setComment("");
    onChanged();
  }

  async function doRetry() {
    setRetrying(true);
    try {
      const result = await rpc.call("retryWorker", { cardId });
      if (!result.ok) toast.error(result.error ?? "Retry failed. Try Restart fresh instead.");
      else toast.success("Worker retried — continuing the research.");
      onChanged();
    } finally {
      setRetrying(false);
    }
  }

  // Quality repair: post the failure list where the worker reads it, then
  // resume in place. One human action, existing rails only.
  const [repairing, setRepairing] = useState(false);
  async function doQualityRepair(lines: string[]) {
    setRepairing(true);
    try {
      const posted = await rpc.call("addCardComment", { cardId, target: "card", targetId: cardId, body: `Repair requested — the Quality section names these failures:\n${lines.map((line) => `- ${line}`).join("\n")}` });
      if (posted.error) {
        toast.error(posted.error);
        return;
      }
      const retried = await rpc.call("retryWorker", { cardId });
      if (!retried.ok) toast.error(retried.error ?? "Repair posted, but resume failed.");
      else toast.success("Repair requested — worker resumed with the failure list.");
      onChanged();
    } finally {
      setRepairing(false);
    }
  }

  async function doStart() {
    setStarting(true);
    try {
      const result = await rpc.call("startWorker", { cardId });
      if (!result.ok) toast.error(result.error ?? "Start failed.");
      else toast.success("Worker started — the research is now Doing.");
      onChanged();
    } finally {
      setStarting(false);
    }
  }

  async function doRestartWorker() {
    setRestartWorkerOpen(false);
    setRestarting(true);
    try {
      const result = await rpc.call("restartWorker", { cardId });
      if (!result.ok) toast.error(result.error ?? "Restart failed.");
      else toast.success("Worker restarted — continuing the research.");
      onChanged();
    } finally {
      setRestarting(false);
    }
  }

  const pendingFirst = detail?.pendingQuestions?.[0] ?? null;
  const hero = card ? heroFor(card, detail) : null;
  const heroStyle = hero ? HERO_STYLE[hero.kind] : null;
  const presetStale = Boolean(detail && card?.workerThreadId && (detail.card.presetRestartPending || (detail.card.workerPresetId && detail.card.workerPresetId !== detail.card.presetId)));
  const strategyById = useMemo(() => new Map(strategies.map((entry) => [entry.id, entry.label])), [strategies]);
  const strategyLabel = card ? joinStrategyLabels(card.researchStrategies ?? [card.researchStrategy], strategyById) : null;
  const available = index?.opportunities.filter((item) => !item.checked) ?? [];
  // The index supplies research findings and friendly labels; the round
  // history remains the only source of openable files.
  const indexBody = useMemo(() => (index?.found && index.content ? parseResearchIndexSections(index.content) : null), [index]);
  const artifactGroups = useMemo<ArtifactInventoryGroup[]>(() => groupResearchArtifacts(index?.rounds, indexBody?.outputs), [index?.rounds, indexBody?.outputs]);
  const artifactCount = artifactGroups.reduce((total, group) => total + group.items.length, 0);

  return (
    <div className={`stelow-live-surface stelow-detail-surface flex h-full flex-col ${card ? liveBorderClass(card) : ""}`}>
      <div className="flex-1 overflow-auto p-4">
        <div className="mx-auto w-full max-w-3xl space-y-6">
        {card ? (
          <>
            <InboxEventBanner visible={Boolean(inboxEventId) && shouldShowInboxEventBanner(inboxEvent, hero)} event={inboxEvent} sectionRef={inboxEventRef} />
            {hero && heroStyle ? (
              <section aria-label="Research status" {...(heroStyle.alert ? { role: "alert" } : {})} className={`rounded-lg border p-4 ${heroStyle.wrap}`}>
                <div className="flex items-start gap-2.5">
                  <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${heroStyle.dot}`} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <h2 className="text-[16px] font-semibold leading-snug tracking-tight text-foreground">{hero.title}</h2>
                    <p className="text-sm leading-relaxed text-muted-foreground">{hero.sub}</p>
                    <p className="pt-1 text-[15px] leading-relaxed text-foreground">{card.prompt}</p>
                    {index && index.found && available.length > 0 && card.status !== "completed" && card.status !== "archived" ? (
                      <p className="text-xs text-muted-foreground">Review the results below, select opportunities to build, then move this card to Done.</p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <LightweightStatusPills card={card} statusTone={statusTone} columnLabel={RESEARCH_COLUMN_LABELS[researchColumnOf(card)] ?? null} tagLabel={strategyLabel} tagTitle="Research strategy — the playbook driving this investigation." kind="research" />
                      {card.workspaceKind === "exploratory" ? <p className="text-xs text-muted-foreground" title={card.workspacePath ?? undefined}>Exploratory work · stored locally</p> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-3">
                      {!card.workerThreadId && card.status !== "completed" && card.status !== "archived" ? (
                        <>
                          <span className="w-full text-xs text-muted-foreground">Not started — parked in Inbox. Nothing runs until you start it.</span>
                          <Button size="sm" disabled={starting} onClick={() => void doStart()} title="Start a worker for this card now.">{starting ? "Starting…" : "Start"}</Button>
                        </>
                      ) : null}
                      {hero.kind === "decision" && pendingFirst ? <span className="w-full text-xs text-muted-foreground">Answer directly below — the first question is open.</span> : null}
                      {hero.kind === "decision" ? <HeroErrorNote card={card} /> : null}
                      {hero.kind === "decision" && card.activity === "error" && card.lastError && !presetStale ? (
                        <Button size="sm" variant="outline" disabled={retrying} onClick={() => void doRetry()} title="Retry the failed worker in place instead of answering — nothing is reset.">{retrying ? "Retrying…" : "Retry worker"}</Button>
                      ) : null}
                      {hero.kind === "decision" && card.workerThreadId ? <OpenThreadButton threadId={card.workerThreadId} /> : null}
                      {hero.kind === "error" && card.workerThreadId ? (
                        <>
                          {presetStale ? <span className="w-full text-xs text-muted-foreground">Preset changed to {detail?.card.presetProviderId}/{detail?.card.presetModelId} — needs a fresh worker.</span> : null}
                          {presetStale ? (
                            <Button size="sm" disabled={restarting} onClick={() => setRestartWorkerOpen(true)} title="Start a fresh worker on the new preset, continuing the research.">{restarting ? "Restarting…" : "Restart worker…"}</Button>
                          ) : (
                            <Button size="sm" disabled={retrying} onClick={() => void doRetry()} title="Continue the same worker in place — nothing is reset.">{retrying ? "Retrying…" : "Retry"}</Button>
                          )}
                          <OpenThreadButton threadId={card.workerThreadId} />
                        </>
                      ) : null}
                      {hero.kind === "paused" ? (
                        <>
                          {presetStale ? <span className="w-full text-xs text-muted-foreground">Preset changed to {detail?.card.presetProviderId}/{detail?.card.presetModelId} — needs a fresh worker.</span> : null}
                          {presetStale ? (
                            <Button size="sm" disabled={restarting} onClick={() => setRestartWorkerOpen(true)} title="Start a fresh worker on the new preset, continuing the research.">{restarting ? "Restarting…" : "Restart worker…"}</Button>
                          ) : (
                            <Button size="sm" disabled={retrying} onClick={() => void doRetry()} title={card.lastError ? "Retry the failed worker in place — nothing is reset." : "Resume the idle worker in place — nothing is reset."}>{retrying ? "Retrying…" : card.lastError ? "Retry" : "Resume"}</Button>
                          )}
                          <OpenThreadButton threadId={card.workerThreadId} />
                        </>
                      ) : null}
                      {(hero.kind === "working" || hero.kind === "calm") && card.workerThreadId && !(hero.kind === "calm" && card.activity === "idle" && card.workerThreadId && card.status !== "completed" && card.status !== "archived") ? (
                        <OpenThreadButton threadId={card.workerThreadId} />
                      ) : null}
                      {hero.kind === "calm" && card.activity === "idle" && card.workerThreadId && card.status !== "completed" && card.status !== "archived" ? (
                        <>
                          {presetStale ? <span className="w-full text-xs text-muted-foreground">Preset changed to {detail?.card.presetProviderId}/{detail?.card.presetModelId} — needs a fresh worker.</span> : null}
                          {presetStale ? (
                            <Button size="sm" disabled={restarting} onClick={() => setRestartWorkerOpen(true)} title="Start a fresh worker on the new preset, continuing the research.">{restarting ? "Restarting…" : "Restart worker…"}</Button>
                          ) : (
                            <Button size="sm" disabled={retrying} onClick={() => void doRetry()} title="Continue the same worker in place — nothing is reset.">{retrying ? "Retrying…" : "Resume"}</Button>
                          )}
                          <OpenThreadButton threadId={card.workerThreadId} />
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
                {pendingFirst ? (
                  <div className="mt-3 space-y-2 border-t border-amber-500/20 pt-3">
                    <QuestionBatch cardId={card.id} mode="live" questions={detail?.pendingQuestions.map((q) => ({ id: q.id, title: q.title, prompt: q.question, multiple: q.multiple, kind: q.kind, options: q.options, staleness: q.staleness ?? null })) ?? []} onAnswered={() => { onChanged(); void loadIndex(); }} onOpenArtifact={(a, mode) => openAskArtifact(card, detail?.fileEnvironmentId ?? null, setViewerFile, a, mode)} />
                  </div>
                ) : null}
                {detail && detail.expiredQuestions.length > 0 ? <div className="mt-3 border-t border-amber-500/20 pt-3"><ExpiredQuestionsSection cardId={card.id} questions={detail.expiredQuestions} onOpenArtifact={(a, mode) => openAskArtifact(card, detail.fileEnvironmentId, setViewerFile, a, mode)} onAnswered={() => { onChanged(); void loadIndex(); }} /></div> : null}
              </section>
            ) : null}

            <WorkerSection
              card={card}
              detail={detail}
              presetStale={presetStale}
              restarting={restarting}
              onRestartWorker={() => setRestartWorkerOpen(true)}
              onPreset={() => setPresetDialogOpen(true)}
              presetPill={<>Research · {detail?.card.presetName ?? "default"}</>}
              presetNote={<>Applies to the next worker — Resume keeps the current one.</>}
              pillTitle="Preset for the next worker"
              checkoutNote={checkoutNoteFor(detail?.card.environmentLabel)}
            />

            <InputFiles card={card} detail={detail} onView={(file) => setViewerFile(file)} />

            <CardDisclosure
              title="Research summary"
              hint={index && index.found ? researchOpportunityHint(available.length, index.opportunities.length) : "being prepared"}
              defaultOpen
            >
              {!index ? <p className="text-xs text-muted-foreground">Preparing results…</p> : null}
              {index && !index.found ? <p className="text-xs text-muted-foreground">Results are still being prepared.</p> : null}
              {index?.found && indexBody?.summary ? <div className="text-sm leading-relaxed"><Markdown content={indexBody.summary} /></div> : null}
              {index?.found && artifactGroups.length > 0 ? <p className="text-xs text-muted-foreground">Read the artifacts for the full evidence and detail.</p> : null}
              {index?.truncated ? <p className="text-xs text-muted-foreground">Results are shortened here. Open the full research file at {index.indexPath}.</p> : null}
              {index?.found && index.opportunities.length > 0 ? (
                <div className="space-y-2 border-t pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Opportunities</h4>
                    <span className="flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => setStrategyRunOpen(true)} title="Run another strategy on the same request. Its findings are added to these results.">Explore another strategy…</Button>
                          <Button size="sm" variant="outline" disabled={available.length === 0} onClick={() => setFanOutOpen(true)} title="Select opportunities, then create the build cards.">Select To Build</Button>
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {index.opportunities.map((item) => (
                      <li key={item.id} className="flex items-start gap-2 text-sm">
                        <span className="mt-0.5 shrink-0" aria-hidden>•</span>
                        <span className={item.checked ? "text-muted-foreground line-through" : ""}>{item.title}</span>
                        {item.checked ? <span className="shrink-0 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">fanned out</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardDisclosure>

            <PreviewSection cardId={card.id} />

            <ResearchQualitySection rounds={index?.rounds ?? []} repairing={repairing} onRepair={(lines) => void doQualityRepair(lines)} />

            <CardDisclosure title="Artifacts" hint={artifactCount > 0 ? `${artifactCount} ${artifactCount === 1 ? "file" : "files"} · newest round first` : "being prepared"} defaultOpen>
              <ArtifactInventory
                groups={artifactGroups}
                workspaceKind={card.workspaceKind}
                fileEnvironmentId={detail?.fileEnvironmentId ?? null}
                onView={(file) => setViewerFile(file)}
              />
            </CardDisclosure>

            <CardConversation comments={detail?.comments ?? []} draft={comment} onDraftChange={setComment} onSend={() => void submitComment()} defaultOpen={hero?.kind === "decision"} threadId={card?.workerThreadId ?? null} />

          </>
        ) : null}
        </div>
      </div>
      <ConfirmActionDialog
        open={restartWorkerOpen}
        onOpenChange={setRestartWorkerOpen}
        title="Restart the worker on the current preset?"
        description="Stops the running worker and starts a fresh one on this card's preset, continuing the research (not from scratch). Use this to apply a preset change."
        confirmLabel="Restart worker"
        confirmTone="default"
        onConfirm={doRestartWorker}
      />
      <PresetAssignDialog
        open={presetDialogOpen}
        onOpenChange={setPresetDialogOpen}
        cardId={cardId}
        onChanged={() => { onChanged(); void loadIndex(); }}
      />
      <ArtifactViewerDialog
        open={viewerFile !== null}
        onOpenChange={(next) => { if (!next) setViewerFile(null); }}
        cardId={cardId}
        file={viewerFile}
        editorTarget={viewerFile?.target ?? null}
        mode={viewerFile?.mode}
        onCommented={() => onChanged()}
      />
      <FanOutDialog
        open={fanOutOpen}
        onOpenChange={setFanOutOpen}
        cardId={cardId}
        opportunities={index?.opportunities ?? []}
        onFanned={() => { onChanged(); setIndexRefresh((value) => value + 1); }}
      />
      <StrategyRunDialog
        open={strategyRunOpen}
        onOpenChange={setStrategyRunOpen}
        cardId={cardId}
        strategies={strategies}
        runIds={card?.researchStrategies ?? []}
        onStarted={() => { onChanged(); setIndexRefresh((value) => value + 1); }}
      />
    </div>
  );
}

function ExploreDetailBody({ cardId, inboxEventId, inboxEvent, onClose, navigate, card, detail, onChanged }: {
  cardId: string; inboxEventId: string | null; onClose: () => void; navigate: ReturnType<typeof useBbNavigate>;
  inboxEvent: InboxEventSnapshot | null; card: CardItem | null; detail: CardDetailResponse | null; onChanged: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [stages, setStages] = useState<ResearchStrategyOption[]>([]);
  const [comment, setComment] = useState("");
  const [restartWorkerOpen, setRestartWorkerOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [starting, setStarting] = useState(false);
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [viewerFile, setViewerFile] = useState<{ display: string; path: string; target: WorkspaceFileTarget | HostFileTarget | null; mode?: ArtifactViewerMode } | null>(null);
  const inboxEventRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    rpc.call("stageCatalog", {}).then((result) => setStages(result.stages)).catch(() => {});
  }, [rpc]);
  // Viewing a completed card marks its completion seen (read, never
  // resolved): the badge drops, Recent updates keeps the entry.
  useEffect(() => {
    if (card?.status === "completed") void rpc.call("markCardNotificationsRead", { cardId, kind: "completed" }).catch(() => {});
  }, [cardId, card?.status, rpc]);
  useInboxEventFocus(inboxEventId, inboxEvent, inboxEventRef);

  const stageLabel = card?.exploreStage ? (stages.find((entry) => entry.id === card.exploreStage)?.label ?? card.exploreStage) : null;

  async function submitComment() {
    if (!comment.trim()) return;
    const result = await rpc.call("addCardComment", { cardId, target: "card", targetId: cardId, body: comment.trim() });
    if (result.error) {
      toast.error(result.error);
      return;
    }
    setComment("");
    onChanged();
  }

  async function doRetry() {
    setRetrying(true);
    try {
      const result = await rpc.call("retryWorker", { cardId });
      if (!result.ok) toast.error(result.error ?? "Retry failed. Try Restart fresh instead.");
      else toast.success("Worker retried — continuing the exploration.");
      onChanged();
    } finally {
      setRetrying(false);
    }
  }

  const [repairing, setRepairing] = useState(false);
  async function doQualityRepair(lines: string[]) {
    setRepairing(true);
    try {
      const posted = await rpc.call("addCardComment", { cardId, target: "card", targetId: cardId, body: `Repair requested — the Quality section names these failures:\n${lines.map((line) => `- ${line}`).join("\n")}` });
      if (posted.error) {
        toast.error(posted.error);
        return;
      }
      const retried = await rpc.call("retryWorker", { cardId });
      if (!retried.ok) toast.error(retried.error ?? "Repair posted, but resume failed.");
      else toast.success("Repair requested — worker resumed with the failure list.");
      onChanged();
    } finally {
      setRepairing(false);
    }
  }

  async function doStart() {
    setStarting(true);
    try {
      const result = await rpc.call("startWorker", { cardId });
      if (!result.ok) toast.error(result.error ?? "Start failed.");
      else toast.success("Worker started — the exploration is now Doing.");
      onChanged();
    } finally {
      setStarting(false);
    }
  }

  async function doRestartWorker() {
    setRestartWorkerOpen(false);
    setRestarting(true);
    try {
      const result = await rpc.call("restartWorker", { cardId });
      if (!result.ok) toast.error(result.error ?? "Restart failed.");
      else toast.success("Worker restarted — continuing the exploration.");
      onChanged();
    } finally {
      setRestarting(false);
    }
  }

  const pendingFirst = detail?.pendingQuestions?.[0] ?? null;
  const hero = card ? heroFor(card, detail) : null;
  const heroStyle = hero ? HERO_STYLE[hero.kind] : null;
  const presetStale = Boolean(detail && card?.workerThreadId && (detail.card.presetRestartPending || (detail.card.workerPresetId && detail.card.workerPresetId !== detail.card.presetId)));

  return (
    <div className={`stelow-live-surface stelow-detail-surface flex h-full flex-col ${card ? liveBorderClass(card) : ""}`}>
      <div className="flex-1 overflow-auto p-4">
        <div className="mx-auto w-full max-w-3xl space-y-6">
        {card ? (
          <>
            <InboxEventBanner visible={Boolean(inboxEventId) && shouldShowInboxEventBanner(inboxEvent, hero)} event={inboxEvent} sectionRef={inboxEventRef} />
            {hero && heroStyle ? (
              <section aria-label="Exploration status" {...(heroStyle.alert ? { role: "alert" } : {})} className={`rounded-lg border p-4 ${heroStyle.wrap}`}>
                <div className="flex items-start gap-2.5">
                  <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${heroStyle.dot}`} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <h2 className="text-[16px] font-semibold leading-snug tracking-tight text-foreground">{hero.title}</h2>
                    <p className="text-sm leading-relaxed text-muted-foreground">{hero.sub}</p>
                    <p className="pt-1 text-[15px] leading-relaxed text-foreground">{card.prompt}</p>
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <LightweightStatusPills card={card} statusTone={statusTone} columnLabel={RESEARCH_COLUMN_LABELS[researchColumnOf(card)] ?? null} tagLabel={stageLabel} tagTitle="Technique — the focused approach this exploration runs." kind="explore" />
                      {card.workspaceKind === "exploratory" ? <p className="text-xs text-muted-foreground" title={card.workspacePath ?? undefined}>Exploratory work · stored locally</p> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-3">
                      {!card.workerThreadId && card.status !== "completed" && card.status !== "archived" ? (
                        <>
                          <span className="w-full text-xs text-muted-foreground">Not started — parked in Inbox. Nothing runs until you start it.</span>
                          <Button size="sm" disabled={starting} onClick={() => void doStart()} title="Start a worker for this card now.">{starting ? "Starting…" : "Start"}</Button>
                        </>
                      ) : null}
                      {hero.kind === "decision" && pendingFirst ? <span className="w-full text-xs text-muted-foreground">Answer directly below — the first question is open.</span> : null}
                      {hero.kind === "decision" ? <HeroErrorNote card={card} /> : null}
                      {hero.kind === "decision" && card.activity === "error" && card.lastError && !presetStale ? (
                        <Button size="sm" variant="outline" disabled={retrying} onClick={() => void doRetry()} title="Retry the failed worker in place instead of answering — nothing is reset.">{retrying ? "Retrying…" : "Retry worker"}</Button>
                      ) : null}
                      {hero.kind === "decision" && card.workerThreadId ? <OpenThreadButton threadId={card.workerThreadId} /> : null}
                      {hero.kind === "error" && card.workerThreadId ? (
                        <>
                          {presetStale ? <span className="w-full text-xs text-muted-foreground">Preset changed to {detail?.card.presetProviderId}/{detail?.card.presetModelId} — needs a fresh worker.</span> : null}
                          {presetStale ? (
                            <Button size="sm" disabled={restarting} onClick={() => setRestartWorkerOpen(true)} title="Start a fresh worker on the new preset, continuing the exploration.">{restarting ? "Restarting…" : "Restart worker…"}</Button>
                          ) : (
                            <Button size="sm" disabled={retrying} onClick={() => void doRetry()} title="Continue the same worker in place — nothing is reset.">{retrying ? "Retrying…" : "Retry"}</Button>
                          )}
                          <OpenThreadButton threadId={card.workerThreadId} />
                        </>
                      ) : null}
                      {hero.kind === "paused" ? (
                        <>
                          {presetStale ? <span className="w-full text-xs text-muted-foreground">Preset changed to {detail?.card.presetProviderId}/{detail?.card.presetModelId} — needs a fresh worker.</span> : null}
                          {presetStale ? (
                            <Button size="sm" disabled={restarting} onClick={() => setRestartWorkerOpen(true)} title="Start a fresh worker on the new preset, continuing the exploration.">{restarting ? "Restarting…" : "Restart worker…"}</Button>
                          ) : (
                            <Button size="sm" disabled={retrying} onClick={() => void doRetry()} title={card.lastError ? "Retry the failed worker in place — nothing is reset." : "Resume the idle worker in place — nothing is reset."}>{retrying ? "Retrying…" : card.lastError ? "Retry" : "Resume"}</Button>
                          )}
                          <OpenThreadButton threadId={card.workerThreadId} />
                        </>
                      ) : null}
                      {(hero.kind === "working" || hero.kind === "calm") && card.workerThreadId && !(hero.kind === "calm" && card.activity === "idle" && card.workerThreadId && card.status !== "completed" && card.status !== "archived") ? (
                        <OpenThreadButton threadId={card.workerThreadId} />
                      ) : null}
                      {hero.kind === "calm" && card.activity === "idle" && card.workerThreadId && card.status !== "completed" && card.status !== "archived" ? (
                        <>
                          {presetStale ? <span className="w-full text-xs text-muted-foreground">Preset changed to {detail?.card.presetProviderId}/{detail?.card.presetModelId} — needs a fresh worker.</span> : null}
                          {presetStale ? (
                            <Button size="sm" disabled={restarting} onClick={() => setRestartWorkerOpen(true)} title="Start a fresh worker on the new preset, continuing the exploration.">{restarting ? "Restarting…" : "Restart worker…"}</Button>
                          ) : (
                            <Button size="sm" disabled={retrying} onClick={() => void doRetry()} title="Continue the same worker in place — nothing is reset.">{retrying ? "Retrying…" : "Resume"}</Button>
                          )}
                          <OpenThreadButton threadId={card.workerThreadId} />
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
                {pendingFirst ? (
                  <div className="mt-3 space-y-2 border-t border-amber-500/20 pt-3">
                    <QuestionBatch cardId={card.id} mode="live" questions={detail?.pendingQuestions.map((q) => ({ id: q.id, title: q.title, prompt: q.question, multiple: q.multiple, kind: q.kind, options: q.options, staleness: q.staleness ?? null })) ?? []} onAnswered={() => onChanged()} />
                  </div>
                ) : null}
                {detail && detail.expiredQuestions.length > 0 ? <div className="mt-3 border-t border-amber-500/20 pt-3"><ExpiredQuestionsSection cardId={card.id} questions={detail.expiredQuestions} onOpenArtifact={(a, mode) => openAskArtifact(card, detail.fileEnvironmentId, setViewerFile, a, mode)} onAnswered={() => onChanged()} /></div> : null}
              </section>
            ) : null}

            <WorkerSection
              card={card}
              detail={detail}
              presetStale={presetStale}
              restarting={restarting}
              onRestartWorker={() => setRestartWorkerOpen(true)}
              onPreset={() => setPresetDialogOpen(true)}
              presetPill={<>Explore · {detail?.card.presetName ?? "default"}</>}
              presetNote={<>Applies to the next worker — Resume keeps the current one.</>}
              pillTitle="Preset for the next worker"
              checkoutNote={checkoutNoteFor(detail?.card.environmentLabel)}
            />

            <InputFiles card={card} detail={detail} onView={(file) => setViewerFile(file)} />

            <PreviewSection cardId={card.id} />

            <ExploreQualitySection cardId={card.id} filePath={detail?.artifacts.map((item) => item.path).find((itemPath) => card?.exploreStage != null && itemPath.endsWith(`explore-${card.exploreStage}.md`)) ?? null} repairing={repairing} onRepair={(lines) => void doQualityRepair(lines)} />

            <CardDisclosure title="Artifacts" hint={detail ? `${detail.artifacts.length} files` : "being prepared"} defaultOpen>
              {detail ? (
                <ArtifactGroups
                  artifacts={detail.artifacts}
                  workspaceKind={card.workspaceKind}
                  fileEnvironmentId={detail.fileEnvironmentId}
                  onView={(file) => setViewerFile(file)}
                  groupTitleForStage={() => stageLabel ?? "Exploration"}
                />
              ) : <p className="text-xs text-muted-foreground">Loading…</p>}
            </CardDisclosure>

            <CardConversation comments={detail?.comments ?? []} draft={comment} onDraftChange={setComment} onSend={() => void submitComment()} defaultOpen={hero?.kind === "decision"} threadId={card?.workerThreadId ?? null} />

          </>
        ) : null}
        </div>
      </div>
      <ConfirmActionDialog
        open={restartWorkerOpen}
        onOpenChange={setRestartWorkerOpen}
        title="Restart the worker on the current preset?"
        description="Stops the running worker and starts a fresh one on this card's preset, continuing the exploration (not from scratch). Use this to apply a preset change."
        confirmLabel="Restart worker"
        confirmTone="default"
        onConfirm={doRestartWorker}
      />
      <PresetAssignDialog
        open={presetDialogOpen}
        onOpenChange={setPresetDialogOpen}
        cardId={cardId}
        onChanged={onChanged}
      />
      <ArtifactViewerDialog
        open={viewerFile !== null}
        onOpenChange={(next) => { if (!next) setViewerFile(null); }}
        cardId={cardId}
        file={viewerFile}
        editorTarget={viewerFile?.target ?? null}
        mode={viewerFile?.mode}
        onCommented={onChanged}
      />
    </div>
  );
}

function CardDetailBody({ cardId, inboxEventId, onClose, onBack, navigate }: { cardId: string; inboxEventId: string | null; onClose: () => void; onBack?: () => void; navigate: ReturnType<typeof useBbNavigate> }) {
  const rpc = useRpc<typeof rpcContract>();
  const [card, setCard] = useState<CardItem | null>(null);
  const [detail, setDetail] = useState<CardDetailResponse | null>(null);
  const [detailRefresh, setDetailRefresh] = useState(0);
  const [comment, setComment] = useState("");
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
  const [githubCloseIssue, setGithubCloseIssue] = useState(false);
  const [githubPosting, setGithubPosting] = useState(false);
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

  async function submitComment() {
    if (!comment.trim()) return;
    const result = await rpc.call("addCardComment", { cardId, target: "card", targetId: cardId, body: comment.trim() });
    if (result.error) {
      toast.error(result.error);
      return;
    }
    setComment("");
    await load();
  }

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

  // Leaving the Inbox is what starts a parked card: the same start path the
  // board's drag uses, so the card never claims to be running without a
  // worker behind it.
  async function doStart() {
    setStarting(true);
    try {
      const result = await rpc.call("startWorker", { cardId });
      if (!result.ok) toast.error(result.error ?? "Start failed.");
      else toast.success("Worker started — the card moved from Inbox and is triaging.");
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

  async function doGithubPost() {
    setGithubPosting(true);
    try {
      const result = await rpc.call("postGithubCompletion", { cardId, closeIssue: githubCloseIssue });
      if (!result.ok) {
        toast.error(result.error ?? "Could not post to GitHub.");
        // Reload anyway: the comment may have posted even when the close
        // failed, and the card should show the posted state immediately.
        await load();
        return;
      }
      setGithubPostOpen(false);
      toast.success(githubCloseIssue ? "Summary posted and issue closed on GitHub." : "Completion summary posted on GitHub.");
      await load();
    } finally {
      setGithubPosting(false);
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
  const scopeDone = detail?.scopes.filter((s) => ["done", "completed"].includes(s.status ?? "")).length ?? 0;
  const scopeTotal = detail?.scopes.length ?? 0;
  const openScope = detail?.scopes.find((s) => s.status === "in-progress") ?? null;
  const artifactTotal = detail?.artifacts.length ?? 0;
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
    ? pendingQuestionArtifact ?? detail.artifacts.find((artifact) => artifact.stage === (GATE_ARTIFACT_STAGE[card.stage] ?? "")) ?? detail.artifacts[detail.artifacts.length - 1] ?? null
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
      />
      <div className="flex-1 overflow-auto p-4">
        <div className="mx-auto w-full max-w-3xl space-y-6">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {card && card.kind === "research" ? (
          <ResearchDetailBody cardId={cardId} inboxEventId={inboxEventId} inboxEvent={inboxEvent} onClose={onClose} navigate={navigate} card={card} detail={detail} onChanged={() => void load()} />
        ) : null}
        {card && card.kind === "explore" ? (
          <ExploreDetailBody cardId={cardId} inboxEventId={inboxEventId} inboxEvent={inboxEvent} onClose={onClose} navigate={navigate} card={card} detail={detail} onChanged={() => void load()} />
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
                    <div className="flex flex-wrap items-center gap-2 pt-3">
                      {!card.workerThreadId && card.status !== "completed" && card.status !== "archived" ? (
                        <>
                          <span className="w-full text-xs text-muted-foreground">Not started — parked in Inbox. Nothing runs until you start it.</span>
                          <Button size="sm" disabled={starting} onClick={() => void doStart()} title="Start a worker for this card now.">{starting ? "Starting…" : "Start"}</Button>
                        </>
                      ) : null}
                      {hero.kind === "decision" && pendingFirst ? <span className="w-full text-xs text-muted-foreground">Answer directly below — the first question is open.</span> : null}
                      {hero.kind === "decision" ? <HeroErrorNote card={card} /> : null}
                      {hero.kind === "decision" && card.activity === "error" && card.lastError && !presetStale ? (
                        <Button size="sm" variant="outline" disabled={retrying} onClick={() => void doRetry()} title="Retry the failed worker in place instead of answering — nothing is reset.">{retrying ? "Retrying…" : "Retry worker"}</Button>
                      ) : null}
                      {hero.kind === "decision" && card.workerThreadId ? <OpenThreadButton threadId={card.workerThreadId} /> : null}
                      {hero.kind === "decision" && reviewTarget ? (
                        <span className="w-full">
                          <Button size="sm" variant="outline" onClick={() => setViewerFile({ display: reviewTarget.display, path: reviewTarget.path, target: fileLinkTarget(card.workspaceKind === "exploratory", detail?.fileEnvironmentId ?? null, reviewTarget.relPath, reviewTarget.hostId, reviewTarget.path), mode: "review" })} title={`Read ${reviewTarget.display} before deciding`}>Review {reviewTarget.display} ↗</Button>
                        </span>
                      ) : null}
                      {hero.kind === "error" && card.workerThreadId ? (
                        <>
                          {presetStale ? <span className="w-full text-xs text-muted-foreground">Preset changed to {detail?.card.presetProviderId}/{detail?.card.presetModelId} — needs a fresh worker.</span> : null}
                          {presetStale ? (
                            <Button size="sm" disabled={restarting} onClick={() => setRestartWorkerOpen(true)} title="Start a fresh worker on the new preset, continuing from the current stage.">{restarting ? "Restarting…" : "Restart worker…"}</Button>
                          ) : (
                            <Button size="sm" disabled={retrying} onClick={() => void doRetry()} title="Continue the same worker in place from the current stage — nothing is reset.">{retrying ? "Retrying…" : "Retry"}</Button>
                          )}
                          <OpenThreadButton threadId={card.workerThreadId} />
                        </>
                      ) : null}
                      {hero.kind === "paused" ? (
                        <>
                          {presetStale ? <span className="w-full text-xs text-muted-foreground">Preset changed to {detail?.card.presetProviderId}/{detail?.card.presetModelId} — needs a fresh worker.</span> : null}
                          {presetStale ? (
                            <Button size="sm" disabled={restarting} onClick={() => setRestartWorkerOpen(true)} title="Start a fresh worker on the new preset, continuing from the current stage.">{restarting ? "Restarting…" : "Restart worker…"}</Button>
                          ) : (
                            <Button size="sm" disabled={retrying} onClick={() => void doRetry()} title={card.lastError ? "Retry the failed worker in place from the current stage — nothing is reset." : "Resume the idle worker in place from the current stage — nothing is reset."}>{retrying ? "Retrying…" : card.lastError ? "Retry" : "Resume"}</Button>
                          )}
                          <OpenThreadButton threadId={card.workerThreadId} />
                        </>
                      ) : null}
                      {(hero.kind === "working" || hero.kind === "calm") && card.workerThreadId && !(hero.kind === "calm" && card.activity === "idle" && card.workerThreadId && card.status !== "completed" && card.status !== "archived") ? (
                        <OpenThreadButton threadId={card.workerThreadId} />
                      ) : null}
                      {hero.kind === "calm" && card.activity === "idle" && card.workerThreadId && card.status !== "completed" && card.status !== "archived" ? (
                        <>
                          {presetStale ? <span className="w-full text-xs text-muted-foreground">Preset changed to {detail?.card.presetProviderId}/{detail?.card.presetModelId} — needs a fresh worker.</span> : null}
                          {presetStale ? (
                            <Button size="sm" disabled={restarting} onClick={() => setRestartWorkerOpen(true)} title="Start a fresh worker on the new preset, continuing from the current stage.">{restarting ? "Restarting…" : "Restart worker…"}</Button>
                          ) : (
                            <Button size="sm" disabled={retrying} onClick={() => void doRetry()} title="Continue the same worker in place from the current stage — nothing is reset.">{retrying ? "Retrying…" : "Resume"}</Button>
                          )}
                          <OpenThreadButton threadId={card.workerThreadId} />
                        </>
                      ) : null}
                    </div>
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
                      <button onClick={() => { setGithubCloseIssue(false); setGithubPostOpen(true); }} className="cursor-pointer min-h-11 font-medium text-primary hover:underline">Share completion summary on GitHub…</button>
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
            <CardDisclosure
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
              {detail && detail.scopes.length > 0 ? <><ScopeProgress scopes={detail.scopes} /><ScopesList scopes={detail.scopes} /></> : <p className="text-xs text-muted-foreground">{archivedPresentation?.workflow.emptyScopes ?? (card?.status === "completed" ? "Completed without scoped execution." : "No scopes broken down yet — the agent is still shaping the card.")}</p>}
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
            </CardDisclosure>

            {/* Gaps live on the mother card: every escalation names its
                audit-gap scope status, and blocked done states name the fix.
                Renders nothing before the first execution critique. */}
            <BuildGapsSection cardId={card.id} />

            {/* The map is a reference, not card state: it sits beside the
                progress section (same heading shape, same stage names) so
                neither has to pretend to be the other. */}
            <WorkflowMap open={mapOpen} onToggle={setMapOpen} />

            <div ref={artifactsRef}>
            <CardDisclosure
              title="Artifacts"
              hint={detail ? `${detail.artifacts.length} files · audit trail${detail.artifacts.some((artifact) => artifact.stage === "unregistered") ? " · some unregistered" : ""}` : "produced files"}
              open={artifactsOpen}
              onToggle={setArtifactsOpen}
            >
              {card.status === "completed" ? <AuditTrailStatusRow cardId={card.id} /> : null}
              {detail ? (
                <ArtifactGroups
                  artifacts={detail.artifacts}
                  workspaceKind={card.workspaceKind}
                  fileEnvironmentId={detail.fileEnvironmentId}
                  onView={(file) => setViewerFile(file)}
                  groupTitleForStage={artifactGroupTitle}
                />
              ) : <p className="text-xs text-muted-foreground">Loading…</p>}
            </CardDisclosure>
            </div>

            {/* Diff is the pre-completion review instrument (uncommitted work at
                the gates). Once completed, Git changes owns history via the
                commit viewer — except when the tree went dirty again without
                reopening: then pending changes are reviewable here while the
                commit action lives in Git changes. Evaluate in Diff, act in
                Git changes. */}
            {card && ((card.status !== "completed" && (card.stage === "diff-gate" || card.stage === "audit")) || (card.status === "completed" && publication?.workingTree?.hasUncommittedChanges) || (card.status === "completed" && workspaceRecovery?.kind === "attached")) ? (
            <CardDisclosure
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
            </CardDisclosure>
            ) : null}

            {card.status === "completed" ? (
              <CardDisclosure
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
                        return (
                          <div>
                            <p className="text-emerald-900/80 dark:text-emerald-100/80">{!savedSha && !publication.workingTree?.hasUncommittedChanges ? "Nothing saved yet." : !savedSha ? `${files} uncommitted changes on ${publication.branch?.current ?? "this branch"} — save them first.` : `${files} new changes since ${savedSha.slice(0, 7)}.`}</p>
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
                      <details className="group border-t pt-3">
                        <summary className="flex cursor-pointer items-center gap-1.5 font-medium text-foreground"><DisclosureChevron />Advanced Git operations</summary>
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
                          <Button size="sm" variant="outline" disabled={!publication.capabilities.markReady.available} title={publication.capabilities.markReady.reason ?? "Mark this pull request ready for review"} onClick={() => setPublicationAction("ready")}>Mark ready…</Button>
                          <Button size="sm" variant="outline" disabled={!publication.capabilities.markDraft.available} title={publication.capabilities.markDraft.reason ?? "Convert this pull request to draft"} onClick={() => setPublicationAction("draft")}>Mark draft…</Button>
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
              </CardDisclosure>
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
      <Dialog open={githubPostOpen} onOpenChange={setGithubPostOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share completion summary on GitHub?</DialogTitle>
            <DialogDescription className="space-y-2">
              <p>
                Posts a factual summary (scopes, tasks, prompt) as a comment on {detail?.githubLink ? `${detail.githubLink.repo}#${detail.githubLink.number}` : "the linked issue"}. Nothing is posted automatically — only this action writes back.
              </p>
            </DialogDescription>
          </DialogHeader>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 cursor-pointer" checked={githubCloseIssue} onChange={(event) => setGithubCloseIssue(event.target.checked)} />
            <span>Also close the issue on GitHub</span>
          </label>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={githubPosting}>Cancel</Button>
            </DialogClose>
            <Button disabled={githubPosting} onClick={() => void doGithubPost()}>{githubPosting ? "Posting…" : "Post summary"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

  app.slots.messageDirective({
    id: "stelow-artifact",
    component: StelowArtifactDirective,
  });

  app.slots.messageDirective({
    id: "stelow-quality",
    component: StelowQualityDirective,
  });
});

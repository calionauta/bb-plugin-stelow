import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Markdown,
  experimental_SourceCode as SourceCode,
  definePluginApp,
  UrlLink,
  experimental_Diff as DiffView,
  experimental_FileLink as FileLink,
  experimental_NewThreadComposer as NewThreadComposer,
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
import { INBOX_EVENT_LABELS, inboxEventPresentation, isOpenInboxAction } from "./lib/inbox-event-presentation.mjs";
import { researchColumnForStatus } from "./lib/card-question-state.mjs";
import { parseResearchIndexSections, stripResearchOpportunities } from "./lib/research-index-sections.mjs";
import { STAGE_SEQUENCE, groupArtifactsByStage } from "./lib/artifact-groups.mjs";
import { STAGE_BANDS } from "./lib/stage-bands.mjs";
import { normalizeAskArtifactPath } from "./lib/question-batch.mjs";
import { LIGHTWEIGHT_COLUMNS, LIGHTWEIGHT_COLUMN_LABELS } from "./lib/tracks.mjs";
import { workerActionPolicy } from "./lib/worker-action-policy.mjs";
import type { rpcContract } from "./server";
import { Button } from "@/components/ui/button";
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

type GithubStatus = {
  ok: boolean;
  pluginAvailable: boolean;
  ghOk: boolean;
  repos: Array<{ repo: string; projectId: string | null }>;
};

type GithubCandidate = {
  repo: string;
  number: number;
  title: string;
  labels: string[];
  author: string;
  assignees: string[];
  url: string;
  body: string;
  updatedAt: string;
  projectId: string | null;
  alreadyImported: boolean;
  cardId: string | null;
  cardName: string | null;
};

const INTENT_LABEL: Record<string, string> = {
  "new-product": "New product",
  feature: "Feature",
  bugfix: "Bug fix",
  refactor: "Refactor",
  investigate: "Investigate",
};

// Map a tagged GitHub issue onto a Stelow intent from its labels/title. Falls
// back to investigate (the permissive triage intent). This is a heuristic the
// user can correct on the card afterwards via updateCardIntent.
function githubIntentFor(issue: { labels: string[]; title: string }): "new-product" | "feature" | "bugfix" | "refactor" | "investigate" | "unknown" {
  const lower = [...issue.labels, issue.title].join(" ").toLowerCase();
  if (/\bbugs?\b|\bdefects?\b|\bregression\b/.test(lower)) return "bugfix";
  if (/\brefactor\b|\bclean(up)?\b|\bdebt\b|\bsimplify\b/.test(lower)) return "refactor";
  if (/\bfeature\b|\benhancement\b|\bfeat\b|\bnew\b/.test(lower)) return "feature";
  if (/\bnew\s+product\b|\bproduct\b/.test(lower)) return "new-product";
  return "investigate";
}

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

const STAGE_LABELS: Record<string, string> = {
  triage: "Triage",
  select: "Pick intent",
  setup: "Setup",
  context: "Context",
  shape: "Shape proposal",
  critique: "Critique",
  gate: "Product gate",
  scope: "Scope",
  interface: "Interface",
  "int-gate": "Interface gate",
  selection: "Interface selection",
  planning: "Tech planning",
  "plan-gate": "Plan gate",
  execution: "Execution",
  verification: "Verification",
  "diff-gate": "Diff gate",
  audit: "Audit",
  research: "Research",
};

// What each stage produces / does, for the confirmation preview before advancing.
const STAGE_PRODUCES: Record<string, string> = {
  triage: "Reviews the current state and picks what to work on next.",
  select: "Chooses an item / group from the triage inbox to turn into a workflow.",
  setup: "Prepares the repo and environment the workflow will run in.",
  context: "Gathers project context the shaping step needs.",
  shape: "Writes a Shape Up proposal (spec-product_vN.md) for the chosen item.",
  critique: "Challenges the proposal before it is gated.",
  gate: "Product gate: decides whether the shaped idea is accepted, rejected, or reworked.",
  scope: "Breaks the approved idea into a concrete scope of work.",
  interface: "Designs the user-facing interface for the scope.",
  "int-gate": "Interface gate: accepts, rejects, or reworks the interface design.",
  selection: "Selects which interface variant to implement.",
  planning: "Writes the technical plan (PLAN.md) from the interface and scope.",
  "plan-gate": "Plan gate: accepts, rejects, or reworks the tech plan.",
  execution: "Implements the plan across the defined scope.",
  verification: "Verifies the implementation against the plan.",
  "diff-gate": "Diff gate: checks the implementation diff before completion.",
  audit: "Final audit of the finished work.",
};

// Canonical linear order of the 17 workflow stages (mirrors stages.yaml). The
// timeline uses this to give position (passed / current / upcoming); legal
// transitions still come from nextStages (parsed from transitions.md).
// Single-sourced from lib/artifact-groups (which also ranks artifact groups)
// so the two never drift apart.
// Which phase (band) each stage belongs to — shown as a visual group label on
// the timeline. Derived from lib/stage-bands.mjs (single source shared with
// the server); they are an aggregation of stages, not a rival axis.
const STAGE_BAND: Record<string, string> = Object.fromEntries(
  Object.entries(STAGE_BANDS).flatMap(([band, stages]) => stages.map((stage) => [stage, band])),
);
const BAND_LABEL: Record<string, string> = { analysis: "Analyse", planning: "Plan", execution: "Execute", review: "Review", research: "Research" };
// Board columns ARE the workflow phases + terminals. Active cards sit in the
// column of their current phase (STAGE_BAND[stage]); a card is a board column,
// not a status. Terminals: completed / archived. Blocked was removed because
// stelow never records a card-level blocked status (only scope/task-level
// dependencies).
const BOARD_COLUMNS = ["analysis", "planning", "execution", "review", "completed", "archived"] as const;
const COLUMNS = BOARD_COLUMNS;
const COLUMN_LABELS: Record<string, string> = {
  analysis: BAND_LABEL.analysis,
  planning: BAND_LABEL.planning,
  execution: BAND_LABEL.execution,
  review: BAND_LABEL.review,
  completed: "Done",
  archived: "Archived",
};
// Which board column a card belongs to: terminal for archived/completed,
// otherwise its stage's phase.
function boardColumnOf(card: Pick<CardItem, "status" | "stage">): string {
  if (card.status === "archived" || card.status === "completed") return card.status;
  return STAGE_BAND[card.stage] ?? "analysis";
}

// Lightweight-track columns (Research + Explore share them): a deliberately
// dumb To-Do / Doing / Done flow. Canonical in lib/tracks (shared with the
// server via lib/card-move) — these aliases keep existing call sites stable.
// Statuses reuse the shared enum (pending / in-progress / completed /
// archived) so no migration or guard changes are needed; the mapping lives
// in lib/card-question-state (shared with the server) so a waiting question
// — activity, never status — can never push a Doing card back to To-Do.
const RESEARCH_COLUMNS = LIGHTWEIGHT_COLUMNS as unknown as readonly ["todo", "doing", "done", "archived"];
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

function stageLabel(stage: string) {
  return STAGE_LABELS[stage] ?? stage;
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

function activityLabel(activity: CardItem["activity"]) {
  if (activity === "idle") return "Paused";
  if (activity === "running") return "Working";
  if (activity === "awaiting-answer") return "Waiting for you";
  if (activity === "error") return "Failed";
  return activity;
}

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

function Pill({ children, tone = "bg-muted text-muted-foreground", className = "", title }: { children: React.ReactNode; tone?: string; className?: string; title?: string }) {
  return <span title={title} className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${tone} ${className}`}>{children}</span>;
}

// Build cards show board column + workflow status — except at terminals,
// where both resolve to the same word ("Archived Archived"). One pill then.
function BuildStatusPills({ card }: { card: CardItem }) {
  const column = COLUMN_LABELS[boardColumnOf(card)] ?? statusLabel(card.status);
  const status = statusLabel(card.status);
  if (column === status) {
    return <Pill className="ml-2 shrink-0" tone={statusTone(card.status)} title="Board status — this card's current state."><span className="mr-1">{statusGlyph(card.status)}</span>{status}</Pill>;
  }
  return (<>
    <Pill className="ml-2 shrink-0" tone={statusTone(card.status)} title="Board column — where this card sits in the build flow.">{column}</Pill>
    <Pill className="ml-1 shrink-0" tone={statusTone(card.status)} title="Workflow status — the card's specific execution state."><span className="mr-1">{statusGlyph(card.status)}</span>{status}</Pill>
  </>);
}

// given a distinct (dashed) visual so it reads as "suspended/transient", never
// as a competing solid state. Repose (idle with nothing pending) renders
// nothing: a paused worker is the normal resting state, not an alert.
const ACTIVITY_PILL_CLASS: Record<string, string> = {
  running: "stelow-activity-working",
  "awaiting-answer": "stelow-activity-waiting",
  error: "stelow-activity-error",
};
const ACTIVITY_GLYPH: Record<string, string> = {
  running: "●",
  "awaiting-answer": "⏳",
  error: "✗",
};
const ACTIVITY_TITLE: Record<string, string> = {
  running: "Worker is actively working",
  "awaiting-answer": "Waiting for your answer",
  error: "Worker failed. Needs attention.",
};

function ActivityPill({ activity }: { activity: CardItem["activity"] }) {
  const cls = ACTIVITY_PILL_CLASS[activity];
  if (!cls) return null; // idle (repose) renders nothing
  return (
    <span className={`stelow-activity-pill ${cls}`} title={ACTIVITY_TITLE[activity]}>
      <span aria-hidden>{ACTIVITY_GLYPH[activity]}</span>
      {activityLabel(activity)}
    </span>
  );
}

const DEBOUNCE_MS = 250;

const APPETITE_OPTIONS = [
  { value: "Lean", label: "Lean", description: "Smallest useful cycle: 1–2 scopes and one direct direction." },
  { value: "Core", label: "Core", description: "Standard cycle: main job, obvious edge cases, and 3–5 scopes." },
  { value: "Complete", label: "Complete", description: "Broad exploration and deeper validation across the whole request." },
] as const;

const REVIEW_MODE_OPTIONS = [
  { value: "Auto", label: "Auto", description: "The agent resolves gaps and proceeds without review gates." },
  { value: "Product Spec Gate", label: "Product Spec Gate", description: "Review the shaped product specification." },
  { value: "Product Spec + Interface Gates", label: "Product Spec + Interface Gates", description: "Review the product specification and interface direction." },
  { value: "Product Spec + Interface + Scopes", label: "Product Spec + Interface + Scopes", description: "Also confirm the planned build scopes." },
  { value: "Product Spec + Interface + Tech Review", label: "Product Spec + Interface + Tech Review", description: "Add technical-plan review before execution." },
  { value: "Product Spec + Interface + Tech Review + Code Diff", label: "Product Spec + Interface + Tech Review + Code Diff", description: "Use every review gate, including the final code diff." },
] as const;

type Appetite = (typeof APPETITE_OPTIONS)[number]["value"];
type ReviewMode = (typeof REVIEW_MODE_OPTIONS)[number]["value"];

// Unified attention: ONE flag (needsAttention) + the reason (kind). All four
// Attention label derived from the card's own activity/status — no separate
// kind enum. One flag (needsAttention) says "a human is needed"; the label
// comes from state the card already carries.
function attentionLabel(card: CardItem): string {
  if (card.activity === "awaiting-answer") return "Answer required";
  if (card.activity === "error") return "Worker failed";
  return "Paused. Resume it.";
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
      // Badge = new things for you: unresolved actions plus unseen recent
      // completions. Seen completions stay in Recent updates; resolved and
      // archived items never count.
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

function StelowInboxSidebarAccessory() {
  const { count, tone } = useInboxAccessory();
  return <SidebarCount count={count} tone={tone} label={`${count} Stelow Inbox items need attention`} />;
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
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Background refreshes must never flash loading UI (see BoardPanel).
  const firstLoadRef = useRef(true);
  const load = useCallback(async () => {
    if (firstLoadRef.current) setLoading(true);
    try {
      setNotifications((await rpc.call("listNotifications", { includeArchived: showArchived })).notifications);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load Stelow Inbox.");
    }
    finally { setLoading(false); firstLoadRef.current = false; }
  }, [rpc, showArchived]);
  useEffect(() => { void load(); }, [load]);
  useDebouncedRealtime(["card-state", "inbox-changed"], () => void load());
  const action = notifications.filter((entry) => entry.archivedAt === null && entry.resolvedAt === null && ["question", "error", "paused"].includes(entry.kind));
  const updates = notifications.filter((entry) => entry.archivedAt === null && entry.kind === "completed");
  const resolved = notifications.filter((entry) => entry.archivedAt === null && entry.resolvedAt !== null && ["question", "error", "paused"].includes(entry.kind));
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
              <span className="min-w-0"><span className="flex flex-wrap items-center gap-x-2"><strong className="text-sm">{entry.cardName}</strong>{!entry.readAt ? <span className="size-1.5 rounded-full bg-primary"><span className="sr-only">Unread</span></span> : null}</span><span className="mt-0.5 block text-sm text-muted-foreground">{inboxEventText(entry)}</span><span className="mt-1 block text-xs text-muted-foreground" title={new Date(inboxEventPresentation(entry).stateAt).toLocaleString()}>{entry.projectName} · {inboxEventTime(entry)}</span></span>
            </button>
            <button onClick={() => void (entry.archivedAt ? restore(entry) : archive(entry))} className="cursor-pointer min-h-11 shrink-0 rounded-md px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{entry.archivedAt ? "Restore" : "Archive"}</button>
          </div>;
        })}
      </div>
    </section>
  );
  const archived = notifications.filter((entry) => entry.archivedAt !== null);
  // No blank on reload: first mount skeletons, later polls keep stale
  // content with a quiet updating hint instead of flashing.
  const firstLoad = loading && notifications.length === 0;
  const fatalError = loadError && notifications.length === 0;
  return <div className="h-full overflow-auto bg-background p-4 md:p-6"><div className="mx-auto max-w-4xl space-y-5"><header className="flex items-start justify-between gap-3"><div><h1 className="text-xl font-semibold tracking-tight">Inbox</h1><p className="mt-1 text-sm text-muted-foreground">Work that needs you, plus recent completions. Batched questions answer in one sitting.{loading && !firstLoad ? " Updating…" : ""}</p></div><button onClick={() => setShowArchived((value) => !value)} className="cursor-pointer min-h-11 rounded-md border px-3 text-sm font-medium hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><Icon name="Archive" className="mr-1 inline h-4 w-4" aria-hidden />{showArchived ? "Back to Inbox" : "View archived"}</button></header>{firstLoad ? <PanelSkeleton rows={3} /> : fatalError ? <section className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm"><p>{loadError}</p><button onClick={() => void load()} className="cursor-pointer mt-3 min-h-11 rounded-md border px-3 text-sm font-medium hover:bg-background">Retry</button></section> : showArchived ? <><Section title="Archived" entries={archived} />{!archived.length ? <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No archived notifications.</p> : null}</> : <><Section title={`Needs you${action.length ? ` (${action.length})` : ""}`} entries={action} /><Section title="Recent updates" entries={updates} />{!action.length && !updates.length ? <section className="rounded-md border border-dashed bg-muted/30 p-8 text-center"><h2 className="text-sm font-semibold">All clear</h2><p className="mt-1 text-sm text-muted-foreground">Stelow will surface work when it needs you.</p></section> : null}{resolved.length ? <details className="rounded-md border"><summary className="min-h-11 cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Resolved ({resolved.length}) — answered or cleared automatically</summary><div className="px-3 pb-3"><Section title="Resolved" entries={resolved} /></div></details> : null}</>}</div></div>;
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
  const [createOptionsOpen, setCreateOptionsOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [intent, setIntent] = useState<"new-product" | "feature" | "bugfix" | "refactor" | "investigate" | "unknown">("unknown");
  const [appetite, setAppetite] = useState<Appetite>("Lean");
  const [reviewMode, setReviewMode] = useState<ReviewMode>("Auto");
  const [filterProjectId, setFilterProjectId] = useState<string | "all">("all");
  const [filterStage, setFilterStage] = useState<string>("all");
  const [filterIntent, setFilterIntent] = useState<string | "all">("all");
  const [filterStatus, setFilterStatus] = useState<string | "all">("all");
  const [filterActivity, setFilterActivity] = useState<string | "all">("all");
  const [filterAttention, setFilterAttention] = useState(false);
  const [viewMode, setViewMode] = useState<"board" | "list">("board");
  const [boardPresets, setBoardPresets] = useState<PresetManagerPreset[]>([]);
  const [boardBandPresets, setBoardBandPresets] = useState<{ band: string; presetId: string | null; stages: string[] }[]>([]);
  const [boardPresetsOpen, setBoardPresetsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importLabel, setImportLabel] = useState("stelow-work");
  const [importCandidates, setImportCandidates] = useState<GithubCandidate[]>([]);
  const [importSelected, setImportSelected] = useState<Record<string, boolean>>({});
  const [importAllLabels, setImportAllLabels] = useState<string[]>([]);
  const [importAllAssignees, setImportAllAssignees] = useState<string[]>([]);
  const [importAssignee, setImportAssignee] = useState<string>("all");
  const [importBusy, setImportBusy] = useState(false);
  const [githubStatus, setGithubStatus] = useState<GithubStatus | null>(null);

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
  useDebouncedRealtime(["card-state", "board-changed"], () => void load(boardProjectId ?? routeProjectId));
  useEffect(() => {
    void rpc.call("boardWorkflowDefaults", {}).then(({ appetite: savedAppetite, reviewMode: savedReviewMode }) => {
      setAppetite(savedAppetite);
      setReviewMode(savedReviewMode);
    }).catch(() => {
      /* Keep Lean/Auto when stored preferences cannot be read. */
    });
  }, [rpc]);

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
    try {
      const result = await rpc.call("createCard", { projectId: targetProjectId, environment: request.environment, prompt, attachments, intent, appetite, reviewMode });
      setPrompt("");
      setCreateBuildOpen(false);
      navigate.openThreadPanel({ actionId: "stelow-card-detail", title: result.cardId, params: { cardId: result.cardId } });
      toast.success("Card started in Triage. Stelow will triage it.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to start the card.");
      throw error;
    }
  }

  async function moveCard(cardId: string, target: string) {
    if (!(COLUMNS as readonly string[]).includes(target)) return;
    const result = await rpc.call("moveCard", { cardId, status: target as "analysis" | "planning" | "execution" | "review" | "completed" | "archived" });
    if (!result.ok) toast.error(result.error ?? "Move failed");
  }

  async function listGithubIssues() {
    setImportBusy(true);
    setImportCandidates([]);
    setImportSelected({});
    try {
      const result = await rpc.call("listGithubCandidates", { label: importLabel.trim() });
      setImportCandidates(result.issues);
      setImportAllLabels(result.allLabels);
      setImportAllAssignees(result.allAssignees);
      // Preselect only issues not yet imported, so the flow is a one-click
      // "bring in everything tagged" rather than a long checklist.
      const fresh: Record<string, boolean> = {};
      for (const issue of result.issues) if (!issue.alreadyImported) fresh[`${issue.repo}#${issue.number}`] = true;
      setImportSelected(fresh);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to list GitHub issues.");
    } finally {
      setImportBusy(false);
    }
  }

  // Client-side assignee narrowing over the label-filtered candidates.
  const importVisible = importAssignee === "all"
    ? importCandidates
    : importCandidates.filter((issue) => (issue.assignees ?? []).includes(importAssignee));

  async function importSelectedIssues() {
    const chosen = importVisible.filter((issue) => importSelected[`${issue.repo}#${issue.number}`]);
    if (chosen.length === 0) return toast.error("No issues selected.");
    setImportBusy(true);
    let imported = 0;
    for (const issue of chosen) {
      try {
        // The server resolves each issue's owning project from its repo; no
        // project picker needed. If it cannot, the import reports that per-issue.
        const result = await rpc.call("importGithubIssue", { repo: issue.repo, number: issue.number, label: importLabel.trim(), intent: githubIntentFor(issue) });
        if (result.ok) imported += 1;
      } catch (error) {
        toast.error(`Issue ${issue.repo}#${issue.number}: ${error instanceof Error ? error.message : "import failed"}`);
      }
    }
    setImportBusy(false);
    setImportOpen(false);
    if (imported > 0) {
      toast.success(`Imported ${imported} issue${imported === 1 ? "" : "s"} into Stelow Triage.`);
      void load(boardProjectId ?? routeProjectId);
    }
  }

  return (
    <div className="flex h-full overflow-hidden bg-background">
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto max-w-[1500px] space-y-4">
          {loading && cards.length === 0 ? <TrackSkeleton /> : <>
          <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight">Build</h1>
              <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">Carry ideas from triage through shaping, gated reviews, and scope-by-scope execution.</p>
              {inbox.length > 0 ? <button type="button" onClick={() => setFilterAttention(true)} className="mt-0.5 inline-flex min-h-11 cursor-pointer items-center text-xs text-amber-700 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary dark:text-amber-300" aria-label={`Show the ${inbox.length} card${inbox.length === 1 ? "" : "s"} that need attention`}>
                {inbox.length} {inbox.length === 1 ? "item needs" : "items need"} your attention
              </button> : null}
            </div>
            <div className="grid w-full grid-cols-2 gap-2 sm:mt-0.5 sm:flex sm:w-auto sm:items-center sm:gap-3">
              <Button className="min-h-11 w-full sm:w-auto sm:flex-none" onClick={() => { setCreateOptionsOpen(false); setCreateBuildOpen(true); }}><Icon name="Plus" className="h-4 w-4" aria-hidden /> New issue</Button>
              <Button className="min-h-11 w-full sm:w-auto sm:flex-none" variant="outline" onClick={() => setBoardPresetsOpen(true)} title="Manage agent presets and per-phase routing"><Icon name="Settings" className="h-4 w-4" aria-hidden /> Agent Presets</Button>
              {githubStatus?.pluginAvailable ? (
                <Button className="min-h-11 w-full sm:w-auto sm:flex-none" variant="outline" onClick={() => { setImportOpen(true); void listGithubIssues(); }}><Icon name="Github" className="h-4 w-4" aria-hidden /> Import issues</Button>
              ) : null}
            </div>
          </header>
          <PresetOnboardingDialog
            storageKey={STORAGE_KEYS.onboardBuild}
            title="Choose your agent presets"
            intro="Set the preset each phase runs with. Planning depth and review checkpoints are a separate choice — picked per card in New issue → Settings."
            onOpenPresets={() => setBoardPresetsOpen(true)}
            active={active}
            secondTitle="Defaults for new cards"
            secondBody={(
              <div className="grid gap-3 py-1 text-sm leading-6 text-muted-foreground">
                <p>Planning depth and review checkpoints are chosen per card and remembered as the board defaults. Set them once here.</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <WorkflowChoiceSelect label="Planning depth" value={appetite} options={APPETITE_OPTIONS} onChange={setAppetite} />
                  <WorkflowChoiceSelect label="Review checkpoints" value={reviewMode} options={REVIEW_MODE_OPTIONS} onChange={setReviewMode} />
                </div>
              </div>
            )}
          />
          {githubStatus !== null && githubStatus.pluginAvailable && !githubStatus.ghOk ? (
            <div className="mb-3 flex flex-col gap-1 rounded-md border p-2 text-xs sm:flex-row sm:items-center sm:gap-2">
              <span className="text-amber-700 dark:text-amber-300">Import issues needs a GitHub account linked in the <span className="font-medium">github</span> plugin.</span>
              <a className="text-primary underline underline-offset-2" href="https://github.com/settings/tokens" target="_blank" rel="noreferrer">Set up GitHub auth</a>
            </div>
          ) : null}

          <Dialog open={createBuildOpen} onOpenChange={setCreateBuildOpen}>
            <DialogContent fullscreenOnMobile className="overflow-y-auto sm:max-h-[calc(100dvh-1rem)] sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle>Start new issue</DialogTitle>
                <DialogDescription>Describe the outcome, problem, or change. Stelow will guide it through its planning and build process.</DialogDescription>
              </DialogHeader>
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
              <details open={createOptionsOpen} onToggle={(event) => setCreateOptionsOpen((event.currentTarget as HTMLDetailsElement).open)} className="border-t pt-3">
                <summary className="flex min-h-11 cursor-pointer flex-col justify-center gap-0.5 rounded-md border bg-muted/30 px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:flex-row sm:items-center sm:justify-between">
                  <span>Settings</span>
                  <span className="text-xs font-normal text-muted-foreground">Planning depth, review checkpoints, and agent configuration · Configure</span>
                </summary>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <WorkflowChoiceSelect label="Planning depth" value={appetite} options={APPETITE_OPTIONS} onChange={setAppetite} />
                  <WorkflowChoiceSelect label="Review checkpoints" value={reviewMode} options={REVIEW_MODE_OPTIONS} onChange={setReviewMode} />
                  <div className="sm:col-span-2">
                    <AgentConfigBox
                      lines={[`Analysis phase runs on ${analysisWorkerPreset?.name ?? "Default"}`]}
                      onConfigure={() => setBoardPresetsOpen(true)}
                    />
                  </div>
                </div>
              </details>
            </DialogContent>
          </Dialog>

          <Dialog open={importOpen} onOpenChange={(open) => { setImportOpen(open); if (!open) setImportCandidates([]); }}>
            <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Import GitHub issues</DialogTitle>
                <DialogDescription>Issues tagged with the Stelow label land in Triage as cards. Tag the issue with the label on GitHub, then import it here — nothing is auto-imported.</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3 py-2">
                <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <label className="shrink-0 text-xs font-medium text-muted-foreground" htmlFor="import-label">Label</label>
                    <Input id="import-label" value={importLabel} onChange={(event) => setImportLabel(event.target.value)} placeholder="stelow-work" aria-label="Stelow GitHub label" className="sm:w-52" list="stelow-import-labels" autoComplete="off" />
                    <datalist id="stelow-import-labels">
                      {importAllLabels.map((label) => <option key={label} value={label} />)}
                    </datalist>
                  </div>
                  {importAllAssignees.length > 0 ? (
                    <div className="flex min-w-0 items-center gap-2">
                      <label className="shrink-0 text-xs font-medium text-muted-foreground" htmlFor="import-assignee">Assignee</label>
                      <select
                        id="import-assignee"
                        className="h-11 cursor-pointer rounded-md border bg-background px-2 text-sm"
                        value={importAssignee}
                        onChange={(event) => setImportAssignee(event.target.value)}
                      >
                        <option value="all">Everyone</option>
                        {importAllAssignees.map((login) => <option key={login} value={login}>{login}</option>)}
                      </select>
                    </div>
                  ) : null}
                  <Button size="sm" variant="outline" onClick={() => void listGithubIssues()} disabled={importBusy}>Refresh</Button>
                </div>
                <p className="text-xs text-muted-foreground">Each issue is imported into the bb project that owns its repository — no picker needed. Tag issues with this label on GitHub; nothing is auto-imported.</p>
                {importBusy ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
                {!importBusy && importCandidates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No open issues carry the label “{importLabel}” yet. Tag an issue on GitHub with this label, then Refresh.</p>
                ) : null}
                {!importBusy && importCandidates.length > 0 && importVisible.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No issues assigned to {importAssignee} carry this label.</p>
                ) : null}
                {importVisible.length > 0 ? (
                  <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border">
                    {importVisible.map((issue) => {
                      const key = `${issue.repo}#${issue.number}`;
                      return (
                        <li key={key} className="flex items-start gap-2 p-2">
                          <input
                            className="mt-1 h-4 w-4 shrink-0 cursor-pointer"
                            type="checkbox"
                            checked={Boolean(importSelected[key])}
                            onChange={() => setImportSelected((prev) => ({ ...prev, [key]: !prev[key] }))}
                            disabled={issue.alreadyImported}
                          />
                          <div className="min-w-0">
                            <p className="text-sm leading-5">
                              <span className="font-medium">{issue.title}</span>
                              <span className="ml-2 text-xs text-muted-foreground">{issue.repo}#{issue.number}</span>
                            </p>
                            <p className="text-xs text-muted-foreground">{issue.labels.join(" · ") || "no labels"}{(issue.assignees ?? []).length > 0 ? ` · @${(issue.assignees ?? []).join(" @")}` : ""}{issue.projectId ? ` → ${projects.find((project) => project.id === issue.projectId)?.name ?? issue.projectId}` : ""}{issue.alreadyImported ? " · already imported" : ""}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost" disabled={importBusy}>Cancel</Button>
                </DialogClose>
                <Button onClick={() => void importSelectedIssues()} disabled={importBusy}>Import selected into Triage</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

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
                <Button onClick={() => { setCreateOptionsOpen(false); setCreateBuildOpen(true); }}>Start new issue</Button>
                <UrlLink href="https://github.com/calionauta/stelow" className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Learn about Stelow <span aria-hidden="true">↗</span></UrlLink>
              </div>
            </section>
          ) : null}

          {viewMode === "board" ? <p className="text-xs text-muted-foreground">
            <span className="sm:hidden">Swipe sideways to view every stage.</span>
            <span className="hidden sm:inline">Use Shift + scroll to move across stages.</span>
          </p> : null}
          {viewMode === "list" ? <BuildList groups={grouped} navigate={navigate} /> : <div className="grid gap-3 overflow-x-auto md:h-[clamp(20rem,calc(100dvh-17rem),48rem)] md:overflow-y-hidden" style={{ gridTemplateColumns: COLUMNS.map((column) => collapsedColumns[column] ? "minmax(56px, 0.5fr)" : "minmax(220px, 1.5fr)").join(" ") }}>
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

// Second track beside Build: lightweight research (To-Do / Doing / Done)
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
  const [prompt, setPrompt] = useState("");
  const [strategy, setStrategy] = useState<string | null>(null);
  const [strategyAttention, setStrategyAttention] = useState(0);
  const [viewMode, setViewMode] = useState<"board" | "list">("board");
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
  useDebouncedRealtime(["card-state", "board-changed"], () => void load(researchProjectId ?? routeProjectId));

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
      (groups[researchColumnOf(card)] ?? groups.todo).push(card);
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
    try {
      const result = await rpc.call("createResearchCard", { projectId: targetProjectId, environment: request.environment, prompt: text, attachments, strategy });
      setPrompt("");
      setCreateOpen(false);
      navigate.openThreadPanel({ actionId: "stelow-card-detail", title: result.cardId, params: { cardId: result.cardId } });
      toast.success("Research started. Results will appear on this card when ready.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to start research.");
      throw error;
    }
  }

  async function moveCard(cardId: string, target: string) {
    if (!(RESEARCH_COLUMNS as readonly string[]).includes(target)) return;
    const result = await rpc.call("moveCard", { cardId, status: target as "todo" | "doing" | "done" | "archived" });
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
              <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">Get a concise research result with prioritized opportunities you can turn into {trackTitle("build")} cards.</p>
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

          <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (open) setStrategy(null); }}>
            <DialogContent fullscreenOnMobile className="overflow-y-auto sm:max-h-[calc(100dvh-1rem)] sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle>Start new research</DialogTitle>
                <DialogDescription>Pick a strategy below, then describe what to investigate. One strategy per round — run more rounds from the card to compound perspectives.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="grid gap-1.5">
                  <span className="text-xs font-medium text-foreground">Choose a strategy</span>
                  <StrategyPicker strategies={strategies} value={strategy} onChange={setStrategy} groupName="strategy-pick" attentionSignal={strategyAttention} />
                </div>
                <AgentConfigBox
                  lines={[`Research runs on ${effectiveResearchPreset?.name ?? "Default"}${researchBandPreset ? "" : " (board default)"}`]}
                  onConfigure={() => setResearchPresetsOpen(true)}
                />
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
          {viewMode === "list" ? <ResearchList groups={grouped} navigate={navigate} strategyLabelById={strategyLabelById} /> : (
          <div className="grid gap-3 overflow-x-auto md:h-[clamp(20rem,calc(100dvh-17rem),48rem)] md:overflow-y-hidden" style={{ gridTemplateColumns: RESEARCH_COLUMNS.map((column) => collapsedColumns[column] ? "minmax(56px, 0.5fr)" : "minmax(220px, 1.5fr)").join(" ") }}>
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
  const [prompt, setPrompt] = useState("");
  const [stage, setStage] = useState<string | null>(null);
  const [stageAttention, setStageAttention] = useState(0);
  const [viewMode, setViewMode] = useState<"board" | "list">("board");
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
  useDebouncedRealtime(["card-state", "board-changed"], () => void load(exploreProjectId ?? routeProjectId));

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
      (groups[researchColumnOf(card)] ?? groups.todo).push(card);
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
    try {
      const result = await rpc.call("createExploreCard", { projectId: targetProjectId, environment: request.environment, prompt: text, attachments, stageId: stage });
      setPrompt("");
      setCreateOpen(false);
      navigate.openThreadPanel({ actionId: "stelow-card-detail", title: result.cardId, params: { cardId: result.cardId } });
      toast.success("Exploration started. The result will appear on this card when ready.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to start exploration.");
      throw error;
    }
  }

  async function moveCard(cardId: string, target: string) {
    if (!(RESEARCH_COLUMNS as readonly string[]).includes(target)) return;
    const result = await rpc.call("moveCard", { cardId, status: target as "todo" | "doing" | "done" | "archived" });
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
              <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">Run one workflow stage to get a focused result. Pick the approach, supply the input, and review the outcome on the card.</p>
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

          <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (open) setStage(null); }}>
            <DialogContent fullscreenOnMobile className="overflow-y-auto sm:max-h-[calc(100dvh-1rem)] sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle>Start new exploration</DialogTitle>
                <DialogDescription>Pick one workflow stage below, then describe the input — an idea, an existing proposal, a codebase, or a URL. The agent runs that approach and returns a focused result.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="grid gap-1.5">
                  <span className="text-xs font-medium text-foreground">Choose a stage</span>
                  <StrategyPicker strategies={stages} value={stage} onChange={setStage} groupName="stage-pick" attentionSignal={stageAttention} noun="stages" legend="Workflow stage" />
                </div>
                <AgentConfigBox
                  lines={[`Explore runs on ${effectiveExplorePreset?.name ?? "Default"}${exploreBandPreset ? "" : " (board default)"}`]}
                  onConfigure={() => setResearchPresetsOpen(true)}
                />
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
          {viewMode === "list" ? <ExploreList groups={grouped} navigate={navigate} stageLabelById={stageLabelById} /> : (
          <div className="grid gap-3 overflow-x-auto md:h-[clamp(20rem,calc(100dvh-17rem),48rem)] md:overflow-y-hidden" style={{ gridTemplateColumns: RESEARCH_COLUMNS.map((column) => collapsedColumns[column] ? "minmax(56px, 0.5fr)" : "minmax(220px, 1.5fr)").join(" ") }}>
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
  onboardBuild: "stelow-onboard-build-v1",
  onboardResearch: "stelow-onboard-research-v1",
  onboardExplore: "stelow-onboard-explore-v1",
  onboardPresets: "stelow-onboard-presets-v1",
} as const;

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

function StelowTabBar({ tab, counts, onSelect }: {
  tab: StelowTrack;
  counts: { inbox: number; build: number; research: number; explore: number; about: number };
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
            title={entry.key === "inbox" ? "Things that need you, plus recent completions" : entry.key === "build" ? "Build board" : entry.key === "research" ? "Research board" : entry.key === "explore" ? "Single-stage runs" : "What Stelow is"}
            className={`inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:px-3 sm:text-sm ${active ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          >
            <Icon name={entry.icon} className="h-4 w-4" aria-hidden />
            <span>{entry.title}</span>
            {entry.key === "about" ? null : (
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
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <CardDetailHeader cardId={cardId} onBack={back} />
      <div className="flex-1 overflow-auto">
        <CardDetailBody cardId={cardId} inboxEventId={eventId} onClose={back} navigate={navigate} />
      </div>
    </div>
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
const HOST_TOOLS: Array<{ id: "ast-grep" | "cymbal" | "plannotator" | "ripwire" | "sem"; name: string; repo: string; plain: string; tech: string; install: string; unusedInBb?: string }> = [
  { id: "ast-grep", name: "ast-grep", repo: "https://github.com/ast-grep/ast-grep", plain: "Find code patterns and rename across files without touching text inside strings — when refactoring.", tech: "Structural AST search with safe rewrite; used for refactors that change signatures.", install: "npm install -g @ast-grep/cli" },
  { id: "cymbal", name: "cymbal", repo: "https://github.com/1broseidon/cymbal", plain: "See who calls each function and what breaks if you change it — before touching code.", tech: "Symbol graph (refs, impact, trace); used in Tech Preview, Feature Recon and Alignment Check.", install: "brew install 1broseidon/tap/cymbal" },
  { id: "plannotator", name: "plannotator", repo: "https://plannotator.ai", plain: "Open the plan in a browser to comment point by point before approving a gate.", tech: "Visual review with structured annotations; portable receipt in .stelow/approvals.", install: "curl -fsSL https://plannotator.ai/install.sh | bash -s -- --minimal", unusedInBb: "Not used in bb — gates resolve in the plugin review UI, and the plugin never invokes this binary." },
  { id: "ripwire", name: "ripwire", repo: "https://github.com/redhat-et/ripwire", plain: "First read of an unfamiliar codebase: what matters, where to enter, what to test.", tech: "Token-budgeted symbol map (symbols, callers, blast radius).", install: "RIPWIRE_REPO=redhat-et/ripwire bash -c \"$(curl -fsSL https://raw.githubusercontent.com/redhat-et/ripwire/main/scripts/install.sh)\"" },
  { id: "sem", name: "sem", repo: "https://github.com/Ataraxy-Labs/sem", plain: "Tell which functions and types changed — not just which lines — including renames.", tech: "Entity-level diff via tree-sitter; powers the Diff summary and agent audits.", install: "curl -fsSL https://raw.githubusercontent.com/Ataraxy-Labs/sem/main/install.sh | sh" },
];

function HostToolsSection({ tools, onInstall, installingId, errors }: {
  tools: Array<{ id: string; present: boolean; version: string | null }> | null;
  onInstall: (id: "ast-grep" | "cymbal" | "plannotator" | "ripwire" | "sem") => void;
  installingId: string | null;
  errors: Record<string, string>;
}) {
  const byId = new Map((tools ?? []).map((tool) => [tool.id, tool]));
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-foreground">Optional tools</h2>
      <p className="text-sm leading-6 text-muted-foreground">
        Recommended by Stelow, honored here. Workers use these tools when present; the plugin itself uses sem and cymbal for the Diff section. Without one, the same step still works with the built-in fallback — just with less depth. Install anytime; effects apply on next use.{" "}
        <UrlLink href="https://github.com/calionauta/stelow#external-dependencies">Install guide ↗</UrlLink>
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
                {!present && !meta.unusedInBb ? (
                  <span className="ml-auto">
                    <Button size="sm" variant="outline" disabled={busy || installingId !== null} onClick={() => onInstall(meta.id)} title={`Install ${meta.name} now`}>
                      {busy ? "Installing…" : "Install"}
                    </Button>
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{meta.plain}</p>
              <p className="mt-0.5 font-mono text-[11px] leading-5 text-muted-foreground/80">{meta.tech}</p>
              {meta.unusedInBb ? <p className="mt-1 text-[11px] italic leading-5 text-muted-foreground/80">{meta.unusedInBb}</p> : null}
              {!present && !busy && !meta.unusedInBb ? <pre className="mt-1.5 overflow-x-auto rounded-md border bg-background/60 p-2 font-mono text-[11px] leading-relaxed">{meta.install}</pre> : null}
              {busy ? <p className="mt-1.5 text-[11px] text-muted-foreground">Installing — can take a couple minutes. The row flips to ● on success.</p> : null}
              {error ? (
                <div className="mt-1.5 space-y-1">
                  <p className="text-[11px] text-destructive">Install failed: {error.split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 220) ?? "unknown error"}</p>
                  <details>
                    <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">Install log</summary>
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border bg-background/60 p-2 font-mono text-[11px] leading-relaxed">{error}</pre>
                  </details>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      )}
    </section>
  );
}

function AboutPanel() {
  const rpc = useRpc<typeof rpcContract>();
  const [buildInfo, setBuildInfo] = useState<{ version: string; builtAt: string | null; stelowVersion: string | null } | null>(null);
  const [hostTools, setHostTools] = useState<Array<{ id: string; present: boolean; version: string | null }> | null>(null);
  const [installingToolId, setInstallingToolId] = useState<string | null>(null);
  const [installErrors, setInstallErrors] = useState<Record<string, string>>({});
  function installHostTool(id: "ast-grep" | "cymbal" | "plannotator" | "ripwire" | "sem") {
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
  useEffect(() => {
    let cancelled = false;
    void rpc.call("buildInfo", {}).then((result) => { if (!cancelled) setBuildInfo(result); }).catch(() => undefined);
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
    toast.success("Onboarding reset. Visit each tab to see it again.");
  }
  return (
    <div className="flex h-full overflow-hidden bg-background">
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto max-w-[1500px] space-y-4">
          <header>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="text-xl font-semibold tracking-tight">About</h1>
            </div>
          </header>
          <div className="grid max-w-2xl gap-5">
            <section className="space-y-2">
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
              <p className="text-sm leading-6 text-muted-foreground">This plugin hosts Stelow inside bb: Build, Research, and Explore boards, a quiet inbox that only interrupts when the agent needs you, and a worker CLI with deterministic artifact checks.</p>
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
              </section>
              <HostToolsSection tools={hostTools} onInstall={installHostTool} installingId={installingToolId} errors={installErrors} />
            </div>
        </div>
      </div>
    </div>
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
      <StelowTabBar tab={tab} counts={counts} onSelect={goTrack} />
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

function WorkflowChoiceSelect<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string; description: string }[]; onChange: (value: T) => void }) {
  const selected = options.find((option) => option.value === value);
  return (
    <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)} className="cursor-pointer h-9 rounded-md border bg-background px-2 text-sm text-foreground" aria-label={label}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <span>{selected?.description}</span>
    </label>
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

function ResearchList({ groups, navigate, strategyLabelById }: { groups: Record<string, CardItem[]>; navigate: ReturnType<typeof useBbNavigate>; strategyLabelById: Map<string, string> }) {
  return <LightweightTrackList groups={groups} navigate={navigate} tagFor={(card) => joinStrategyLabels(card.researchStrategies ?? [], strategyLabelById) || null} renderCard={(card, tag) => <ResearchCard card={card} strategyLabel={tag} />} />;
}

function ExploreList({ groups, navigate, stageLabelById }: { groups: Record<string, CardItem[]>; navigate: ReturnType<typeof useBbNavigate>; stageLabelById: Map<string, string> }) {
  return <LightweightTrackList groups={groups} navigate={navigate} tagFor={(card) => (card.exploreStage ? (stageLabelById.get(card.exploreStage) ?? card.exploreStage) : null)} renderCard={(card, tag) => <ExploreCard card={card} stageLabel={tag} />} />;
}

function BuildList({ groups, navigate }: { groups: Record<string, CardItem[]>; navigate: ReturnType<typeof useBbNavigate> }) {
  return <div className="space-y-5">{COLUMNS.map((column) => {
    const cards = groups[column] ?? [];
    if (!cards.length) return null;
    return <section key={column} className="space-y-2"><div className="flex items-center gap-2"><h2 className="text-sm font-semibold">{COLUMN_LABELS[column] ?? column}</h2><span className="text-xs text-muted-foreground">{cards.length}</span></div><div className="overflow-hidden rounded-md border">{cards.map((card) => <button key={card.id} onClick={() => goToCard(navigate, card, card.id)} className="cursor-pointer flex min-h-11 w-full items-center gap-3 border-b p-3 text-left last:border-b-0 hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><span className={`size-2 shrink-0 rounded-full ${card.needsAttention ? "bg-amber-500" : card.activity === "running" ? "bg-primary" : "bg-muted-foreground/40"}`} /><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{card.displayName}</strong><span className="block truncate text-xs text-muted-foreground">{card.projectName} · {stageLabel(card.stage)}{card.scopeSummary.scopesTotal > 0 ? ` · ✓ ${card.scopeSummary.scopesDone}/${card.scopeSummary.scopesTotal} scopes · ${card.scopeSummary.tasksDone}/${card.scopeSummary.tasksTotal} tasks` : ""}</span></span><span className="shrink-0 text-xs text-muted-foreground">{new Date(card.updatedAt).toLocaleString()}</span></button>)}</div></section>;
  })}</div>;
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
            <span aria-hidden className="text-foreground/60">▸</span>
          </>
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="text-foreground/60">▾</span>
              <span>{labels[column]}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="rounded-md bg-foreground/10 px-2 text-foreground">{cards.length}</span>
              <span aria-hidden className="text-foreground/60">▸</span>
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
function CardRetryButton({ cardId }: { cardId: string }) {
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
    <button onClick={(event) => void retry(event)} disabled={retrying} title="Retry the worker in place" className="disabled:cursor-not-allowed cursor-pointer rounded-full border border-primary/40 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10 disabled:opacity-50">
      {retrying ? "…" : "↻ Retry"}
    </button>
  );
}

// Every "open the worker thread" affordance: one definition with the
// inspect-title everywhere (it is always an inspection). Renders nothing
// without a thread instead of a dead button that swallows clicks.
function OpenThreadButton({ threadId }: { threadId: string | null | undefined }) {
  const navigate = useBbNavigate();
  if (!threadId) return null;
  return <Button size="sm" variant="outline" onClick={() => navigate.toThread(threadId)} title="Open the worker thread to inspect what happened.">Open thread ↗</Button>;
}

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
      {card.activity === "error" && card.lastError ? <p className="mt-2 line-clamp-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-[11px] text-destructive" title={card.lastError}>{card.lastError}</p> : null}
      {card.activity === "idle" ? <div className="mt-1 text-[10px] text-muted-foreground">Idle since {new Date(card.updatedAt).toLocaleString()}</div> : null}
    </>
  );
}

function BoardCard({ card }: { card: CardItem }) {
  const navigate = useBbNavigate();
  const attention = card.needsAttention;
  const running = card.activity === "running";
  const stuck = Boolean(card.workerThreadId) && (card.activity === "error" || (card.activity === "idle" && attention));
  const borderClass = running
    ? "stelow-border-running"
    : attention
    ? "stelow-border-attention"
    : "border-border hover:border-primary/60";
  const open = useCallback(() => goToCard(navigate, card, card.id), [navigate, card]);
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(event) => { event.dataTransfer.setData("text/stelow-card", card.id); event.dataTransfer.effectAllowed = "move"; }}
      onClick={open}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } }}
      title="Click to inspect"
      className={`stelow-board-card relative block w-full cursor-pointer overflow-hidden rounded-lg border bg-card p-3 text-left shadow-sm transition hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${borderClass}`}
      aria-label={`Open card ${card.displayName}.`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 truncate text-sm font-medium leading-tight text-foreground">{card.displayName}</div>
        <span className="inline-flex shrink-0 items-center gap-1.5">
          {stuck ? <CardRetryButton cardId={card.id} /> : null}
          <ActivityPill activity={card.activity} />
        </span>
      </div>
      {(card.scopeSummary.scopesTotal > 0 || card.intent !== "unknown") ? <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        {card.scopeSummary.scopesTotal > 0 ? <span className="whitespace-nowrap text-muted-foreground" title={`${card.scopeSummary.scopesDone} of ${card.scopeSummary.scopesTotal} scopes done · ${card.scopeSummary.tasksDone} of ${card.scopeSummary.tasksTotal} tasks done`}>✓ {card.scopeSummary.scopesDone}/{card.scopeSummary.scopesTotal} scopes · {card.scopeSummary.tasksDone}/{card.scopeSummary.tasksTotal} tasks</span> : null}
        {card.intent !== "unknown" ? <Pill className="ml-auto whitespace-nowrap" title="Intent — the kind of card this is. The agent sets it during triage; correct it here if it got it wrong.">{INTENT_LABEL[card.intent] ?? card.intent}</Pill> : null}
      </div> : null}
      <CardMetaRows card={card} />
    </div>
  );
}

// Lightweight-track card (Research + Explore share it — convention over
// configuration): identical worker chrome, one tag pill whose label comes
// from the track catalog (strategy for research, stage for explore).
function LightweightTrackCard({ card, tagLabel, tagTitle, ariaNoun }: { card: CardItem; tagLabel: string | null; tagTitle: string; ariaNoun: string }) {
  const navigate = useBbNavigate();
  const attention = card.needsAttention;
  const running = card.activity === "running";
  const stuck = Boolean(card.workerThreadId) && (card.activity === "error" || (card.activity === "idle" && attention));
  const borderClass = running
    ? "stelow-border-running"
    : attention
    ? "stelow-border-attention"
    : "border-border hover:border-primary/60";
  const open = useCallback(() => goToCard(navigate, card, card.id), [navigate, card]);
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(event) => { event.dataTransfer.setData("text/stelow-card", card.id); event.dataTransfer.effectAllowed = "move"; }}
      onClick={open}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } }}
      title="Click to inspect"
      className={`stelow-board-card relative block w-full cursor-pointer overflow-hidden rounded-lg border bg-card p-3 text-left shadow-sm transition hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${borderClass}`}
      aria-label={`Open ${ariaNoun} ${card.displayName}.`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 truncate text-sm font-medium leading-tight text-foreground">{card.displayName}</div>
        <span className="inline-flex shrink-0 items-center gap-1.5">
          {stuck ? <CardRetryButton cardId={card.id} /> : null}
          <ActivityPill activity={card.activity} />
        </span>
      </div>
      {tagLabel ? <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <Pill className="ml-auto whitespace-nowrap" title={tagTitle}>{tagLabel}</Pill>
      </div> : null}
      <CardMetaRows card={card} />
    </div>
  );
}

// Research-track card: strategy instead of stage/intent, opens in the
// Research panel. Retry, attention, and activity reuse the build pieces.
function ResearchCard({ card, strategyLabel }: { card: CardItem; strategyLabel: string | null }) {
  return <LightweightTrackCard card={card} tagLabel={strategyLabel} tagTitle="Research strategy — the playbook driving this investigation." ariaNoun="research" />;
}

// Explore-track card: the single workflow stage instead of strategy/intent,
// opens in the Explore panel. Retry, attention, and activity reuse the same
// pieces as the other tracks.
function ExploreCard({ card, stageLabel }: { card: CardItem; stageLabel: string | null }) {
  return <LightweightTrackCard card={card} tagLabel={stageLabel ?? card.exploreStage} tagTitle="Workflow stage — the single playbook this exploration runs." ariaNoun="exploration" />;
}

// Lightweight list view (Research + Explore share it): same grouping as the
// board, one card per row. tagFor resolves the card's tag pill label.
function LightweightTrackList({ groups, navigate, tagFor, renderCard }: { groups: Record<string, CardItem[]>; navigate: ReturnType<typeof useBbNavigate>; tagFor: (card: CardItem) => string | null; renderCard: (card: CardItem, tag: string | null) => React.ReactNode }) {
  return <div className="space-y-5">{RESEARCH_COLUMNS.map((column) => {
    const cards = groups[column] ?? [];
    if (cards.length === 0) return null;
    return <section key={column} className="space-y-2"><div className="flex items-center gap-2"><h2 className="text-sm font-semibold">{RESEARCH_COLUMN_LABELS[column] ?? column}</h2><span className="text-xs text-muted-foreground">{cards.length}</span></div><div className="space-y-2">{cards.map((card) => <div key={card.id}>{renderCard(card, tagFor(card))}</div>)}</div></section>;
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
  setViewerFile: (file: { display: string; path: string; target: WorkspaceFileTarget | HostFileTarget | null } | null) => void,
  artifact: AskArtifact,
): void {
  setViewerFile({
    display: artifact.display,
    path: artifact.absolutePath ?? artifact.path,
    target: fileLinkTarget(card.workspaceKind === "exploratory", fileEnvironmentId, artifact.path, artifact.hostId ?? "", artifact.absolutePath ?? artifact.path),
  });
}

function StageTimeline({ currentStage, nextStages, artifacts, onPick, onShowArtifacts, skips, offRouteReason }: { currentStage: string; nextStages: string[]; artifacts: Array<{ stage: string }>; onPick: (stage: string) => void; onShowArtifacts: (stage: string) => void; skips: { offRoute: string[]; skipped: Array<{ stage: string; reason: string }> }; offRouteReason: string | null }) {
  const curIdx = STAGE_SEQUENCE.indexOf(currentStage);
  const current = curIdx >= 0 ? curIdx : 0;
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
                const isCurrent = stage === currentStage;
                const isOffRoute = !isCurrent && offRoute.has(stage);
                const skipReason = !isCurrent ? skipReasonByStage.get(stage) ?? null : null;
                const passed = idx >= 0 && idx < current && !isOffRoute && !skipReason;
                const canAdvance = idx === current + 1 && legal.has(stage);
                const canRegress = passed && !isCurrent;
                const clickable = canAdvance || canRegress;
                const produced = artifacts.filter((artifact) => artifact.stage === stage);
                const dimmedTitle = skipReason ?? (isOffRoute ? offRouteReason ?? "Not in this workflow's route" : STAGE_PRODUCES[stage]);
                return (
                  <span key={stage} className={`inline-flex shrink-0 items-center gap-1 ${isOffRoute ? "opacity-60" : ""}`}>
                    <button
                      type="button"
                      disabled={!clickable || isCurrent}
                      title={dimmedTitle}
                      onClick={() => onPick(stage)}
                      className={`disabled:cursor-not-allowed cursor-pointer relative inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                      isCurrent
                        ? "bg-primary/15 text-primary ring-2 ring-primary/60"
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
                        {canAdvance ? <span aria-hidden className="text-[9px]">→</span> : null}
                    </button>
                    {produced.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => onShowArtifacts(stage)}
                        title={`Show ${produced.length} artifact${produced.length === 1 ? "" : "s"} from ${stageLabel(stage)} in Artifacts below`}
                        aria-label={`Show ${produced.length} artifact${produced.length === 1 ? "" : "s"} from ${stageLabel(stage)} in Artifacts below`}
                        className="inline-flex min-h-8 min-w-8 cursor-pointer items-center justify-center gap-0.5 rounded-full border border-border bg-muted/40 px-2 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        <span aria-hidden>📄</span>
                        {produced.length}
                      </button>
                    ) : null}
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

// Shared artifact inventory: every artifact together, grouped by producing
// stage in canonical order. Rows are file affordances (open the viewer),
// never pills among status pills — the timeline keeps count-only badges so
// navigation and files never share a shape. Used by both track details.
// highlightStage (from a timeline count badge) rings that stage's group and
// brings it into view, so the jump lands on the files asked about — never
// the bare section top.
function ArtifactGroups({ artifacts, workspaceKind, fileEnvironmentId, onView, highlightStage }: {
  artifacts: Array<{ stage: string; kind: string; path: string; display: string; generatedAt: string; absolutePath: string; hostId: string }>;
  workspaceKind: string;
  fileEnvironmentId: string | null;
  onView: (file: { display: string; path: string; target: WorkspaceFileTarget | HostFileTarget | null }) => void;
  highlightStage?: string | null;
}) {
  const groups = useMemo(() => groupArtifactsByStage(artifacts), [artifacts]);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    highlightRef.current?.scrollIntoView({ block: "nearest" });
  }, [highlightStage, groups.length]);
  if (groups.length === 0) return <p className="text-xs text-muted-foreground">No artifacts yet — they appear here as stages complete.</p>;
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div
          key={group.stage}
          ref={group.stage === highlightStage ? highlightRef : undefined}
          className={`space-y-1 rounded-md p-1 transition ${group.stage === highlightStage ? "bg-primary/5 ring-2 ring-primary/50" : ""}`}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{stageLabel(group.stage)} ({group.items.length})</p>
          <div className="divide-y divide-border rounded-md border">
            {group.items.map((file) => (
              <button
                key={file.path}
                onClick={() => onView({ display: file.display, path: file.absolutePath, target: fileLinkTarget(workspaceKind === "exploratory", fileEnvironmentId, file.path, file.hostId, file.absolutePath) })}
                className="flex min-h-11 w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                title={`Review ${file.display} — ${stageLabel(group.stage)} · ${file.kind}`}
              >
                <span aria-hidden>📄</span>
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">{file.display}</span>
                <span className="shrink-0 text-muted-foreground">{file.kind}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CardDrawerAdapter(props: PluginThreadPanelProps) {
  const params = props.params;
  const cardId = typeof params === "object" && params && "cardId" in params && typeof params.cardId === "string" ? params.cardId : "";
  const navigate = useBbNavigate();
  if (!cardId) return <p className="p-4 text-sm text-muted-foreground">Pick a card from Stelow {trackTitle("build")} to see its details here.</p>;
  return <CardDetailBody cardId={cardId} inboxEventId={null} onClose={() => { /* host tab close */ }} navigate={navigate} />;
}

function CardDetailHeader({ cardId, onBack, restartFocusKey }: { cardId: string; onBack: () => void; restartFocusKey?: number }) {
  const rpc = useRpc<typeof rpcContract>();
  const [card, setCard] = useState<CardItem | null>(null);
  const [pendingIntent, setPendingIntent] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    void rpc.call("listCards", { projectId: null }).then((result) => {
      if (cancelled) return;
      setCard(result.cards.find((entry) => entry.id === cardId) ?? null);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [cardId, rpc]);
  useDebouncedRealtime(["card-state"], () => {
    void rpc.call("listCards", { projectId: null }).then((result) => {
      setCard(result.cards.find((entry) => entry.id === cardId) ?? null);
    }).catch(() => undefined);
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onBack(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);
  useEffect(() => {
    if (restartFocusKey === undefined) return;
    closeRef.current?.focus();
  }, [restartFocusKey]);
  async function applyIntent(nextIntent: string) {
    const result = await rpc.call("updateCardIntent", { cardId, intent: nextIntent as "new-product" | "feature" | "bugfix" | "refactor" | "investigate" | "unknown" });
    if (!result.ok) {
      toast.error(result.error ?? "Could not change intent.");
      return;
    }
    if (result.pastTriage && !result.notified) {
      toast.error("Intent changed, but the worker could not be notified. Use Retry so it picks up the change.");
    } else if (result.pastTriage) {
      toast.success(`Intent changed to ${INTENT_LABEL[nextIntent] ?? nextIntent} — worker notified. Appetite and stage path unchanged.`);
    } else {
      toast.success(`Intent changed to ${INTENT_LABEL[nextIntent] ?? nextIntent}`);
    }
  }
  return (
    <>
    <header className="flex items-center gap-2 border-b bg-card/80 px-3 py-1.5">
      <button onClick={onBack} title="Back to board (Esc)" className="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-md bg-background px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
        <span aria-hidden>←</span>
        <span>Board</span>
      </button>
      <nav className="min-w-0 flex-1 truncate text-xs text-muted-foreground" aria-label="Breadcrumb">
        <span>Stelow</span>
        <span aria-hidden className="mx-1 text-border">/</span>
        <span className="font-medium text-foreground">{card?.displayName ?? card?.name ?? "Loading…"}</span>
        {card ? card.kind === "research" || card.kind === "explore" ? <Pill className="ml-2 shrink-0" tone={statusTone(card.status)} title={`${card.kind === "research" ? "Research" : "Explore"} status — this card's current board state.`}><span className="mr-1">{statusGlyph(card.status)}</span>{RESEARCH_COLUMN_LABELS[researchColumnOf(card)] ?? statusLabel(card.status)}</Pill> : <BuildStatusPills card={card} /> : null}
      </nav>
      {card ? <>
        <ActivityPill activity={card.activity} />
        {card.kind !== "research" ? (
        <select
          aria-label="Intent"
          title="Intent — the kind of card this is. The agent sets it during triage; correct it here if it got it wrong."
          value={card.intent}
          onChange={(event) => {
            const nextIntent = event.target.value;
            if (nextIntent === card.intent) return;
            // Past triage the intent already shaped appetite and the stage path,
            // so changing it is a correction with consequences — confirm first.
            if (card.stage !== "triage") {
              setPendingIntent(nextIntent);
              return;
            }
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
      </> : null}
      <button ref={closeRef} onClick={onBack} title="Close (Esc)" aria-label="Close card details" className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md bg-background text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
        <Icon name="X" className="h-4 w-4" aria-hidden />
      </button>
    </header>
    <ConfirmActionDialog
      open={pendingIntent !== null}
      onOpenChange={(next) => { if (!next) setPendingIntent(null); }}
      title="Change intent after triage?"
      description={card && pendingIntent ? `This card is already at the ${stageLabel(card.stage)} stage. Changing the intent to ${INTENT_LABEL[pendingIntent] ?? pendingIntent} updates the label and notifies the worker, but appetite and the stage path chosen under the old intent are not recomputed.` : "Changing the intent updates the label and notifies the worker."}
      confirmLabel="Change intent"
      confirmTone="default"
      onConfirm={() => { const next = pendingIntent; setPendingIntent(null); if (next) void applyIntent(next); }}
    />
    </>
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
          <details key={scope.id} open={isOpen} onToggle={(event) => { const next = new Set(openIds); if ((event.currentTarget as HTMLDetailsElement).open) next.add(scope.id); else next.delete(scope.id); setOpenIds(next); }} className={`rounded-md border p-3 ${scope.status === "in-progress" ? "stelow-border-running" : blockedNow ? "border-amber-500/50" : "border-border"}`}>
            <summary className="cursor-pointer list-none space-y-1">
              <div className="flex flex-wrap items-center gap-1">
                <span className="font-mono text-xs text-muted-foreground">{scope.id}</span>
                <span className="font-medium">{scope.name}</span>
                {scope.type ? <Pill>{scope.type}</Pill> : null}
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
type BatchItem = { id: string; title: string; prompt: string; multiple: boolean; options: Array<{ label: string; description: string; preview: string | null; artifact: AskArtifact | null }> };

// Per-option evidence: the inline glance (preview) and the openable source
// of truth (artifact) share the upstream Option names from
// orchestrator stages/ask-patterns.md. Preview expands in place everywhere;
// the artifact opens in the viewer where a file opener exists (card), and
// degrades to a plain filename where it doesn't (thread) — never a dead
// button pretending to open.
function OptionDetail({ option, onOpenArtifact }: { option: BatchItem["options"][number]; onOpenArtifact?: (artifact: AskArtifact) => void }) {
  const artifact = option.artifact;
  if (!option.preview && !artifact) return null;
  return (
    <div className="ml-1 space-y-1 border-l-2 border-muted pl-2">
      {option.preview ? (
        <details>
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs font-medium text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Preview</summary>
          <pre className="whitespace-pre-wrap rounded-md border bg-background/60 p-2 font-mono text-[11px] leading-relaxed">{option.preview}</pre>
        </details>
      ) : null}
      {artifact ? (
        onOpenArtifact ? (
          <button onClick={() => onOpenArtifact(artifact)} className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs font-medium hover:bg-emerald-500/20" title={artifact.path}>
            <span aria-hidden>📎</span><span>{artifact.display}</span><span aria-hidden>↗</span>
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" title={artifact.path}><span aria-hidden>📎</span>{artifact.display}</span>
        )
      ) : null}
    </div>
  );
}

// One sitting for every pending question: stepper with counter, per-question
// radio (single) / checkbox (multi) options plus a free-text "Other", explicit
// skip, and a single atomic submit — one worker resume, one inbox resolution.
function BatchStepper({ questions, allowSkip, busy, error, submitLabel, onSubmit, onOpenArtifact }: {
  questions: BatchItem[];
  allowSkip: boolean;
  busy: boolean;
  error: string | null;
  submitLabel: string;
  onSubmit: (answers: string[][]) => void;
  onOpenArtifact?: (artifact: AskArtifact) => void;
}) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  if (questions.length === 0) return null;
  const current = questions[Math.min(index, questions.length - 1)]!;
  const merged = (id: string): string[] => {
    if (skipped.has(id)) return [];
    const out = [...(selected[id] ?? [])];
    const text = (custom[id] ?? "").trim();
    if (text) out.push(text);
    return out;
  };
  const doneCount = questions.filter((q) => skipped.has(q.id) || merged(q.id).length > 0).length;
  const complete = allowSkip ? doneCount === questions.length : doneCount > 0;
  const pick = (question: BatchItem, label: string) => {
    setSkipped((prev) => { const next = new Set(prev); next.delete(question.id); return next; });
    setSelected((prev) => {
      const has = (prev[question.id] ?? []).includes(label);
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
            <div className="text-sm font-medium text-amber-900 dark:text-amber-200">
              {questions.length > 1 ? `${questions.length} questions need your answer` : "Your answer is needed"}
            </div>
            {questions.length > 1 ? <div className="text-xs text-amber-900/70 dark:text-amber-200/70">Question {index + 1} of {questions.length}</div> : null}
          </div>
          {questions.length > 1 ? (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Questions">
              {questions.map((q, i) => {
                const done = skipped.has(q.id) || merged(q.id).length > 0;
                return (
                  <button
                    key={q.id}
                    aria-current={i === index ? "step" : undefined}
                    aria-label={`Question ${i + 1}${done ? " (answered)" : ""}`}
                    onClick={() => setIndex(i)}
                    className={`inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md border px-2 text-xs font-medium ${i === index ? "border-primary bg-primary/15 text-foreground" : done ? "border-emerald-500/50 bg-emerald-500/10 text-foreground" : "border-border bg-background/40 text-muted-foreground"}`}
                  >
                    {done && i !== index ? "✓ " : ""}{i + 1}
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="text-sm font-medium text-amber-900 dark:text-amber-200">{current.title}</div>
          {current.prompt ? <p className="text-sm text-amber-900/80 dark:text-amber-200/80">{current.prompt}</p> : null}
          <div className="grid gap-1" role={current.multiple ? "group" : "radiogroup"} aria-label={current.title}>
            {current.options.map((option) => {
              const active = (selected[current.id] ?? []).includes(option.label);
              return (
                <div key={option.label} className="space-y-1">
                  <button
                    role={current.multiple ? "checkbox" : "radio"}
                    aria-checked={active}
                    onClick={() => pick(current, option.label)}
                    className={`min-h-11 w-full cursor-pointer rounded-md border p-2 text-left text-sm ${active ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background/40 text-foreground"}`}
                  >
                    <div className="font-medium">{current.multiple ? (active ? "☑ " : "☐ ") : (active ? "◉ " : "○ ")}{option.label}</div>
                    {option.description ? <div className="text-xs text-muted-foreground">{option.description}</div> : null}
                  </button>
                  <OptionDetail option={option} onOpenArtifact={onOpenArtifact} />
                </div>
              );
            })}
          </div>
          <label className="block text-xs font-medium text-amber-900/80 dark:text-amber-200/80">
            <span>Other — write your own answer</span>
            <input
              value={custom[current.id] ?? ""}
              onChange={(event) => typeCustom(current, event.target.value)}
              placeholder="Type a custom answer…"
              className="mt-1 min-h-11 w-full cursor-text rounded-md border border-border bg-background/60 px-2 text-sm font-normal text-foreground placeholder:text-muted-foreground"
            />
          </label>
          {allowSkip ? (
            skipped.has(current.id)
              ? <button onClick={() => unskip(current)} className="min-h-11 cursor-pointer text-xs font-medium text-primary hover:underline">Skipped — answer it after all</button>
              : <button onClick={() => skip(current)} className="min-h-11 cursor-pointer text-xs text-amber-900/70 hover:underline dark:text-amber-200/70">Skip — let the AI use its recommendation</button>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {questions.length > 1 ? (
            <p className="text-xs text-amber-900/60 dark:text-amber-200/60">{doneCount} of {questions.length} answered{allowSkip ? " (skipped counts as answered)" : ""}. {allowSkip ? "One submit sends everything at once." : "Only answered questions are sent; the rest stay open."}</p>
          ) : current.multiple ? (
            <p className="text-xs text-amber-900/60 dark:text-amber-200/60">Pick one or more, then submit.</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {questions.length > 1 ? <Button size="sm" variant="outline" disabled={index === 0 || busy} onClick={() => setIndex((i) => Math.max(0, i - 1))}>Back</Button> : null}
            {questions.length > 1 && index < questions.length - 1 ? <Button size="sm" variant="outline" disabled={busy} onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}>Next</Button> : null}
            <Button size="sm" disabled={!complete || busy} onClick={() => onSubmit(questions.map((q) => merged(q.id)))}>{busy ? "Sending…" : submitLabel}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuestionBatch({ cardId, questions, mode, onAnswered, onOpenArtifact }: { cardId: string; questions: BatchItem[]; mode: "live" | "expired"; onAnswered: () => void; onOpenArtifact?: (artifact: AskArtifact) => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (questions.length === 0) return null;
  async function submit(all: string[][]) {
    setBusy(true); setError(null);
    try {
      if (mode === "live") {
        const result = await rpc.call("answerQuestions", { cardId, answers: questions.map((q, i) => ({ questionId: q.id, answers: all[i] ?? [] })) });
        if (!result.ok) { setError(result.error ?? "Could not send the answers."); return; }
      } else {
        // Timed-out questions take one answer each; untouched ones stay open.
        const payload = questions.flatMap((q, i) => {
          const first = (all[i] ?? [])[0];
          return first ? [{ questionId: q.id, answer: first }] : [];
        });
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
        submitLabel={questions.length > 1 ? (mode === "live" ? `Submit ${questions.length} answers` : "Submit answers") : "Submit answer"}
        onSubmit={(all) => void submit(all)}
        onOpenArtifact={onOpenArtifact}
      />
  );
}

function ExpiredQuestionsSection({ cardId, questions, onAnswered, onOpenArtifact }: { cardId: string; questions: ExpiredQuestion[]; onAnswered: () => void; onOpenArtifact?: (artifact: AskArtifact) => void }) {
  if (questions.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">Timed-out questions waiting for your answer</h3>
      <p className="text-xs text-amber-900/70 dark:text-amber-200/70">The ask timed out, but the agent is waiting. Answering here resumes the workflow.</p>
        <QuestionBatch
          cardId={cardId}
          mode="expired"
          questions={questions.map((q) => ({ id: q.id, title: "Timed-out question", prompt: q.question, multiple: q.multiple, options: q.options }))}
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
  // the dialog opens straight at the second panel — a "Step 2 of 2" counter
  // would reference a step the user never saw, so it stays hidden.
  const [singleStep, setSingleStep] = useState(false);
  function showStep(next: 0 | 1, single: boolean) { setStep(next); setSingleStep(single); }
  const hasSecond = !!secondTitle;
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{step === 1 && secondTitle ? secondTitle : title}</DialogTitle>
          <DialogDescription>{step === 1 ? "Defaults new cards start from." : intro}</DialogDescription>
        </DialogHeader>
        {hasSecond && !singleStep ? <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Step {step + 1} of 2</p> : null}
        {step === 1 && secondBody ? secondBody : (
          <div className="grid gap-3 py-1 text-sm leading-6 text-muted-foreground">
            <p>Agent presets decide which provider, model, reasoning, and permission each worker runs with. Each track has its own band default; cards without one fall back to the board default, and any card can pin its own preset in Manage.</p>
            {children}
          </div>
        )}
        <DialogFooter>
          {step === 0 ? (
            <>
              <Button variant="outline" onClick={() => { markSharedDone(); onOpenPresets(); }}>Open Agent Presets</Button>
              {hasSecond ? <Button onClick={() => setStep(1)}>Next</Button> : <Button onClick={dismiss}>Got it</Button>}
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep(0)}>Back</Button>
              <Button onClick={dismiss}>Done</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [options, setOptions] = useState<{ providers: { id: string; displayName: string }[]; models: { providerId: string; model: string; displayName: string }[] }>({ providers: [], models: [] });
  const [bandPresets, setBandPresets] = useState<{ band: string; presetId: string | null; stages: string[] }[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setForm(EMPTY_PRESET_FORM);
      setFormOpen(false);
      setOptions({ providers: [], models: [] });
      return;
    }
    const defaultPreset = presets.find((preset) => preset.isDefault) ?? presets[0] ?? null;
    setForm(defaultPreset ? { id: null, name: "", providerId: defaultPreset.providerId, modelId: defaultPreset.modelId, reasoningLevel: defaultPreset.reasoningLevel, permissionMode: defaultPreset.permissionMode as "accept-edits" | "auto" | "full", environmentKind: defaultPreset.environmentKind as "project-default" | "new-worktree" } : EMPTY_PRESET_FORM);
    setMessage(null);
    void rpc.call("listProviderModels", {}).then(setOptions).catch(() => setOptions({ providers: [], models: [] }));
    void rpc.call("listBandPresets", {}).then((result) => setBandPresets(result.bands)).catch(() => setBandPresets([]));
  }, [open, rpc]);

  const providerModels = options.models.filter((model) => model.providerId === form.providerId);
  const formCatalogReady = options.providers.length > 0 && options.models.length > 0;
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
      <DialogContent className="max-w-xl">
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
        <div className="mt-3 rounded-md border bg-muted/30 p-3">
          <h4 className="mb-2 text-sm font-semibold">Worker preset per track</h4>
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
        </div>
        <div className="mt-3 rounded-md border bg-muted/30 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">{form.id ? `Edit ${form.name}` : "New preset"}</h4>
            <div className="flex shrink-0 gap-1">
              {form.id ? <Button size="sm" variant="ghost" onClick={startNew}>New preset</Button> : null}
              <Button size="sm" variant="ghost" aria-expanded={formOpen} aria-controls="preset-form-body" disabled={!formCatalogReady} onClick={() => setFormOpen((open) => !open)} title={formOpen ? "Collapse the preset form" : "Expand the preset form"}>{formOpen ? "▾ Hide" : "▸ Show"}</Button>
            </div>
          </div>
          {formOpen ? (
            formCatalogReady ? <div id="preset-form-body">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground"><span>Name</span><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Default" /></label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground"><span>Provider</span>
                <select className="cursor-pointer h-9 rounded-md border bg-background px-2 text-sm" value={form.providerId} onChange={(event) => { setForm({ ...form, providerId: event.target.value, modelId: options.models.find((model) => model.providerId === event.target.value)?.model ?? "" }); }}>
                  {options.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.displayName} ({provider.id})</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-2"><span>Model</span>
                <select className="cursor-pointer h-9 rounded-md border bg-background px-2 text-sm" value={form.modelId} onChange={(event) => setForm({ ...form, modelId: event.target.value })}>
                  {providerModels.length === 0 ? <option value={form.modelId}>{form.modelId}</option> : null}
                  {providerModels.map((model) => <option key={model.model} value={model.model}>{model.displayName} ({model.model})</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground"><span>Reasoning</span>
                <select className="cursor-pointer h-9 rounded-md border bg-background px-2 text-sm" value={form.reasoningLevel} onChange={(event) => setForm({ ...form, reasoningLevel: event.target.value })}>
                  {["low", "medium", "high", "xhigh", "max"].map((level) => <option key={level} value={level}>{level}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground"><span>Permission mode</span>
                <select className="cursor-pointer h-9 rounded-md border bg-background px-2 text-sm" value={form.permissionMode} onChange={(event) => setForm({ ...form, permissionMode: event.target.value as "accept-edits" | "auto" | "full" })}>
                  <option value="accept-edits">accept-edits</option>
                  <option value="auto">auto</option>
                  <option value="full">full</option>
                </select>
              </label>
            </div>
            {message ? <p className="mt-2 text-xs text-muted-foreground">{message}</p> : null}
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              <Button size="sm" disabled={busy} onClick={() => void save()}>{busy ? "Working…" : form.id ? "Save changes" : "Create preset"}</Button>
            </div>
            </div>
            : <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground" aria-hidden={false}>
              <span className="size-4 animate-spin rounded-full border-2 border-muted border-t-primary" aria-hidden />
              <span>Loading providers and models…</span>
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
function ArtifactViewerDialog({ open, onOpenChange, cardId, file, editorTarget, onCommented }: {
  open: boolean; onOpenChange: (next: boolean) => void; cardId: string;
  file: { display: string; path: string } | null;
  editorTarget: WorkspaceFileTarget | HostFileTarget | null;
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="truncate">{file?.display ?? "Artifact"}</DialogTitle>
          <DialogDescription>Read-only preview. Discuss below — notes go to the agent.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-auto rounded-md border bg-muted/20 p-3">
          {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
          {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}
          {!loading && !loadError && content !== null ? (
            isMarkdown ? <div className="text-sm leading-relaxed"><Markdown content={content} /></div> : <SourceCode content={content} path={file?.display ?? "file.txt"} />
          ) : null}
          {truncated ? <p className="mt-2 text-xs text-muted-foreground">Truncated preview — open in the editor for the full file.</p> : null}
        </div>
        <div className="space-y-2">
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
        <DialogFooter>
          {editorTarget ? (
            <FileLink target={editorTarget} location={null} className="mr-auto inline-flex min-h-11 cursor-pointer items-center rounded-md px-2 text-xs font-medium text-primary hover:underline">Open in bb editor ↗</FileLink>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button disabled={drafts.length === 0 || sending} onClick={() => void sendAll()}>{sending ? "Sending…" : drafts.length > 1 ? `Send ${drafts.length} to agent` : "Send to agent"}</Button>
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

// Open-card building blocks: one contextual hero (heroFor) + one disclosure
// pattern (CardDisclosure) for secondary content. Previously every zone —
// banners, meta grid, timeline, preset, comments — used its own ad-hoc
// spacing and heading style.
function CardDisclosure({ title, hint, action, children, defaultOpen = false, open, onToggle }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; open?: boolean; onToggle?: (open: boolean) => void }) {
  const controlled = open !== undefined;
  return (
    <details
      open={controlled ? open : defaultOpen}
      onToggle={(event) => onToggle?.((event.currentTarget as HTMLDetailsElement).open)}
      className="group rounded-lg border bg-muted/20"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center px-3 py-2 text-sm font-medium marker:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="mr-1.5 inline-block text-[10px] text-muted-foreground transition-transform group-open:rotate-90">▶</span>
        <span>{title}</span>
        {hint ? <span className="ml-2 truncate text-xs font-normal text-muted-foreground">{hint}</span> : null}
        {action ? <span className="ml-auto inline-flex shrink-0 pl-2" onClick={(event) => event.stopPropagation()}>{action}</span> : null}
      </summary>
      <div className="space-y-3 px-3 pb-3">{children}</div>
    </details>
  );
}

// Hybrid (A+D+E): single contextual hero derived from card state. One plain
// sentence + one primary action. Replaces the scattered error / paused /
// decision banners with one ordered attention model:
// decision > error > paused > working > calm.
type HeroKind = "decision" | "error" | "paused" | "working" | "calm";
function heroFor(card: CardItem, detail: CardDetailResponse | null): { kind: HeroKind; title: string; sub: string } {
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

function CustomModelCombobox({ models, value, onPick }: { models: Array<{ model: string; displayName: string }>; value: string; onPick: (model: string) => void }) {
  const [open, setOpen] = useState(false);
  const query = value.trim().toLowerCase();
  const matches = (query ? models.filter((model) => model.model.toLowerCase().includes(query) || model.displayName.toLowerCase().includes(query)) : models).slice(0, 30);
  return (
    <span className="relative block min-w-0">
      <input
        aria-label="Custom model id"
        value={value}
        onChange={(event) => { onPick(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); if (event.key === "Enter" && matches.length > 0 && !matches.some((model) => model.model === value.trim())) onPick(matches[0]!.model); }}
        placeholder={models.length > 0 ? "type to filter models…" : "model id…"}
        className="h-7 w-full min-w-0 rounded-md border bg-background px-1.5 font-mono text-xs"
      />
      {open && (matches.length > 0 || query) ? (
        <span className="mt-1 block max-h-44 overflow-auto rounded-md border bg-background">
          {matches.map((model) => (
            <button
              key={model.model}
              type="button"
              onClick={() => { onPick(model.model); setOpen(false); }}
              className="cursor-pointer block w-full truncate px-2 py-1.5 text-left text-xs hover:bg-muted"
              title={`${model.model}`}
            >
              <span className="block truncate font-medium">{model.displayName}</span>
              <span className="block truncate font-mono text-[10px] text-muted-foreground">{model.model}</span>
            </button>
          ))}
          {query && !matches.some((model) => model.model === value.trim()) ? (
            <button type="button" onClick={() => setOpen(false)} className="cursor-pointer block w-full truncate px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted">
              Use “{value.trim()}” anyway
            </button>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

function PresetAssignDialog({ open, onOpenChange, cardId, onChanged }: { open: boolean; onOpenChange: (next: boolean) => void; cardId: string; onChanged: () => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const [presets, setPresets] = useState<Array<{ id: string; name: string; providerId: string; modelId: string; reasoningLevel: string; permissionMode: string; environmentKind: string; isDefault: boolean }>>([]);
  const [catalog, setCatalog] = useState<{ providers: { id: string; displayName: string; modelsAvailable: boolean }[]; models: { providerId: string; model: string; displayName: string }[] }>({ providers: [], models: [] });
  const [customProvider, setCustomProvider] = useState("");
  const [customModel, setCustomModel] = useState("");
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
    setSelected(null); setError(null); setCustomProvider(""); setCustomModel("");
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
        await applyCustom(customProvider, customModel.trim());
      }
    } finally {
      setBusy(false);
    }
  }
  async function applyCustom(providerId: string, modelId: string) {
    if (!providerId || !modelId) { setError("Pick a provider and type a model id."); return; }
    const base = defaultPreset;
    const upserted = await rpc.call("upsertPreset", {
      id: `card-override-${cardId}`,
      name: `Card override ${cardId}`,
      providerId,
      modelId,
      reasoningLevel: base?.reasoningLevel ?? "medium",
      permissionMode: (base?.permissionMode as "accept-edits" | "auto" | "full" | undefined) ?? "full",
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
            <label className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm ${selected === "custom" ? "border-primary bg-primary/10" : "border-border"}`}>
              <input type="radio" name="card-preset" checked={selected === "custom"} onChange={() => setSelected("custom")} className="accent-primary" />
              <span className="grid min-w-0 flex-1 grid-cols-2 gap-1" onClick={(event) => event.stopPropagation()}>
                <select aria-label="Custom provider" value={customProvider} onChange={(event) => { setCustomProvider(event.target.value); setSelected("custom"); }} className="cursor-pointer h-7 min-w-0 rounded-md border bg-background px-1.5 text-xs">
                  <option value="">Provider…</option>
                  {catalog.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.displayName}</option>)}
                </select>
                <CustomModelCombobox models={catalog.models.filter((model) => model.providerId === customProvider)} value={customModel} onPick={(model) => { setCustomModel(model); setSelected("custom"); }} />
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
  rounds: Array<{ n: number; strategyId: string; label: string; emoji: string; at: string; status: "ready" | "pending" | "missing"; missing: string[]; files: Array<{ display: string; path: string; absolutePath: string; hostId: string; generatedAt: string }> }>;
  looseFiles: Array<{ display: string; path: string; absolutePath: string; hostId: string }>;
  error: string | null;
};

function formatRoundDate(iso: string | null): string {
  if (!iso) return "";
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "";
  return new Date(time).toLocaleString();
}

// Path cells in the research index's Outputs table are workspace-relative
// paths; normalize so they match the resolved round/loose file entries the
// server already returns (which carry absolute paths + host ids for the
// artifact viewer).
function normalizeResearchPath(path: string): string {
  return String(path ?? "").replace(/^\.\//, "").replace(/\/+$/, "").trim();
}

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
function WorkerHistoryList({ history }: { history: CardDetailResponse["workerHistory"] }) {
  const navigate = useBbNavigate();
  if (history.length === 0) return null;
  return (
    <details className="border-t pt-2">
      <summary className="min-h-11 cursor-pointer text-xs font-medium text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Worker history ({history.length}) — archived threads stay readable</summary>
      <div className="mt-1 divide-y divide-border rounded-md border">
        {history.map((entry) => (
          <div key={entry.threadId} className="flex items-center gap-2 px-2 py-1.5 text-xs">
            <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${entry.endedAt === null ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              <span className="font-medium text-foreground">{entry.endedAt === null ? "Current worker" : ({ "band-swap": "Phase preset", restart: "Manual restart", reseed: "Restarted fresh", "strategy-add": "New strategy round", initial: "First worker" } as Record<string, string>)[entry.endedReason ?? ""] ?? "Replaced worker"}</span>
              {entry.presetName ? <span> · {entry.presetName}</span> : null}
              <span title={new Date(entry.startedAt).toLocaleString()}> · {relativeTime(entry.startedAt)}</span>
            </span>
            <button onClick={() => navigate.toThread(entry.threadId)} title="Open this worker thread (archived threads stay readable)." className="cursor-pointer min-h-11 shrink-0 rounded-md px-2 font-medium text-primary hover:underline">Open ↗</button>
          </div>
        ))}
      </div>
    </details>
  );
}

function CardConversation({ comments, draft, onDraftChange, onSend, defaultOpen = false }: {
  comments: CardDetailResponse["comments"]; draft: string; onDraftChange: (value: string) => void; onSend: () => void; defaultOpen?: boolean;
}) {
  return (
    <CardDisclosure
      title="Conversation"
      hint={comments.length ? `${comments.length}` : "talk to the agent"}
      defaultOpen={defaultOpen}
    >
      <div className="divide-y divide-border">
        {comments.length ? comments.map((entry) => (
          <div key={entry.id} className="py-2 first:pt-0 last:pb-0">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <Pill tone={entry.author === "agent" ? "bg-primary/15 text-primary" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"}>{entry.author}</Pill>
              <span>{new Date(entry.createdAt).toLocaleString()}</span>
            </div>
            <p className="mt-1 text-sm leading-relaxed"><Markdown content={entry.body} /></p>
          </div>
        )) : <p className="text-xs text-muted-foreground">No comments yet — send the first note to the agent below.</p>}
      </div>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Write to the agent</span>
        <textarea value={draft} onChange={(event) => onDraftChange(event.target.value)} rows={3} className="min-h-24 w-full rounded-md border bg-background p-2 text-sm leading-relaxed focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" placeholder="Ask, correct, or add context... (Cmd/Ctrl+Enter to send)" onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && draft.trim()) onSend(); }} />
      </label>
      <div className="flex justify-end"><Button disabled={!draft.trim()} onClick={() => onSend()}>Send to agent</Button></div>
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

function WorkerLifecycleActions({ actions, onRepair, onArchive, onDelete }: {
  actions: ReturnType<typeof workerActionPolicy>;
  onRepair: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  if (!actions.showRestartFresh && !actions.showStopAndArchive && !actions.showDelete) return null;
  return (
    <div className="mt-3 border-t pt-3">
      {actions.showRestartFresh ? <Button size="sm" variant="outline" onClick={onRepair} title="Start over with a new worker. Comments are kept.">Restart fresh…</Button> : null}
      {actions.showStopAndArchive || actions.showDelete ? (
        <details className={actions.showRestartFresh ? "mt-2" : ""}>
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">Card actions</summary>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {actions.showStopAndArchive ? <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={onArchive} title="Stop the worker and move this card to Archived. Comments and history are preserved.">Stop & archive…</Button> : null}
            {actions.showDelete ? <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={onDelete} title="Permanently delete this archived card. Comments and history are removed and cannot be recovered.">Delete…</Button> : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

// Shared worker block: preset readout, state-appropriate recovery, and worker
// history. Lifecycle actions are deliberately secondary: an active worker is
// not presented as something that should be restarted or archived casually.
function WorkerSection({ card, detail, presetStale, restarting, onRestartWorker, onRepair, onArchive, onDelete, onPreset, presetPill, presetNote, pillTitle, githubLink }: {
  card: CardItem | null;
  detail: CardDetailResponse | null;
  presetStale: boolean;
  restarting: boolean;
  onRestartWorker: () => void;
  onRepair: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onPreset: () => void;
  presetPill: React.ReactNode;
  presetNote: React.ReactNode;
  pillTitle?: string;
  githubLink?: React.ReactNode;
}) {
  const actions = workerActionPolicy(card, Boolean(detail?.card.needsAttention));
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
      <WorkerLifecycleActions actions={actions} onRepair={onRepair} onArchive={onArchive} onDelete={onDelete} />
      {githubLink}
      {detail ? <WorkerHistoryList history={detail.workerHistory} /> : null}
    </section>
  );
}

// Research-track card detail: hero + index + fan-out + artifacts + worker +
// conversation. Build-only surfaces (stages, timeline, gates, intent)
// never render here; every leaf below is shared with the build body.
function ResearchDetailBody({ cardId, inboxEventId, inboxEvent, onClose, navigate, card, detail, onChanged }: {
  cardId: string; inboxEventId: string | null; onClose: () => void; navigate: ReturnType<typeof useBbNavigate>;
  inboxEvent: InboxEventSnapshot | null; card: CardItem | null; detail: CardDetailResponse | null; onChanged: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [index, setIndex] = useState<ResearchIndexState | null>(null);
  const [indexRefresh, setIndexRefresh] = useState(0);
  const [strategies, setStrategies] = useState<ResearchStrategyOption[]>([]);
  const [comment, setComment] = useState("");
  const [repairOpen, setRepairOpen] = useState(false);
  const [restartWorkerOpen, setRestartWorkerOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [viewerFile, setViewerFile] = useState<{ display: string; path: string; target: WorkspaceFileTarget | HostFileTarget | null } | null>(null);
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
      setIndex({ found: false, indexPath: null, content: null, truncated: false, opportunities: [], rounds: [], looseFiles: [], error: "Unable to load the index." });
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

  async function doArchive() {
    setArchiveOpen(false);
    try {
      await rpc.call("cancelCard", { cardId });
      toast.success("Research archived.");
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
    toast.success("Research deleted.");
    onClose();
  }

  async function doRepair() {
    setRepairOpen(false);
    const result = await rpc.call("reseedCard", { cardId });
    if (!result.reseeded) {
      toast.error(result.error ?? "Restart failed");
      return;
    }
    toast.success("Fresh worker started on the same strategy.");
    onChanged();
    void loadIndex();
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
  const primaryStrategyLabel = card ? (strategyById.get(card.researchStrategy ?? "") ?? card.researchStrategy) : null;
  const available = index?.opportunities.filter((item) => !item.checked) ?? [];
  const indexGroups = useMemo(() => {
    const seen: string[] = [];
    for (const item of index?.opportunities ?? []) {
      const group = item.group ?? "Opportunities";
      if (!seen.includes(group)) seen.push(group);
    }
    return seen;
  }, [index]);
  // Structured body of the index: Summary prose + Outputs table with the Path
  // column resolved to clickable artifact buttons (same viewer as build cards).
  // Opportunities are intentionally NOT rendered from the raw markdown — the
  // interactive fan-out panel below is the only surface that shows them.
  const indexBody = useMemo(() => (index?.found && index.content ? parseResearchIndexSections(index.content) : null), [index]);
  const knownIndexFiles = useMemo(() => {
    const map = new Map<string, { display: string; path: string; absolutePath: string; hostId: string }>();
    for (const round of index?.rounds ?? []) {
      for (const file of round.files) map.set(normalizeResearchPath(file.path), file);
    }
    for (const file of index?.looseFiles ?? []) map.set(normalizeResearchPath(file.path), file);
    return map;
  }, [index]);

  return (
    <div className="flex h-full flex-col">
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
                      {strategyLabel ? <Pill tone="bg-primary/15 text-primary" title="Research strategy — the playbook driving this investigation.">{strategyLabel}</Pill> : null}
                      {card.workspaceKind === "exploratory" ? <p className="text-xs text-muted-foreground" title={card.workspacePath ?? undefined}>Exploratory work · stored locally</p> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-3">
                      {hero.kind === "decision" && pendingFirst ? <span className="w-full text-xs text-muted-foreground">Answer directly below — the first question is open.</span> : null}
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
                      {(hero.kind === "working" || hero.kind === "calm") && !(hero.kind === "calm" && card.activity === "idle" && card.workerThreadId && card.status !== "completed" && card.status !== "archived") ? (
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
                    <QuestionBatch cardId={card.id} mode="live" questions={detail?.pendingQuestions.map((q) => ({ id: q.id, title: q.title, prompt: q.question, multiple: q.multiple, options: q.options })) ?? []} onAnswered={() => { onChanged(); void loadIndex(); }} onOpenArtifact={(a) => openAskArtifact(card, detail?.fileEnvironmentId ?? null, setViewerFile, a)} />
                  </div>
                ) : null}
                {detail && detail.expiredQuestions.length > 0 ? <div className="mt-3 border-t border-amber-500/20 pt-3"><ExpiredQuestionsSection cardId={card.id} questions={detail.expiredQuestions} onOpenArtifact={(a) => openAskArtifact(card, detail.fileEnvironmentId, setViewerFile, a)} onAnswered={() => { onChanged(); void loadIndex(); }} /></div> : null}
              </section>
            ) : null}

            <WorkerSection
              card={card}
              detail={detail}
              presetStale={presetStale}
              restarting={restarting}
              onRestartWorker={() => setRestartWorkerOpen(true)}
              onRepair={() => setRepairOpen(true)}
              onArchive={() => setArchiveOpen(true)}
              onDelete={() => setDeleteOpen(true)}
              onPreset={() => setPresetDialogOpen(true)}
              presetPill={<>Research · {detail?.card.presetName ?? "default"}</>}
              presetNote={<>Applies to the next worker — Resume keeps the current one.</>}
              pillTitle="Preset for the next worker"
            />

            <CardDisclosure
              title="Research results"
              hint={index && index.found ? `${available.length} available · ${index.opportunities.length} total` : "being prepared"}
              defaultOpen
            >
              {!index ? <p className="text-xs text-muted-foreground">Preparing results…</p> : null}
              {index && !index.found ? <p className="text-xs text-muted-foreground">Results are still being prepared.</p> : null}
              {index?.found && index.content ? (
                indexBody && (indexBody.summary !== null || indexBody.outputs.length > 0) ? (
                  <div className="space-y-3">
                    {indexBody.summary ? <div className="text-sm leading-relaxed"><Markdown content={indexBody.summary} /></div> : null}
                    {indexBody.outputs.length > 0 ? (
                      <div className="overflow-x-auto rounded-md border">
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="border-b bg-muted/20 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                              <th className="px-3 py-2">Strategy</th>
                              <th className="px-3 py-2">Round</th>
                              <th className="px-3 py-2">Output</th>
                              <th className="px-3 py-2">Artifact</th>
                              <th className="px-3 py-2">Notes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {indexBody.outputs.map((row, rowIndex) => {
                              const entry = knownIndexFiles.get(normalizeResearchPath(row.path));
                              return (
                                <tr key={`${row.path}-${rowIndex}`} className="border-b last:border-0">
                                  <td className="px-3 py-2 align-top">{row.strategy || "—"}</td>
                                  <td className="px-3 py-2 align-top">{row.round || "—"}</td>
                                  <td className="px-3 py-2 align-top text-muted-foreground">{row.output || "—"}</td>
                                  <td className="px-3 py-2 align-top">
                                    {entry ? (
                                      <button
                                        onClick={() => setViewerFile({ display: entry.display, path: entry.absolutePath, target: fileLinkTarget(card.workspaceKind === "exploratory", detail?.fileEnvironmentId ?? null, entry.path, entry.hostId, entry.absolutePath) })}
                                        title={`Open ${entry.display}`}
                                        className="cursor-pointer min-h-11 rounded-md border bg-background px-2.5 py-1 text-xs font-medium hover:border-primary/50"
                                      >
                                        {entry.display} ↗
                                      </button>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">{row.path}</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 align-top text-muted-foreground">{row.notes || "—"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  /* Contract-missing index: render the raw body without its Opportunities section so nothing duplicates the panel below. */
                  <div className="text-sm leading-relaxed"><Markdown content={stripResearchOpportunities(index.content)} /></div>
                )
              ) : null}
              {index?.truncated ? <p className="text-xs text-muted-foreground">Results are shortened here. Open the full research file at {index.indexPath}.</p> : null}
              {index?.found && index.opportunities.length > 0 ? (
                <div className="space-y-2 border-t pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Opportunities ({index.opportunities.length})</h4>
                    <span className="flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => setStrategyRunOpen(true)} title="Run another strategy on the same request. Its findings are added to these results.">Explore another strategy…</Button>
                          <Button size="sm" variant="outline" disabled={available.length === 0} onClick={() => setFanOutOpen(true)} title="Select opportunities, then create the build cards.">Select To Build</Button>
                    </span>
                  </div>
                  {indexGroups.map((group) => (
                    <div key={group} className="space-y-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{group}</p>
                      {(index?.opportunities ?? []).filter((item) => (item.group ?? "Opportunities") === group).map((item) => (
                        <div key={item.id} className="flex items-start gap-2 text-sm">
                          {/* Status overview only — selection happens in the fan-out dialog, so no fake checkboxes here. */}
                          <span className="mt-0.5 w-4 shrink-0 text-center" aria-hidden>{item.checked ? "✓" : ""}</span>
                          <span className={item.checked ? "text-muted-foreground line-through" : ""}>{item.title}</span>
                          {item.checked ? <span className="shrink-0 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">fanned out</span> : null}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : null}
            </CardDisclosure>

            {(index && (index.rounds.length > 0 || index.looseFiles.length > 0)) ? (
              <CardDisclosure title="Rounds" hint={`${index.rounds.length} round${index.rounds.length === 1 ? "" : "s"} · newest first`}>
                <div className="space-y-1.5">
                  {index.rounds.map((round) => {
                    const when = formatRoundDate(round.files[0]?.generatedAt || round.at);
                    return (
                      <div key={`${round.strategyId}-r${round.n}`} className="rounded-md border bg-muted/20 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                          <span aria-hidden>{round.emoji}</span>
                          <span className="font-medium">Round {round.n} — {round.label}</span>
                          {when ? <span className="text-xs text-muted-foreground">{when}</span> : null}
                          {round.status === "pending" ? <span className="text-xs text-muted-foreground">Running…</span> : null}
                          {round.status === "missing" ? <span className="text-xs text-muted-foreground">No file saved yet</span> : null}
                          {round.missing.length > 0 ? <span className="text-xs text-amber-700 dark:text-amber-300" title="Expected sub-outputs not saved yet">Missing: {round.missing.join(", ")}</span> : null}
                        </div>
                        {round.files.length > 0 ? (
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {round.files.map((file) => (
                              <button
                                key={file.path}
                                onClick={() => setViewerFile({ display: file.display, path: file.absolutePath, target: fileLinkTarget(card.workspaceKind === "exploratory", detail?.fileEnvironmentId ?? null, file.path, file.hostId, file.absolutePath) })}
                                title={`Open ${file.display}`}
                                className="cursor-pointer min-h-11 rounded-md border bg-background px-2.5 py-1 text-xs font-medium hover:border-primary/50"
                              >
                                {file.display} ↗
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {index.looseFiles.length > 0 ? (
                    <div className="rounded-md border border-dashed px-3 py-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Other files in the state dir</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {index.looseFiles.map((file) => (
                          <button
                            key={file.path}
                            onClick={() => setViewerFile({ display: file.display, path: file.absolutePath, target: fileLinkTarget(card.workspaceKind === "exploratory", detail?.fileEnvironmentId ?? null, file.path, file.hostId, file.absolutePath) })}
                            title={`Open ${file.display}`}
                            className="cursor-pointer min-h-11 rounded-md border bg-background px-2.5 py-1 text-xs font-medium hover:border-primary/50"
                          >
                            {file.display} ↗
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </CardDisclosure>
            ) : null}

            <CardDisclosure title="Supporting files" hint={detail ? `${detail.artifacts.length}` : "produced files"}>
              {detail ? (
                <ArtifactGroups
                  artifacts={detail.artifacts}
                  workspaceKind={card.workspaceKind}
                  fileEnvironmentId={detail.fileEnvironmentId}
                  onView={(file) => setViewerFile(file)}
                />
              ) : <p className="text-xs text-muted-foreground">Loading…</p>}
            </CardDisclosure>

            <CardConversation comments={detail?.comments ?? []} draft={comment} onDraftChange={setComment} onSend={() => void submitComment()} defaultOpen={hero?.kind === "decision"} />

          </>
        ) : null}
        </div>
      </div>
      <ConfirmActionDialog
        open={repairOpen}
        onOpenChange={setRepairOpen}
        title="Restart with a fresh worker?"
        description={`A new worker restarts ${primaryStrategyLabel ? `the ${primaryStrategyLabel} strategy` : "the original strategy"} from scratch with clean research results — later rounds are discarded. Existing comments are kept. Try Retry first — restart only if the worker itself is broken.`}
        confirmLabel="Restart fresh"
        confirmTone="default"
        onConfirm={doRepair}
      />
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
      <ConfirmActionDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Stop and archive this research?"
        description="The worker stops and the research moves to Archived. Comments and history are preserved."
        confirmLabel="Stop & archive"
        confirmTone="destructive"
        onConfirm={doArchive}
      />
      <ConfirmActionDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this research permanently?"
        description="The archived research, its comments, and its history are removed from Stelow and cannot be recovered."
        confirmLabel="Delete"
        confirmTone="destructive"
        onConfirm={doDelete}
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
  const [repairOpen, setRepairOpen] = useState(false);
  const [restartWorkerOpen, setRestartWorkerOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [viewerFile, setViewerFile] = useState<{ display: string; path: string; target: WorkspaceFileTarget | HostFileTarget | null } | null>(null);
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

  async function doArchive() {
    setArchiveOpen(false);
    try {
      await rpc.call("cancelCard", { cardId });
      toast.success("Exploration archived.");
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
    toast.success("Exploration deleted.");
    onClose();
  }

  async function doRepair() {
    setRepairOpen(false);
    const result = await rpc.call("reseedCard", { cardId });
    if (!result.reseeded) {
      toast.error(result.error ?? "Restart failed");
      return;
    }
    toast.success("Fresh worker started on the same stage.");
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
    <div className="flex h-full flex-col">
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
                      {stageLabel ? <Pill tone="bg-primary/15 text-primary" title="Workflow stage — the single playbook this exploration runs.">{stageLabel}</Pill> : null}
                      {card.workspaceKind === "exploratory" ? <p className="text-xs text-muted-foreground" title={card.workspacePath ?? undefined}>Exploratory work · stored locally</p> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-3">
                      {hero.kind === "decision" && pendingFirst ? <span className="w-full text-xs text-muted-foreground">Answer directly below — the first question is open.</span> : null}
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
                      {(hero.kind === "working" || hero.kind === "calm") && !(hero.kind === "calm" && card.activity === "idle" && card.workerThreadId && card.status !== "completed" && card.status !== "archived") ? (
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
                    <QuestionBatch cardId={card.id} mode="live" questions={detail?.pendingQuestions.map((q) => ({ id: q.id, title: q.title, prompt: q.question, multiple: q.multiple, options: q.options })) ?? []} onAnswered={() => onChanged()} />
                  </div>
                ) : null}
                {detail && detail.expiredQuestions.length > 0 ? <div className="mt-3 border-t border-amber-500/20 pt-3"><ExpiredQuestionsSection cardId={card.id} questions={detail.expiredQuestions} onOpenArtifact={(a) => openAskArtifact(card, detail.fileEnvironmentId, setViewerFile, a)} onAnswered={() => onChanged()} /></div> : null}
              </section>
            ) : null}

            <WorkerSection
              card={card}
              detail={detail}
              presetStale={presetStale}
              restarting={restarting}
              onRestartWorker={() => setRestartWorkerOpen(true)}
              onRepair={() => setRepairOpen(true)}
              onArchive={() => setArchiveOpen(true)}
              onDelete={() => setDeleteOpen(true)}
              onPreset={() => setPresetDialogOpen(true)}
              presetPill={<>Explore · {detail?.card.presetName ?? "default"}</>}
              presetNote={<>Applies to the next worker — Resume keeps the current one.</>}
              pillTitle="Preset for the next worker"
            />

            <CardDisclosure title="Result" hint={detail ? `Files: ${detail.artifacts.length}` : "being prepared"} defaultOpen>
              {detail ? (
                <ArtifactGroups
                  artifacts={detail.artifacts}
                  workspaceKind={card.workspaceKind}
                  fileEnvironmentId={detail.fileEnvironmentId}
                  onView={(file) => setViewerFile(file)}
                />
              ) : <p className="text-xs text-muted-foreground">Loading…</p>}
            </CardDisclosure>

            <CardConversation comments={detail?.comments ?? []} draft={comment} onDraftChange={setComment} onSend={() => void submitComment()} defaultOpen={hero?.kind === "decision"} />

          </>
        ) : null}
        </div>
      </div>
      <ConfirmActionDialog
        open={repairOpen}
        onOpenChange={setRepairOpen}
        title="Restart with a fresh worker?"
        description={`A new worker restarts ${stageLabel ? `the ${stageLabel} stage` : "the stage"} from scratch with a clean workspace — existing artifacts are discarded. Existing comments are kept. Try Retry first — restart only if the worker itself is broken.`}
        confirmLabel="Restart fresh"
        confirmTone="default"
        onConfirm={doRepair}
      />
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
        onCommented={onChanged}
      />
      <ConfirmActionDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Stop and archive this exploration?"
        description="The worker stops and the exploration moves to Archived. Comments and history are preserved."
        confirmLabel="Stop & archive"
        confirmTone="destructive"
        onConfirm={doArchive}
      />
      <ConfirmActionDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this exploration permanently?"
        description="The archived exploration, its comments, and its history are removed from Stelow and cannot be recovered."
        confirmLabel="Delete"
        confirmTone="destructive"
        onConfirm={doDelete}
      />
    </div>
  );
}

function CardDetailBody({ cardId, inboxEventId, onClose, navigate }: { cardId: string; inboxEventId: string | null; onClose: () => void; navigate: ReturnType<typeof useBbNavigate> }) {
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
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoteName, setPromoteName] = useState("");
  const [promoting, setPromoting] = useState(false);
  const [githubPostOpen, setGithubPostOpen] = useState(false);
  const [githubCloseIssue, setGithubCloseIssue] = useState(false);
  const [githubPosting, setGithubPosting] = useState(false);
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [viewerFile, setViewerFile] = useState<{ display: string; path: string; target: WorkspaceFileTarget | HostFileTarget | null } | null>(null);
  const [inboxEvent, setInboxEvent] = useState<InboxEventSnapshot | null>(null);
  const inboxEventRef = useRef<HTMLElement | null>(null);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const [artifactStage, setArtifactStage] = useState<string | null>(null);
  type CardDiff = { found: boolean; isRepo: boolean; files: Array<{ path: string; display: string; patch: string | null; isNew: boolean; absolutePath: string; hostId: string }>; truncated: boolean; entitySummary: { total: number; fileCount: number; added: number; modified: number; deleted: number; renamed: number; moved: number; cosmeticOnly: boolean } | null; changedSymbols: Array<{ symbol: string; files: string[]; callers: number; testCallers: number }> | null };
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffData, setDiffData] = useState<CardDiff | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const artifactsRef = useRef<HTMLDivElement | null>(null);
  // Count badges on the timeline deep-link here: open the section, remember
  // which stage was asked about (its group rings + scrolls into view), then
  // bring the section into view. Instant scroll (no smooth) to respect
  // reduced motion by default.
  const showArtifacts = useCallback((stage: string | null) => {
    if (stage) setArtifactStage(stage);
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

  useEffect(() => { void load(); }, [load, detailRefresh]);
  useDebouncedRealtime(["card-state", "inbox-changed"], () => void load());
  // Viewing a completed card marks its completion seen (read, never
  // resolved): the badge drops, Recent updates keeps the entry. Fires on
  // mount-if-completed and on the transition; steady state never refires
  // because the dep is the status value, not the card object.
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
    await load();
  }

  async function doArchive() {
    setArchiveOpen(false);
    try {
      await rpc.call("cancelCard", { cardId });
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
      toast.success(`Turned into project "${result.projectName}".`);
      await load();
    } finally {
      setPromoting(false);
    }
  }

  async function doRepair() {
    setRepairOpen(false);
    const result = await rpc.call("reseedCard", { cardId });
    if (!result.reseeded) {
      toast.error(result.error ?? "Restart failed");
      return;
    }
    toast.success("Fresh worker started from triage.");
    await load();
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
  // Provider/model are fixed at spawn: a preset change only lands when a new
  // worker starts. Retry continues the SAME thread, so while the running
  // worker predates the override the hero must offer Restart, not Resume.
  // Staleness is the explicit restart-pending flag (set on assign, healed by
  // thread-birth comparison) with id-mismatch as backup.
  const presetStale = Boolean(detail && card?.workerThreadId && (detail.card.presetRestartPending || (detail.card.workerPresetId && detail.card.workerPresetId !== detail.card.presetId)));
  const scopeDone = detail?.scopes.filter((s) => ["done", "completed"].includes(s.status ?? "")).length ?? 0;
  const scopeTotal = detail?.scopes.length ?? 0;
  const openScope = detail?.scopes.find((s) => s.status === "in-progress") ?? null;
  // Gate review entry: the artifact the pending decision is about. Gate
  // reviews the shaped spec, int-gate/selection the interface proposals,
  // plan-gate the tech plan. Falls back to the newest artifact, if any.
  const GATE_ARTIFACT_STAGE: Record<string, string> = { gate: "shape", "int-gate": "interface", selection: "interface", "plan-gate": "planning" };
  const reviewArtifact = detail && card && (hero?.kind === "decision" || detail.pendingQuestions.length > 0)
    ? detail.artifacts.find((artifact) => artifact.stage === (GATE_ARTIFACT_STAGE[card.stage] ?? "")) ?? detail.artifacts[detail.artifacts.length - 1] ?? null
    : null;

  return (
    <div className="flex h-full flex-col">
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
                    {card.workspaceKind === "exploratory" ? <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" title={card.workspacePath ?? undefined}><span>Exploratory work · stored locally</span><Button size="sm" variant="outline" onClick={() => { setPromoteName(card.displayName); setPromoteOpen(true); }} title="Create a BB project from this workspace so the work lives as a real project. Files stay in place.">Turn into project…</Button></p> : null}
                    {/* One primary action per state; secondary actions are real
                        buttons (outline/ghost) so affordances never read as
                        body text. */}
                    <div className="flex flex-wrap items-center gap-2 pt-3">
                      {hero.kind === "decision" && pendingFirst ? <span className="w-full text-xs text-muted-foreground">Answer directly below — the first question is open.</span> : null}
                      {hero.kind === "decision" && reviewArtifact ? (
                        <span className="w-full">
                          <Button size="sm" variant="outline" onClick={() => setViewerFile({ display: reviewArtifact.display, path: reviewArtifact.absolutePath, target: fileLinkTarget(card.workspaceKind === "exploratory", detail?.fileEnvironmentId ?? null, reviewArtifact.path, reviewArtifact.hostId, reviewArtifact.absolutePath) })} title={`Read ${reviewArtifact.display} before deciding`}>Review artifact ↗</Button>
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
                      {(hero.kind === "working" || hero.kind === "calm") && !(hero.kind === "calm" && card.activity === "idle" && card.workerThreadId && card.status !== "completed" && card.status !== "archived") ? (
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
                    <QuestionBatch cardId={card.id} mode="live" questions={detail?.pendingQuestions.map((q) => ({ id: q.id, title: q.title, prompt: q.question, multiple: q.multiple, options: q.options })) ?? []} onAnswered={() => void load()} />
                  </div>
                ) : null}
                {detail && detail.expiredQuestions.length > 0 ? <div className="mt-3 border-t border-amber-500/20 pt-3"><ExpiredQuestionsSection cardId={card.id} questions={detail.expiredQuestions} onOpenArtifact={(a) => openAskArtifact(card, detail.fileEnvironmentId, setViewerFile, a)} onAnswered={() => void load()} /></div> : null}
              </section>
            ) : null}

            <WorkerSection
              card={card}
              detail={detail}
              presetStale={presetStale}
              restarting={restarting}
              onRestartWorker={() => setRestartWorkerOpen(true)}
              onRepair={() => setRepairOpen(true)}
              onArchive={() => setArchiveOpen(true)}
              onDelete={() => setDeleteOpen(true)}
              onPreset={() => setPresetDialogOpen(true)}
              presetPill={<>{card.stage ? `${BAND_LABEL[STAGE_BAND[card.stage] ?? "analysis"]} · ` : ""}{detail?.card.presetName ?? "default"}</>}
              presetNote={<>{card.stage ? <strong>{stageLabel(card.stage)}</strong> : "current"} phase{detail?.card.presetOverridden ? " — overridden for this card" : " — board default"} · applies to the next worker</>}
              pillTitle={card.stage ? `Preset for the ${stageLabel(card.stage)} phase` : "Preset for the next worker"}
              githubLink={detail?.githubLink ? (
                <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
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
            />

            {/* DISCLOSURE 1 — What is happening (progress + details on demand) */}
            <CardDisclosure
              title="What is happening"
              hint={scopeTotal > 0 ? `${scopeDone}/${scopeTotal} scopes${openScope ? ` · now: ${openScope.name}` : ""}` : stageLabel(card.stage)}
              defaultOpen={hero?.kind === "working" || hero?.kind === "calm"}
            >
              {card.stage === "select" ? (
                <p className="text-xs text-muted-foreground">
                  Item selection: pick the item in the thread — the agent advances on its own, or advance manually below.
                </p>
              ) : null}
              {detail && detail.scopes.length > 0 ? <ScopesList scopes={detail.scopes} /> : <p className="text-xs text-muted-foreground">No scopes broken down yet — the agent is still shaping the card.</p>}
              {detail ? (
                <div className="space-y-2 border-t pt-3">
                  <div className="flex items-center gap-2">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Progress</h4>
                    <span className="text-xs text-muted-foreground">Agent advances alone · click a lit stage to override</span>
                  </div>
                  <StageTimeline
                    currentStage={card.stage}
                    nextStages={detail.nextStages}
                    artifacts={detail.artifacts}
                    onPick={(stage) => setPendingAdvance(stage)}
                    onShowArtifacts={(stage) => showArtifacts(stage)}
                    skips={detail.stageSkips ?? { offRoute: [], skipped: [] }}
                    offRouteReason={card.intent && card.intent !== "unknown" ? `Not in this ${INTENT_LABEL[card.intent] ?? card.intent} route` : null}
                  />
                </div>
              ) : null}
              {detail?.attachments && detail.attachments.length > 0 ? (
                <div className="space-y-1 border-t pt-3">
                  <span className="text-xs font-medium text-muted-foreground">Attachments ({detail.attachments.length}):</span>
                  <div className="flex flex-wrap gap-1">
                    {detail.attachments.map((attachment) => {
                      const canPreview = card.workspaceKind === "exploratory" && detail.fileEnvironmentId && attachment.relPath;
                      return canPreview ? (
                        <button
                          key={`${attachment.type}:${attachment.path}`}
                          onClick={() => setViewerFile({ display: attachment.display, path: attachment.relPath ?? attachment.path, target: fileLinkTarget(true, detail.fileEnvironmentId, attachment.relPath, "", "") })}
                          className="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-xs text-foreground hover:bg-sky-500/20"
                          title={`Review ${attachment.display}`}
                        >
                          <span>{attachment.type === "localImage" ? "🖼️" : "📎"}</span>
                          <span>{attachment.display}</span>
                        </button>
                      ) : (
                        <button
                          key={`${attachment.type}:${attachment.path}`}
                          onClick={() => card.workerThreadId && navigate.toThread(card.workerThreadId)}
                        disabled={!card.workerThreadId}
                        className="disabled:cursor-not-allowed cursor-pointer inline-flex min-h-11 items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-xs text-foreground hover:bg-sky-500/20 disabled:opacity-50"
                        title="Open the worker thread; BB renders this original attachment there."
                      >
                        <span>{attachment.type === "localImage" ? "🖼️" : "📎"}</span>
                        <span>{attachment.display}</span>
                      </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              {detail?.mentionedFiles && detail.mentionedFiles.length > 0 ? (
                <div className="space-y-1 border-t pt-3">
                  <span className="text-xs font-medium text-muted-foreground">Mentioned files ({detail.mentionedFiles.length}):</span>
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

            <div ref={artifactsRef}>
            <CardDisclosure
              title="Artifacts"
              hint={detail ? `${detail.artifacts.length} files · audit trail` : "produced files"}
              open={artifactsOpen}
              onToggle={setArtifactsOpen}
            >
              {detail ? (
                <ArtifactGroups
                  artifacts={detail.artifacts}
                  workspaceKind={card.workspaceKind}
                  fileEnvironmentId={detail.fileEnvironmentId}
                  onView={(file) => setViewerFile(file)}
                  highlightStage={artifactStage}
                />
              ) : <p className="text-xs text-muted-foreground">Loading…</p>}
            </CardDisclosure>
            </div>

            {card && (card.stage === "diff-gate" || card.stage === "audit") ? (
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

            {/* Conversation (history + composer) */}
            <CardConversation comments={detail?.comments ?? []} draft={comment} onDraftChange={setComment} onSend={() => void submitComment()} defaultOpen={hero?.kind === "decision"} />

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
        onConfirm={doRepair}
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
        title="Stop and archive this card?"
        description="The worker stops and the card moves to Archived. Comments and history are preserved."
        confirmLabel="Stop & archive"
        confirmTone="destructive"
        onConfirm={doArchive}
      />
      <ConfirmActionDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this card permanently?"
        description="The archived card, its comments, and its history are removed from Stelow and cannot be recovered."
        confirmLabel="Delete"
        confirmTone="destructive"
        onConfirm={doDelete}
      />
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
                Creates a BB project from this workspace. Files stay in place and the worker continues from the current stage.
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
    "@keyframes stelow-card-alive { 0%, 100% { border-color: hsl(220 90% 60% / 0.5); box-shadow: 0 0 0 0 hsl(220 90% 60% / 0), 0 0 12px hsl(220 90% 60% / 0.08); } 35% { border-color: hsl(280 80% 60% / 0.82); box-shadow: 0 0 0 2px hsl(280 80% 60% / 0.10), 0 0 18px hsl(280 80% 60% / 0.14); } 70% { border-color: hsl(160 75% 48% / 0.72); box-shadow: 0 0 0 1px hsl(160 75% 48% / 0.10), 0 0 15px hsl(160 75% 48% / 0.12); } }",
    ".stelow-board-card.stelow-border-running, details.stelow-border-running { border-color: hsl(220 90% 60% / 0.5) !important; animation: stelow-card-alive 3.2s ease-in-out infinite; }",
    "@media (prefers-reduced-motion: reduce) { .stelow-board-card.stelow-border-running, details.stelow-border-running { animation: none; border-color: hsl(220 90% 60% / 0.7) !important; } }", 
    ".stelow-board-card.stelow-border-attention { border-color: hsl(38 92% 50% / 0.85) !important; box-shadow: 0 0 0 3px hsl(38 92% 50% / 0.12); }",
    "@keyframes stelow-shimmer { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }",
    ".stelow-pill-working { background: linear-gradient(90deg, hsl(220 90% 60% / 0.18), hsl(280 80% 60% / 0.45), hsl(220 90% 60% / 0.18)); background-size: 200% 100%; animation: stelow-shimmer 1.6s linear infinite; color: hsl(220 90% 40%); }",
    "@keyframes stelow-breathe { 0% { opacity: 0.55; } 50% { opacity: 1; } 100% { opacity: 0.55; } }",
    ".stelow-activity-pill { display: inline-flex; align-items: center; gap: 0.25rem; border-radius: 9999px; padding: 0.125rem 0.5rem; font-size: 11px; line-height: 18px; font-weight: 500; border-width: 1px; border-style: dashed; }",
    ".stelow-activity-onhold { border-color: hsl(240 5% 55% / 0.55); color: hsl(240 3% 45%); background: transparent; }",
    ".stelow-activity-waiting { border-color: hsl(38 92% 45% / 0.7); color: hsl(38 80% 28%); background: hsl(38 92% 45% / 0.10); }",
    ".stelow-activity-error { border-color: hsl(0 84% 55% / 0.7); color: hsl(0 70% 40%); background: hsl(0 84% 55% / 0.08); }",
    ".stelow-activity-working { border-color: hsl(220 90% 60% / 0.6); color: hsl(220 60% 40%); background: hsl(220 90% 60% / 0.08); animation: stelow-breathe 1.8s ease-in-out infinite; }",
    ".dark .stelow-activity-onhold { border-color: hsl(240 5% 60% / 0.5); color: hsl(240 10% 70%); }",
    ".dark .stelow-activity-waiting { border-color: hsl(38 92% 55% / 0.65); color: hsl(40 80% 75%); }",
    ".dark .stelow-activity-error { border-color: hsl(0 84% 60% / 0.65); color: hsl(0 80% 80%); }",
    ".dark .stelow-activity-working { border-color: hsl(220 90% 65% / 0.6); color: hsl(220 70% 80%); }",
  ].join("\n");
  document.head.appendChild(style);
  return null;
}

function QuestionForm({ interaction, submit, cancel }: PluginPendingInteractionProps) {
  const payload = interaction.payload as { question?: string; multiple?: boolean; options?: Array<{ label: string; description: string; preview: string | null; artifact: AskArtifact | null }>; questions?: Array<{ question?: string; multiple?: boolean; options?: Array<{ label: string; description: string; preview: string | null; artifact: AskArtifact | null }> }> };
  // Thread payloads carry raw artifact paths (no viewer here to resolve
  // against); normalize to the shared shape so display never renders
  // undefined. Open affordances stay card-only by design.
  const toArtifact = (raw: unknown): AskArtifact | null => {
    const path = typeof raw === "string" ? raw : (raw as { path?: unknown } | null)?.path;
    const normalized = normalizeAskArtifactPath(path);
    return normalized ? { ...normalized, absolutePath: null, hostId: null } : null;
  };
  const clean = (options: unknown): BatchItem["options"] => Array.isArray(options)
    ? options.filter((o): o is { label: string; description: string; preview: string | null; artifact: AskArtifact | null } => !!o && typeof o === "object" && typeof (o as { label?: unknown }).label === "string").map((o) => ({ label: o.label, description: typeof o.description === "string" ? o.description : "", preview: typeof o.preview === "string" ? o.preview : null, artifact: toArtifact((o as { artifact?: unknown }).artifact) }))
    : [];
  // Batch payloads (one `bb stelow ask` call with repeated --question groups)
  // answer together; single-question payloads keep their exact shape.
  const items: BatchItem[] = Array.isArray(payload.questions) && payload.questions.length > 0
    ? payload.questions.map((q, i) => ({ id: `q${i}`, title: interaction.title, prompt: typeof q?.question === "string" ? q.question : "", multiple: q?.multiple === true, options: clean(q?.options) })).filter((q) => q.options.length > 0)
    : [{ id: "q0", title: interaction.title, prompt: payload.question ?? interaction.title, multiple: payload.multiple === true, options: clean(payload.options) }];
  if (items.length === 0) return null;
  const batched = items.length > 1;
  return (
    <div className="space-y-3">
      <BatchStepper
        questions={items}
        allowSkip
        busy={false}
        error={null}
        submitLabel={batched ? `Continue with ${items.length} answers` : "Continue"}
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
  return <button onClick={() => goToCard(navigate, { kind: target.kind }, target.cardId)} title="Open this card" className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md border bg-card px-3 py-2 text-xs font-medium shadow-sm hover:border-primary/50">Stelow card ↗</button>;
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
});

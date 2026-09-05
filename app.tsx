import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Markdown,
  experimental_SourceCode as SourceCode,
  definePluginApp,
  UrlLink,
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
import type { rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
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
const STAGE_SEQUENCE: string[] = [
  "triage", "select", "setup", "context", "shape", "critique", "gate",
  "scope", "interface", "int-gate", "selection", "planning", "plan-gate",
  "execution", "verification", "diff-gate", "audit",
];
// Which phase (band) each stage belongs to — shown as a visual group label on
// the timeline. This is the SINGLE place in the client that names phase
// groupings: they are an aggregation of stages, not a rival axis. KEEP IN SYNC
// with server.ts STAGE_BANDS (preset routing) and test_bands.mjs.
const STAGE_BAND: Record<string, string> = {
  triage: "analysis", select: "analysis", setup: "analysis", context: "analysis", shape: "analysis",
  critique: "planning", gate: "planning", scope: "planning", interface: "planning", "int-gate": "planning", selection: "planning", planning: "planning", "plan-gate": "planning",
  execution: "execution", verification: "execution",
  "diff-gate": "review", audit: "review",
};
const BAND_LABEL: Record<string, string> = { analysis: "Analyse", planning: "Plan", execution: "Execute", review: "Review" };
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

// Research track columns: a deliberately dumb To-Do / Doing / Done flow.
// Statuses reuse the shared enum (pending / in-progress / completed /
// archived) so no migration or guard changes are needed; the mapping lives
// in this one place.
const RESEARCH_COLUMNS = ["todo", "doing", "done", "archived"] as const;
const RESEARCH_COLUMN_LABELS: Record<string, string> = {
  todo: "To-Do",
  doing: "Doing",
  done: "Done",
  archived: "Archived",
};
function researchColumnOf(card: Pick<CardItem, "status">): string {
  if (card.status === "archived") return "archived";
  if (card.status === "completed") return "done";
  if (card.status === "in-progress" || card.status === "approved") return "doing";
  return "todo";
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
type CardQuestion = CardDetailResponse["pendingQuestions"][number];
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

// Activity is a transient worker state — subordinated to the status pill and
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
  { value: "Product Spec + Interface + Scopes", label: "Product Spec + Interface + Scopes", description: "Also confirm the planned delivery scopes." },
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
      // Badge = work genuinely awaiting the user. Resolved history and
      // completions must never inflate it, or the count loses credibility.
      setCount(result.notifications.filter((entry) => entry.archivedAt === null && entry.resolvedAt === null && entry.kind !== "completed").length);
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

function useWorkAccessory(): SidebarAccessoryHandle {
  const rpc = useRpc<typeof rpcContract>();
  const [count, setCount] = useState(0);
  const reload = useCallback(async () => {
    try {
      const result = await rpc.call("listCards", { projectId: null, kind: "delivery" });
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

function StelowWorkSidebarAccessory() {
  const { count, tone } = useWorkAccessory();
  return <SidebarCount count={count} tone={tone} label={`${count} active Stelow work items`} />;
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

function StelowResearchSidebarAccessory() {
  const { count, tone } = useResearchAccessory();
  return <SidebarCount count={count} tone={tone} label={`${count} active Stelow research items`} />;
}

type InboxNotification = {
  id: string; cardId: string; cardName: string; projectName: string; cardKind: "delivery" | "research";
  kind: "question" | "error" | "paused" | "completed";
  summary: string; occurredAt: number; readAt: number | null; resolvedAt: number | null; archivedAt: number | null;
};

const INBOX_COPY: Record<InboxNotification["kind"], { icon: string; label: string; tone: string }> = {
  question: { icon: "?", label: "Needs a decision", tone: "bg-amber-500/15 text-amber-700" },
  error: { icon: "!", label: "Worker failed", tone: "bg-destructive/15 text-destructive" },
  paused: { icon: "Ⅱ", label: "Work paused", tone: "bg-amber-500/15 text-amber-700" },
  completed: { icon: "✓", label: "Completed", tone: "bg-emerald-500/15 text-emerald-700" },
};

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

function InboxPanel() {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [notifications, setNotifications] = useState<InboxNotification[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setNotifications((await rpc.call("listNotifications", { includeArchived: showArchived })).notifications);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load Stelow Inbox.");
    }
    finally { setLoading(false); }
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
    navigate.toPluginPanel(entry.cardKind === "research" ? "research" : "board", { subPath: `card/${entry.cardId}/event/${entry.id}` });
  }
  async function archive(entry: InboxNotification) { await rpc.call("archiveNotification", { notificationId: entry.id }); await load(); }
  async function restore(entry: InboxNotification) { await rpc.call("restoreNotification", { notificationId: entry.id }); await load(); }
  const Section = ({ title, entries }: { title: string; entries: InboxNotification[] }) => !entries.length ? null : (
    <section className="space-y-2" aria-label={title}>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <div className="divide-y rounded-md border">
        {entries.map((entry) => {
          const copy = INBOX_COPY[entry.kind];
          return <div key={entry.id} className={`flex items-start gap-2 p-3 sm:gap-3 ${entry.readAt ? "bg-background" : "bg-amber-500/5"}`}>
            <button onClick={() => void open(entry)} className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-sm text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
              <span aria-hidden className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${copy.tone}`}>{copy.icon}</span>
              <span className="min-w-0"><span className="flex flex-wrap items-center gap-x-2"><strong className="text-sm">{entry.cardName}</strong>{!entry.readAt ? <span className="size-1.5 rounded-full bg-primary"><span className="sr-only">Unread</span></span> : null}</span><span className="mt-0.5 block text-sm text-muted-foreground">{entry.summary.toLowerCase().includes(copy.label.toLowerCase()) ? entry.summary : `${copy.label}. ${entry.summary}`}</span><span className="mt-1 block text-xs text-muted-foreground" title={new Date(entry.occurredAt).toLocaleString()}>{entry.projectName} · {relativeTime(entry.occurredAt)}</span></span>
            </button>
            <button onClick={() => void (entry.archivedAt ? restore(entry) : archive(entry))} className="cursor-pointer min-h-11 shrink-0 rounded-md px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{entry.archivedAt ? "Restore" : "Archive"}</button>
          </div>;
        })}
      </div>
    </section>
  );
  const archived = notifications.filter((entry) => entry.archivedAt !== null);
  return <div className="h-full overflow-auto bg-background p-4 md:p-6"><div className="mx-auto max-w-4xl space-y-5"><header className="flex items-start justify-between gap-3"><div><h1 className="text-xl font-semibold tracking-tight">Inbox</h1><p className="mt-1 text-sm text-muted-foreground">Work that needs you, plus recent completions.</p></div><button onClick={() => setShowArchived((value) => !value)} className="cursor-pointer min-h-11 rounded-md border px-3 text-sm font-medium hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{showArchived ? "Back to Inbox" : "View archived"}</button></header>{loading ? <p className="text-sm text-muted-foreground">Loading Inbox…</p> : loadError ? <section className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm"><p>{loadError}</p><button onClick={() => void load()} className="cursor-pointer mt-3 min-h-11 rounded-md border px-3 text-sm font-medium hover:bg-background">Retry</button></section> : showArchived ? <><Section title="Archived" entries={archived} />{!archived.length ? <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No archived notifications.</p> : null}</> : <><Section title={`Needs you${action.length ? ` (${action.length})` : ""}`} entries={action} /><Section title="Recent updates" entries={updates} />{resolved.length ? <details className="rounded-md border"><summary className="min-h-11 cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Resolved ({resolved.length}) — answered or cleared automatically</summary><div className="px-3 pb-3"><Section title="Resolved" entries={resolved} /></div></details> : null}{!action.length && !updates.length ? <section className="rounded-md border border-dashed bg-muted/30 p-8 text-center"><h2 className="text-sm font-semibold">All clear</h2><p className="mt-1 text-sm text-muted-foreground">Stelow will surface work when it needs you.</p></section> : null}</>}</div></div>;
}

function BoardPanel({ subPath }: { subPath: string }) {
  const { projectId: routeProjectId } = useBbContext();
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [cards, setCards] = useState<CardItem[]>([]);
  const [boardProjectId, setBoardProjectId] = useState<string | null>(routeProjectId);
  const [collapsedColumns, setCollapsedColumns] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return { archived: true };
    try {
      const raw = window.localStorage.getItem("stelow-columns-collapsed-v1");
      if (!raw) return { archived: true };
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      return typeof parsed === "object" && parsed ? parsed : { archived: true };
    } catch { return { archived: true }; }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem("stelow-columns-collapsed-v1", JSON.stringify(collapsedColumns)); } catch { /* ignore */ }
  }, [collapsedColumns]);
  const [loading, setLoading] = useState(true);
  const [createWorkOpen, setCreateWorkOpen] = useState(false);
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
  const [restartFocusKey, setRestartFocusKey] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [importLabel, setImportLabel] = useState("stelow-work");
  const [importCandidates, setImportCandidates] = useState<GithubCandidate[]>([]);
  const [importSelected, setImportSelected] = useState<Record<string, boolean>>({});
  const [importBusy, setImportBusy] = useState(false);
  const [githubStatus, setGithubStatus] = useState<GithubStatus | null>(null);
  const [buildInfo, setBuildInfo] = useState<{ version: string; builtAt: string | null } | null>(null);

  const load = useCallback(async (targetId: string | null) => {
    setLoading(true);
    try {
      const [projectsResult, cardsResult, presetsResult, bandPresetsResult, boardResult, buildResult] = await Promise.all([
        rpc.call("projects", {}).catch(() => null),
        rpc.call("listCards", { projectId: targetId, kind: "delivery" }).catch(() => ({ cards: [] })),
        rpc.call("listPresets", {}).catch(() => ({ presets: [] })),
        rpc.call("listBandPresets", {}).catch(() => ({ bands: [] })),
        rpc.call("board", { projectId: targetId }).catch(() => null),
        rpc.call("buildInfo", {}).catch(() => null),
      ]);
      setProjects(projectsResult?.projects ?? []);
      setCards(cardsResult.cards);
      setBoardPresets(presetsResult.presets);
      setBoardBandPresets(bandPresetsResult.bands);
      if (boardResult?.githubStatus) setGithubStatus(boardResult.githubStatus);
      if (buildResult) setBuildInfo(buildResult);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load Stelow.");
      setProjects([]);
      setCards([]);
    } finally {
      setLoading(false);
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
  const workerPolicy = ["analysis", "planning", "execution", "review"].map((band) => ({ band, preset: presetForBand(band) }));
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
      setCreateWorkOpen(false);
      navigate.openThreadPanel({ actionId: "stelow-card-detail", title: result.cardId, params: { cardId: result.cardId } });
      toast.success("Work started in Triage. Stelow will triage it.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to start work.");
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
      const { issues } = await rpc.call("listGithubCandidates", { label: importLabel.trim() });
      setImportCandidates(issues);
      // Preselect only issues not yet imported, so the flow is a one-click
      // "bring in everything tagged" rather than a long checklist.
      const fresh: Record<string, boolean> = {};
      for (const issue of issues) if (!issue.alreadyImported) fresh[`${issue.repo}#${issue.number}`] = true;
      setImportSelected(fresh);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to list GitHub issues.");
    } finally {
      setImportBusy(false);
    }
  }

  async function importSelectedIssues() {
    const chosen = importCandidates.filter((issue) => importSelected[`${issue.repo}#${issue.number}`]);
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

  const cardMatch = subPath.match(/^card\/(card_[A-Za-z0-9]+)(?:\/event\/(evt_[A-Za-z0-9]+))?\/?$/);
  if (cardMatch && cardMatch[1]) {
    const cardId = cardMatch[1];
    return (
      <div className="flex h-full flex-col overflow-hidden bg-background">
        <CardDetailHeader
          cardId={cardId}
          restartFocusKey={restartFocusKey}
          onBack={() => navigate.toPluginPanel("board", { subPath: "" })}
        />
        <div className="flex-1 overflow-auto">
          <CardDetailBody cardId={cardId} inboxEventId={cardMatch[2] ?? null} onClose={() => navigate.toPluginPanel("board", { subPath: "" })} navigate={navigate} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden bg-background">
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto max-w-[1500px] space-y-4">
          <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="max-w-2xl text-sm leading-5 text-muted-foreground">Stelow helps humans and AI agents operate as a cross-functional product team, not just coding assistants, through a structured product workflow.</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="text-xl font-semibold tracking-tight">Work</h1>
                <UrlLink href="https://github.com/calionauta/stelow" className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">About Stelow <span aria-hidden="true">↗</span></UrlLink>
                {buildInfo ? <span className="text-[11px] text-muted-foreground" title={buildInfo.builtAt ? `Built ${new Date(buildInfo.builtAt).toLocaleString()}` : "Running build"}>v{buildInfo.version}</span> : null}
              </div>
              {inbox.length > 0 ? <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">{inbox.length} {inbox.length === 1 ? "item needs" : "items need"} your attention</p> : null}
            </div>
            <div className="grid w-full grid-cols-2 gap-2 sm:mt-0.5 sm:flex sm:w-auto sm:items-center sm:gap-3">
              <div role="group" aria-label="Work view" className="col-span-2 inline-flex h-10 w-full rounded-md border bg-background p-0.5 shadow-sm sm:h-9 sm:w-auto sm:shrink-0">
                <button onClick={() => setViewMode("board")} aria-pressed={viewMode === "board"} className={`h-full flex-1 cursor-pointer rounded-[5px] px-3 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:flex-none ${viewMode === "board" ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>Board</button>
                <button onClick={() => setViewMode("list")} aria-pressed={viewMode === "list"} className={`h-full flex-1 cursor-pointer rounded-[5px] px-3 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:flex-none ${viewMode === "list" ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>List</button>
              </div>
              <Button className="h-10 w-full sm:h-9 sm:w-auto sm:flex-none" onClick={() => { setCreateOptionsOpen(false); setCreateWorkOpen(true); }}>New work</Button>
              {githubStatus?.pluginAvailable ? (
                <Button className="h-10 w-full sm:h-9 sm:w-auto sm:flex-none" variant="outline" onClick={() => { setImportOpen(true); void listGithubIssues(); }}>Import issues</Button>
              ) : null}
            </div>
          </header>
          {githubStatus !== null && githubStatus.pluginAvailable && !githubStatus.ghOk ? (
            <div className="mb-3 flex flex-col gap-1 rounded-md border p-2 text-xs sm:flex-row sm:items-center sm:gap-2">
              <span className="text-amber-700 dark:text-amber-300">Import issues needs a GitHub account linked in the <span className="font-medium">github</span> plugin.</span>
              <a className="text-primary underline underline-offset-2" href="https://github.com/settings/tokens" target="_blank" rel="noreferrer">Set up GitHub auth</a>
            </div>
          ) : null}

          <Dialog open={createWorkOpen} onOpenChange={setCreateWorkOpen}>
            <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle>Start new work</DialogTitle>
                <DialogDescription>Describe the outcome, problem, or change. Stelow will guide it through its planning and delivery process.</DialogDescription>
              </DialogHeader>
              <NewThreadComposer
                defaultProjectId={activeProjectId ?? undefined}
                defaultProviderId={analysisWorkerPreset?.providerId}
                defaultModel={analysisWorkerPreset?.modelId}
                defaultReasoningLevel={analysisWorkerPreset?.reasoningLevel as NewThreadRequest["reasoningLevel"] | undefined}
                defaultPermissionMode={analysisWorkerPreset?.permissionMode as NewThreadRequest["permissionMode"] | undefined}
                initialPrompt={prompt}
                placeholder="What would you like Stelow to work on?"
                layout="contained"
                draftKey="stelow-board-create"
                onSubmit={(request) => void start(request)}
              />
              <details open={createOptionsOpen} onToggle={(event) => setCreateOptionsOpen((event.currentTarget as HTMLDetailsElement).open)} className="border-t pt-3">
                <summary className="flex min-h-11 cursor-pointer flex-col justify-center gap-0.5 rounded-md border bg-muted/30 px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:flex-row sm:items-center sm:justify-between">
                  <span>Work settings</span>
                  <span className="text-xs font-normal text-muted-foreground">Planning depth, review checkpoints, and agent configuration · Configure</span>
                </summary>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <WorkflowChoiceSelect label="Planning depth" value={appetite} options={APPETITE_OPTIONS} onChange={setAppetite} />
                  <WorkflowChoiceSelect label="Review checkpoints" value={reviewMode} options={REVIEW_MODE_OPTIONS} onChange={setReviewMode} />
                  <div className="sm:col-span-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Agent configuration</span>
                    <span>{workerPolicy.map(({ band, preset }) => `${band}: ${preset?.name ?? "Default"}`).join(" · ")}</span>
                    <Button size="sm" variant="outline" className="ml-auto shrink-0" onClick={() => setBoardPresetsOpen(true)}>Configure presets</Button>
                  </div>
                </div>
              </details>
            </DialogContent>
          </Dialog>

          <Dialog open={importOpen} onOpenChange={(open) => { setImportOpen(open); if (!open) setImportCandidates([]); }}>
            <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Import GitHub issues</DialogTitle>
                <DialogDescription>Issues tagged with the Stelow label land in Triage as work cards. Tag the issue with the label on GitHub, then import it here — nothing is auto-imported.</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3 py-2">
                <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <label className="shrink-0 text-xs font-medium text-muted-foreground" htmlFor="import-label">Label</label>
                    <Input id="import-label" value={importLabel} onChange={(event) => setImportLabel(event.target.value)} placeholder="stelow-work" aria-label="Stelow GitHub label" className="sm:w-52" />
                  </div>
                  <Button size="sm" variant="outline" onClick={() => void listGithubIssues()} disabled={importBusy}>Refresh</Button>
                </div>
                <p className="text-xs text-muted-foreground">Each issue is imported into the bb project that owns its repository — no picker needed. Tag issues with this label on GitHub; nothing is auto-imported.</p>
                {importBusy ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
                {!importBusy && importCandidates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No open issues carry the label “{importLabel}” yet. Tag an issue on GitHub with this label, then Refresh.</p>
                ) : null}
                {importCandidates.length > 0 ? (
                  <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border">
                    {importCandidates.map((issue) => {
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
                            <p className="text-xs text-muted-foreground">{issue.labels.join(" · ") || "no labels"}{issue.projectId ? ` → ${projects.find((project) => project.id === issue.projectId)?.name ?? issue.projectId}` : ""}{issue.alreadyImported ? " · already imported" : ""}</p>
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

          <div className="border-b pb-3">
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
          {loading ? <p className="text-sm text-muted-foreground">Loading Stelow…</p> : null}
          {cards.length === 0 && !loading ? (
            <section className="rounded-md border border-dashed bg-muted/30 p-6 text-center">
              <h2 className="text-sm font-semibold text-foreground">Product work, guided end to end</h2>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Stelow is an opinionated product workflow for humans and AI agents. Start with an outcome or problem; it guides the work through framing, critique, planning, execution, and review.</p>
              <div className="mt-4 flex flex-col items-center justify-center gap-2 sm:flex-row">
                <Button onClick={() => { setCreateOptionsOpen(false); setCreateWorkOpen(true); }}>Start new work</Button>
                <UrlLink href="https://github.com/calionauta/stelow" className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Learn about Stelow <span aria-hidden="true">↗</span></UrlLink>
              </div>
            </section>
          ) : null}

          {viewMode === "board" ? <p className="text-xs text-muted-foreground">
            <span className="sm:hidden">Swipe sideways to view every stage.</span>
            <span className="hidden sm:inline">Use Shift + scroll to move across stages.</span>
          </p> : null}
          {viewMode === "list" ? <WorkList groups={grouped} navigate={navigate} /> : <div className="grid gap-3 overflow-x-auto md:h-[clamp(20rem,calc(100dvh-17rem),48rem)] md:overflow-y-hidden" style={{ gridTemplateColumns: COLUMNS.map((column) => collapsedColumns[column] ? "minmax(56px, 0.5fr)" : "minmax(220px, 1.5fr)").join(" ") }}>
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

          <button onClick={() => setRestartFocusKey((k) => k + 1)} className="cursor-pointer sr-only" aria-hidden="true" tabIndex={-1}>refresh focus</button>
        </div>
      </div>
    </div>
  );
}

type ResearchStrategyOption = { id: string; label: string; skill: string; blurb: string };

// Second track beside Work: lightweight research (To-Do / Doing / Done)
// driven by one stelow-product-* strategy per card. No stages, no gates —
// the card produces a brief, and opportunities fan out into Work cards.
function ResearchPanel({ subPath }: { subPath: string }) {
  const { projectId: routeProjectId } = useBbContext();
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [cards, setCards] = useState<CardItem[]>([]);
  const [strategies, setStrategies] = useState<ResearchStrategyOption[]>([]);
  const [presets, setPresets] = useState<PresetManagerPreset[]>([]);
  const [researchProjectId, setResearchProjectId] = useState<string | null>(routeProjectId);
  const [collapsedColumns, setCollapsedColumns] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return { archived: true };
    try {
      const raw = window.localStorage.getItem("stelow-research-columns-collapsed-v1");
      if (!raw) return { archived: true };
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      return typeof parsed === "object" && parsed ? parsed : { archived: true };
    } catch { return { archived: true }; }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem("stelow-research-columns-collapsed-v1", JSON.stringify(collapsedColumns)); } catch { /* ignore */ }
  }, [collapsedColumns]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [strategy, setStrategy] = useState("opportunity-mapping");
  const [filterProjectId, setFilterProjectId] = useState<string | "all">("all");
  const [filterAttention, setFilterAttention] = useState(false);

  const load = useCallback(async (targetId: string | null) => {
    setLoading(true);
    try {
      const [projectsResult, cardsResult, strategiesResult, presetsResult] = await Promise.all([
        rpc.call("projects", {}).catch(() => null),
        rpc.call("listCards", { projectId: targetId, kind: "research" }).catch(() => ({ cards: [] })),
        rpc.call("researchStrategies", {}).catch(() => ({ strategies: [] })),
        rpc.call("listPresets", {}).catch(() => ({ presets: [] })),
      ]);
      setProjects(projectsResult?.projects ?? []);
      setCards(cardsResult.cards);
      setStrategies(strategiesResult.strategies);
      setPresets(presetsResult.presets);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load research.");
      setProjects([]);
      setCards([]);
    } finally {
      setLoading(false);
    }
  }, [rpc]);

  useEffect(() => { void load(researchProjectId ?? routeProjectId); }, [load, researchProjectId, routeProjectId]);
  useDebouncedRealtime(["card-state", "board-changed"], () => void load(researchProjectId ?? routeProjectId));

  const strategyLabelById = useMemo(() => new Map(strategies.map((entry) => [entry.id, entry.label])), [strategies]);
  const strategyOptions = useMemo(() => strategies.map((entry) => ({ value: entry.id, label: entry.label, description: entry.blurb })), [strategies]);
  useEffect(() => {
    if (strategies.length > 0 && !strategies.some((entry) => entry.id === strategy)) {
      setStrategy(strategies[0]!.id);
    }
  }, [strategies, strategy]);
  const activeProjectId = researchProjectId ?? routeProjectId;
  const defaultPreset = presets.find((preset) => preset.isDefault) ?? presets[0] ?? null;
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
    try {
      const result = await rpc.call("createResearchCard", { projectId: targetProjectId, environment: request.environment, prompt: text, attachments, strategy });
      setPrompt("");
      setCreateOpen(false);
      navigate.openThreadPanel({ actionId: "stelow-card-detail", title: result.cardId, params: { cardId: result.cardId } });
      toast.success("Research started. The brief appears on the card.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to start research.");
    }
  }

  async function moveCard(cardId: string, target: string) {
    if (!(RESEARCH_COLUMNS as readonly string[]).includes(target)) return;
    const result = await rpc.call("moveCard", { cardId, status: target as "todo" | "doing" | "done" | "archived" });
    if (!result.ok) toast.error(result.error ?? "Move failed");
  }

  const cardMatch = subPath.match(/^card\/(card_[A-Za-z0-9]+)(?:\/event\/(evt_[A-Za-z0-9]+))?\/?$/);
  if (cardMatch && cardMatch[1]) {
    const cardId = cardMatch[1];
    return (
      <div className="flex h-full flex-col overflow-hidden bg-background">
        <CardDetailHeader
          cardId={cardId}
          onBack={() => navigate.toPluginPanel("research", { subPath: "" })}
        />
        <div className="flex-1 overflow-auto">
          <CardDetailBody cardId={cardId} inboxEventId={cardMatch[2] ?? null} onClose={() => navigate.toPluginPanel("research", { subPath: "" })} navigate={navigate} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden bg-background">
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto max-w-[1500px] space-y-4">
          <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="max-w-2xl text-sm leading-5 text-muted-foreground">Investigate a question with product strategies, one round at a time. The card produces a brief; ranked opportunities fan out into Work cards.</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="text-xl font-semibold tracking-tight">Research</h1>
              </div>
              {inbox.length > 0 ? <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">{inbox.length} {inbox.length === 1 ? "item needs" : "items need"} your attention</p> : null}
            </div>
            <div className="grid w-full grid-cols-2 gap-2 sm:mt-0.5 sm:flex sm:w-auto sm:items-center sm:gap-3">
              <Button className="h-10 w-full sm:h-9 sm:w-auto sm:flex-none" onClick={() => setCreateOpen(true)}>New research</Button>
            </div>
          </header>

          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle>Start new research</DialogTitle>
                <DialogDescription>Describe the question or topic to investigate. One strategy per round — run more rounds from the card to compound perspectives.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4">
                <WorkflowChoiceSelect label="Strategy" value={strategy} options={strategyOptions.length > 0 ? strategyOptions : [{ value: strategy, label: strategy, description: "" }]} onChange={setStrategy} />
                <NewThreadComposer
                  defaultProjectId={activeProjectId ?? undefined}
                  defaultProviderId={defaultPreset?.providerId}
                  defaultModel={defaultPreset?.modelId}
                  defaultReasoningLevel={defaultPreset?.reasoningLevel as NewThreadRequest["reasoningLevel"] | undefined}
                  defaultPermissionMode={defaultPreset?.permissionMode as NewThreadRequest["permissionMode"] | undefined}
                  initialPrompt={prompt}
                  placeholder="What should Stelow investigate?"
                  layout="contained"
                  draftKey="stelow-research-create"
                  onSubmit={(request) => void start(request)}
                />
              </div>
            </DialogContent>
          </Dialog>

          <div className="flex flex-wrap items-center gap-2 border-b pb-3">
            <FilterSelect label="Project" value={filterProjectId} onChange={setFilterProjectId} options={[{ value: "all", label: "All projects" }, ...projects.map((project) => ({ value: project.id, label: project.name }))]} />
            <button onClick={() => setFilterAttention((value) => !value)} aria-pressed={filterAttention} className={`min-h-11 cursor-pointer rounded-md border px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${filterAttention ? "border-primary/40 bg-primary/5 text-foreground" : "border-border bg-background text-muted-foreground hover:bg-muted"}`}>Needs attention</button>
            <button onClick={() => { setFilterProjectId("all"); setFilterAttention(false); }} className="min-h-11 cursor-pointer rounded-md px-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline">Reset</button>
          </div>
          {loading ? <p className="text-sm text-muted-foreground">Loading research…</p> : null}
          {cards.length === 0 && !loading ? (
            <section className="rounded-md border border-dashed bg-muted/30 p-6 text-center">
              <h2 className="text-sm font-semibold text-foreground">Understand before you build</h2>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Ask a question or describe what to investigate — opportunity mapping, jobs to be done, market analysis. Ranked opportunities become Work cards.</p>
              <div className="mt-4 flex flex-col items-center justify-center gap-2 sm:flex-row">
                <Button onClick={() => setCreateOpen(true)}>Start new research</Button>
              </div>
            </section>
          ) : null}

          <p className="text-xs text-muted-foreground">
            <span className="sm:hidden">Swipe sideways to view every stage.</span>
            <span className="hidden sm:inline">Use Shift + scroll to move across stages.</span>
          </p>
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
        </div>
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

function FiltersBar({ projects, stageOptions, filterProjectId, filterStage, filterIntent, filterStatus, filterActivity, filterAttention, onProject, onStage, onIntent, onStatus, onActivity, onAttention, onReset }: {
  projects: Project[];
  stageOptions: string[];
  filterProjectId: string;
  filterStage: string;
  filterIntent: string;
  filterStatus: string;
  filterActivity: string;
  filterAttention: boolean;
  onProject: (v: string) => void;
  onStage: (v: string) => void;
  onIntent: (v: string) => void;
  onStatus: (v: string) => void;
  onActivity: (v: string) => void;
  onAttention: (v: boolean) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const projectOptions = useMemo(() => [{ value: "all", label: "All projects" }, ...projects.map((project) => ({ value: project.id, label: project.name }))], [projects]);
  const stageOptionsList = useMemo(() => [{ value: "all", label: "Any stage" }, ...stageOptions.map((stage) => ({ value: stage, label: stage }))], [stageOptions]);
  const activeCount = (filterProjectId !== "all" ? 1 : 0) + (filterStage !== "all" ? 1 : 0) + (filterIntent !== "all" ? 1 : 0) + (filterStatus !== "all" ? 1 : 0) + (filterActivity !== "all" ? 1 : 0) + (filterAttention ? 1 : 0);
  return (
    <div className="relative flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition ${activeCount > 0 ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}
      >
        <span aria-hidden>⚙</span>
        <span>Filters</span>
        {activeCount > 0 ? <span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">{activeCount}</span> : null}
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
            <FilterSelect label="Type" value={filterIntent} onChange={onIntent} options={FILTER_INTENT_OPTIONS} />
            <FilterSelect label="Status" value={filterStatus} onChange={onStatus} options={FILTER_STATUS_OPTIONS} />
            <FilterSelect label="Stage" value={filterStage} onChange={onStage} options={stageOptionsList} />
            <FilterSelect label="Activity" value={filterActivity} onChange={onActivity} options={FILTER_ACTIVITY_OPTIONS} />
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
  const selected = options.find((option) => option.value === value);
  const isAll = value === "all";
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className={`cursor-pointer rounded-md border px-2 py-1 text-sm ${isAll ? "border-border bg-background text-muted-foreground" : "border-primary bg-primary/10 text-foreground"}`}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {selected ? null : null}
    </label>
  );
}

function WorkList({ groups, navigate }: { groups: Record<string, CardItem[]>; navigate: ReturnType<typeof useBbNavigate> }) {
  return <div className="space-y-5">{COLUMNS.map((column) => {
    const cards = groups[column] ?? [];
    if (!cards.length) return null;
    return <section key={column} className="space-y-2"><div className="flex items-center gap-2"><h2 className="text-sm font-semibold">{COLUMN_LABELS[column] ?? column}</h2><span className="text-xs text-muted-foreground">{cards.length}</span></div><div className="overflow-hidden rounded-md border">{cards.map((card) => <button key={card.id} onClick={() => navigate.toPluginPanel("board", { subPath: `card/${card.id}` })} className="cursor-pointer flex min-h-11 w-full items-center gap-3 border-b p-3 text-left last:border-b-0 hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><span className={`size-2 shrink-0 rounded-full ${card.needsAttention ? "bg-amber-500" : card.activity === "running" ? "bg-primary" : "bg-muted-foreground/40"}`} /><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{card.displayName}</strong><span className="block truncate text-xs text-muted-foreground">{card.projectName} · {stageLabel(card.stage)}{card.scopeSummary.scopesTotal > 0 ? ` · ✓ ${card.scopeSummary.scopesDone}/${card.scopeSummary.scopesTotal} scopes · ${card.scopeSummary.tasksDone}/${card.scopeSummary.tasksTotal} tasks` : ""}</span></span><span className="shrink-0 text-xs text-muted-foreground">{new Date(card.updatedAt).toLocaleString()}</span></button>)}</div></section>;
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
        <div className="space-y-2 md:min-h-0 md:flex-1 md:overflow-y-auto md:overscroll-y-contain md:pr-1" role="list" aria-label={`${labels[column]} work items`}>
          {cards.map((card) => <div key={card.id}>{renderCard(card)}</div>)}
        </div>
      ) : null}
    </section>
  );
}

function BoardCard({ card }: { card: CardItem }) {
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const [retrying, setRetrying] = useState(false);
  const attention = card.needsAttention;
  const running = card.activity === "running";
  const stuck = Boolean(card.workerThreadId) && (card.activity === "error" || (card.activity === "idle" && attention));
  const borderClass = running
    ? "stelow-border-running"
    : attention
    ? "stelow-border-attention"
    : "border-border hover:border-primary/60";
  const open = useCallback(() => navigate.toPluginPanel("board", { subPath: `card/${card.id}` }), [navigate, card.id]);
  async function retry(event: React.MouseEvent | React.KeyboardEvent) {
    event.stopPropagation();
    if (retrying) return;
    setRetrying(true);
    try {
      const result = await rpc.call("retryWorker", { cardId: card.id });
      if (!result.ok) toast.error(result.error ?? "Retry failed. Open the card to restart fresh.");
      else toast.success("Worker retried.");
    } finally {
      setRetrying(false);
    }
  }
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
      aria-label={`Open work item ${card.displayName}.`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 truncate text-sm font-medium leading-tight text-foreground">{card.displayName}</div>
        <span className="inline-flex shrink-0 items-center gap-1.5">
          {stuck ? <button onClick={(event) => void retry(event)} disabled={retrying} title="Retry the worker in place" className="disabled:cursor-not-allowed cursor-pointer rounded-full border border-primary/40 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10 disabled:opacity-50">{retrying ? "…" : "↻ Retry"}</button> : null}
          <ActivityPill activity={card.activity} />
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="truncate whitespace-nowrap rounded-md bg-foreground/10 px-1.5 py-0.5 text-[10px] font-medium text-foreground/80" title="Workflow stage — where this work stands. Move it from the Progress timeline inside the card.">{stageLabel(card.stage)}</span>
        {card.scopeSummary.scopesTotal > 0 ? <span className="whitespace-nowrap text-muted-foreground" title={`${card.scopeSummary.scopesDone} of ${card.scopeSummary.scopesTotal} scopes done · ${card.scopeSummary.tasksDone} of ${card.scopeSummary.tasksTotal} tasks done`}>✓ {card.scopeSummary.scopesDone}/{card.scopeSummary.scopesTotal} scopes · {card.scopeSummary.tasksDone}/{card.scopeSummary.tasksTotal} tasks</span> : null}
        <Pill className="ml-auto whitespace-nowrap" title="Work intent — the kind of work this is. The agent sets it during triage; correct it here if it got it wrong.">{INTENT_LABEL[card.intent] ?? card.intent}</Pill>
      </div>
      {attention && card.activity !== "error" && card.activity !== "awaiting-answer" ? (
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
          <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
          <span>{attentionLabel(card)}</span>
        </div>
      ) : null}
      {card.activity === "error" && card.lastError ? <p className="mt-2 line-clamp-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-[11px] text-destructive" title={card.lastError}>{card.lastError}</p> : null}
      {card.activity === "idle" ? <div className="mt-1 text-[10px] text-muted-foreground">Idle since {new Date(card.updatedAt).toLocaleString()}</div> : null}
    </div>
  );
}

// Research-track card: strategy instead of stage/intent, opens in the
// Research panel. Retry, attention, and activity reuse the delivery pieces.
function ResearchCard({ card, strategyLabel }: { card: CardItem; strategyLabel: string | null }) {
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const [retrying, setRetrying] = useState(false);
  const attention = card.needsAttention;
  const running = card.activity === "running";
  const stuck = Boolean(card.workerThreadId) && (card.activity === "error" || (card.activity === "idle" && attention));
  const borderClass = running
    ? "stelow-border-running"
    : attention
    ? "stelow-border-attention"
    : "border-border hover:border-primary/60";
  const open = useCallback(() => navigate.toPluginPanel("research", { subPath: `card/${card.id}` }), [navigate, card.id]);
  async function retry(event: React.MouseEvent | React.KeyboardEvent) {
    event.stopPropagation();
    if (retrying) return;
    setRetrying(true);
    try {
      const result = await rpc.call("retryWorker", { cardId: card.id });
      if (!result.ok) toast.error(result.error ?? "Retry failed. Open the card to restart fresh.");
      else toast.success("Worker retried.");
    } finally {
      setRetrying(false);
    }
  }
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
      aria-label={`Open research ${card.displayName}.`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 truncate text-sm font-medium leading-tight text-foreground">{card.displayName}</div>
        <span className="inline-flex shrink-0 items-center gap-1.5">
          {stuck ? <button onClick={(event) => void retry(event)} disabled={retrying} title="Retry the worker in place" className="disabled:cursor-not-allowed cursor-pointer rounded-full border border-primary/40 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10 disabled:opacity-50">{retrying ? "…" : "↻ Retry"}</button> : null}
          <ActivityPill activity={card.activity} />
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <Pill tone={statusTone(card.status)}><span className="mr-1">{statusGlyph(card.status)}</span>{RESEARCH_COLUMN_LABELS[researchColumnOf(card)] ?? statusLabel(card.status)}</Pill>
        {strategyLabel ? <Pill className="ml-auto whitespace-nowrap" title="Research strategy — the playbook driving this investigation.">{strategyLabel}</Pill> : null}
      </div>
      {attention && card.activity !== "error" && card.activity !== "awaiting-answer" ? (
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
          <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
          <span>{attentionLabel(card)}</span>
        </div>
      ) : null}
      {card.activity === "error" && card.lastError ? <p className="mt-2 line-clamp-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-[11px] text-destructive" title={card.lastError}>{card.lastError}</p> : null}
      {card.activity === "idle" ? <div className="mt-1 text-[10px] text-muted-foreground">Idle since {new Date(card.updatedAt).toLocaleString()}</div> : null}
    </div>
  );
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
function fileLinkTarget(useWorkspace: boolean, environmentId: string | null, relPath: string | null, hostId: string, absolutePath: string): WorkspaceFileTarget | HostFileTarget {
  if (useWorkspace && environmentId && relPath) return { kind: "workspace", environmentId, path: relPath };
  return { kind: "host", hostId, path: absolutePath };
}

function StageTimeline({ currentStage, nextStages, artifacts, fileEnvironmentId, useWorkspaceLinks, onViewFile, onPick }: { currentStage: string; nextStages: string[]; artifacts: Array<{ stage: string; kind: string; path: string; display: string; generatedAt: string; absolutePath: string; hostId: string }>; fileEnvironmentId: string | null; useWorkspaceLinks: boolean; onViewFile: (file: { display: string; path: string; target: WorkspaceFileTarget | HostFileTarget | null }) => void; onPick: (stage: string) => void }) {
  const curIdx = STAGE_SEQUENCE.indexOf(currentStage);
  const current = curIdx >= 0 ? curIdx : 0;
  const legal = new Set(nextStages.filter((stage) => stage && !stage.includes("(")));
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
            <div className="flex flex-wrap gap-1">
              {stages.map((stage) => {
                const idx = STAGE_SEQUENCE.indexOf(stage);
                const passed = idx >= 0 && idx < current;
                const isCurrent = stage === currentStage;
                const canAdvance = idx === current + 1 && legal.has(stage);
                const canRegress = passed && !isCurrent;
                const clickable = canAdvance || canRegress;
                const produced = artifacts.filter((artifact) => artifact.stage === stage);
                return (
                  <div key={stage} className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      disabled={!clickable || isCurrent}
                      title={STAGE_PRODUCES[stage]}
                      onClick={() => onPick(stage)}
                      className={`disabled:cursor-not-allowed cursor-pointer relative inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      isCurrent
                        ? "bg-primary/15 text-primary ring-2 ring-primary/60"
                        : passed
                        ? "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
                        : canAdvance
                        ? "cursor-pointer border border-primary/40 text-primary hover:bg-primary/10"
                        : "cursor-pointer border border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                    }`}
                      >
                        {passed ? <span aria-hidden>✓</span> : isCurrent ? "●" : canAdvance ? "·" : "·"}
                        {stageLabel(stage)}
                        {produced.length > 0 ? <span aria-label={`${produced.length} artifacts`}>· {produced.length}</span> : null}
                        {canAdvance ? <span aria-hidden className="text-[9px]">→</span> : null}
                    </button>
                    {produced.map((artifact) => (
                      <button
                        key={artifact.path}
                        onClick={() => onViewFile({ display: artifact.display, path: artifact.absolutePath, target: fileLinkTarget(useWorkspaceLinks, fileEnvironmentId, artifact.path, artifact.hostId, artifact.absolutePath) })}
                        className="inline-flex max-w-36 cursor-pointer items-center truncate rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                        title={`Review ${artifact.display} — ${stageLabel(stage)} · ${artifact.kind}`}
                      >
                        {artifact.display}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CardDrawerAdapter(props: PluginThreadPanelProps) {
  const params = props.params;
  const cardId = typeof params === "object" && params && "cardId" in params && typeof params.cardId === "string" ? params.cardId : "";
  const navigate = useBbNavigate();
  if (!cardId) return <p className="p-4 text-sm text-muted-foreground">Pick a work item from Stelow Work to see its details here.</p>;
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
        {card ? <span className="ml-2 text-muted-foreground" title="Workflow stage — where this work stands. Move it from the Progress timeline inside the card.">· {statusLabel(card.status)}{card.status !== card.stage ? ` · ${stageLabel(card.stage)}` : ""}</span> : null}
      </nav>
      {card ? <>
        <ActivityPill activity={card.activity} />
        {card.kind !== "research" ? (
        <select
          aria-label="Intent"
          title="Work intent — the kind of work this is. The agent sets it during triage; correct it here if it got it wrong."
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
      description={card && pendingIntent ? `This work item is already at the ${stageLabel(card.stage)} stage. Changing the intent to ${INTENT_LABEL[pendingIntent] ?? pendingIntent} updates the label and notifies the worker, but appetite and the stage path chosen under the old intent are not recomputed.` : "Changing the intent updates the label and notifies the worker."}
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

function AwaitingAnswerBanner({ cardId, question, onAnswered }: { cardId: string; question: CardQuestion; onAnswered: () => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const [answers, setAnswers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (label: string) => setAnswers((current) => question.multiple ? current.includes(label) ? current.filter((item) => item !== label) : [...current, label] : [label]);
  async function submitAnswer() {
    if (answers.length === 0) return;
    setBusy(true); setError(null);
    const result = await rpc.call("answerQuestion", { cardId, answers });
    if (!result.ok) setError(result.error ?? "Could not send the answer.");
    else { setAnswers([]); onAnswered(); }
    setBusy(false);
  }
  return (
    <div role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300">?</span>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="text-sm font-medium text-amber-900 dark:text-amber-200">{question.title}</div>
          <p className="text-sm text-amber-900/80 dark:text-amber-200/80">{question.question}</p>
          <div className="grid gap-1">
            {question.options.map((option) => (
              <button
                key={option.label}
                onClick={() => toggle(option.label)}
                className={`cursor-pointer rounded-md border p-2 text-left text-sm ${answers.includes(option.label) ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background/40 text-foreground"}`}
              >
                <div className="font-medium">{option.label}</div>
                {option.description ? <div className="text-xs text-muted-foreground">{option.description}</div> : null}
              </button>
            ))}
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {question.multiple ? <p className="text-xs text-amber-900/60 dark:text-amber-200/60">Pick one or more, then submit.</p> : null}
          <div className="flex gap-2">
            <Button size="sm" disabled={answers.length === 0 || busy} onClick={() => void submitAnswer()}>{busy ? "Sending…" : "Submit answer"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExpiredQuestionBanner({ question, onAnswer, answering }: { question: ExpiredQuestion; onAnswer: (answer: string) => void; answering: boolean }) {
  return (
    <div role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300">?</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-amber-900 dark:text-amber-200">Waiting for your answer. The agent is paused.</div>
          <p className="mt-1 text-sm text-amber-900/80 dark:text-amber-200/80">{question.question}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {question.options.map((option) => <Button key={option.label} size="sm" variant="outline" disabled={answering} onClick={() => onAnswer(option.label)}>{option.label}</Button>)}
          </div>
          <p className="mt-2 text-xs text-amber-900/70 dark:text-amber-200/70">The ask timed out, but the agent is waiting. Answering here resumes the workflow.</p>
        </div>
      </div>
    </div>
  );
}

function ExpiredQuestionsSection({ cardId, questions }: { cardId: string; questions: ExpiredQuestion[] }) {
  const rpc = useRpc<typeof rpcContract>();
  const [answering, setAnswering] = useState<string | null>(null);
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const answer = async (question: ExpiredQuestion, option: string) => {
    setAnswering(question.id);
    try {
      const result = await rpc.call("answerExpiredQuestion", { cardId, questionId: question.id, answer: option });
      void result;
      setAnswered((prev) => new Set(prev).add(question.id));
    } finally {
      setAnswering(null);
    }
  };
  const remaining = questions.filter((question) => !answered.has(question.id));
  if (remaining.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">Timed-out questions waiting for your answer</h3>
      {remaining.map((question) => <ExpiredQuestionBanner key={question.id} question={question} onAnswer={(option) => answer(question, option)} answering={answering === question.id} />)}
    </section>
  );
}

type PresetManagerPreset = { id: string; name: string; providerId: string; modelId: string; reasoningLevel: string; permissionMode: string; environmentKind: string; builtIn: boolean; isDefault: boolean };
const EMPTY_PRESET_FORM = { id: null as string | null, name: "", providerId: "", modelId: "", reasoningLevel: "medium", permissionMode: "full" as "accept-edits" | "auto" | "full", environmentKind: "project-default" as "project-default" | "new-worktree" };

function PresetManagerDialog({ open, onOpenChange, rpc, presets, onChanged }: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  rpc: ReturnType<typeof useRpc<typeof rpcContract>>;
  presets: PresetManagerPreset[];
  onChanged: () => Promise<void>;
}) {
  const [form, setForm] = useState(EMPTY_PRESET_FORM);
  const [options, setOptions] = useState<{ providers: { id: string; displayName: string }[]; models: { providerId: string; model: string; displayName: string }[] }>({ providers: [], models: [] });
  const [bandPresets, setBandPresets] = useState<{ band: string; presetId: string | null; stages: string[] }[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setForm(EMPTY_PRESET_FORM);
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
  const startNew = () => { setForm(newPresetForm()); setMessage(null); };
  const startEdit = (preset: PresetManagerPreset) => { setForm({ id: preset.id, name: preset.name, providerId: preset.providerId, modelId: preset.modelId, reasoningLevel: preset.reasoningLevel, permissionMode: preset.permissionMode as "accept-edits" | "auto" | "full", environmentKind: preset.environmentKind as "project-default" | "new-worktree" }); setMessage(null); };

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
          <DialogDescription>Presets set the provider, model, reasoning level, and permission mode used when a work item starts its worker thread.</DialogDescription>
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
          <h4 className="mb-2 text-sm font-semibold">Worker preset per workflow phase</h4>
          <p className="mb-2 text-xs text-muted-foreground">Each phase uses its own preset. The worker is switched automatically when a work item reaches a phase with a different preset; work items with no phase preset use the work item's preset (or default).</p>
          <div className="grid gap-2">
            {bandPresets.map((band) => (
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
                  <option value="">Use work item default</option>
                  {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                </select>
                <span className="w-28 shrink-0 truncate text-right text-[11px] text-muted-foreground" title={band.stages.join(", ")}>{band.stages.join(", ")}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-3 rounded-md border bg-muted/30 p-3">
          {formCatalogReady ? <>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-semibold">{form.id ? `Edit ${form.name}` : "New preset"}</h4>
              {form.id ? <Button size="sm" variant="ghost" onClick={startNew}>New preset</Button> : null}
            </div>
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
          </> : <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-center">
            <span className="size-6 animate-spin rounded-full border-2 border-muted border-t-primary" aria-hidden />
            <div><p className="text-sm font-medium">Preparing your preset form</p><p className="mt-1 text-xs text-muted-foreground">Loading the configured providers and models…</p></div>
          </div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Read-only artifact viewer with discuss-to-agent: Markdown for prose,
// source renderer for code, plus a comment box that posts to the card
// (card comments route to the worker). The bb editor stays one click away
// for edits, but review never needs it.
function ArtifactViewerDialog({ open, onOpenChange, cardId, file, editorTarget, pendingQuestion, onQuestionAnswered, onCommented }: {
  open: boolean; onOpenChange: (next: boolean) => void; cardId: string;
  file: { display: string; path: string } | null;
  editorTarget: WorkspaceFileTarget | HostFileTarget | null;
  pendingQuestion: CardQuestion | null;
  onQuestionAnswered: () => void;
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
        {pendingQuestion ? (
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Decide without leaving — answering resumes the agent</span>
            <AwaitingAnswerBanner cardId={cardId} question={pendingQuestion} onAnswered={onQuestionAnswered} />
          </div>
        ) : null}
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
function CardDisclosure({ title, hint, action, children, defaultOpen = false }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group rounded-lg border bg-muted/20">
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
// decision > error > paused-with-work > working > calm.
type HeroKind = "decision" | "error" | "paused" | "working" | "calm";
function heroFor(card: CardItem, detail: CardDetailResponse | null): { kind: HeroKind; title: string; sub: string } {
  const pending = detail?.pendingQuestions?.length ?? 0;
  if (card.activity === "awaiting-answer" && pending > 0) {
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
      title: "Work paused",
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
        else { onOpenChange(false); onChanged(); toast.success("Preset overridden for this work item. Resume only continues the current worker — use Restart worker to switch to the new preset now."); }
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
    else { onOpenChange(false); onChanged(); toast.success("Preset overridden for this work item. Resume only continues the current worker — use Restart worker to switch to the new preset now."); }
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
          <DialogTitle>Agent preset for this work item</DialogTitle>
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

type ResearchBriefState = {
  found: boolean;
  briefPath: string | null;
  content: string | null;
  truncated: boolean;
  opportunities: Array<{ id: string; title: string; checked: boolean; group: string | null }>;
  error: string | null;
};

// Fan-out: turn checked opportunities into delivery Work cards. Mirrors the
// GitHub-import dialog (checkbox list + bulk confirm); the server re-parses
// the brief, spawns, and flips exactly the spawned boxes.
function FanOutDialog({ open, onOpenChange, cardId, opportunities, onFanned }: {
  open: boolean; onOpenChange: (next: boolean) => void; cardId: string;
  opportunities: ResearchBriefState["opportunities"];
  onFanned: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const fresh: Record<string, boolean> = {};
    for (const item of opportunities) if (!item.checked) fresh[item.id] = true;
    setSelected(fresh);
    setBusy(false);
  }, [open, opportunities]);
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
        toast.error(result.error ?? "Could not create work cards.");
        return;
      }
      toast.success(`Created ${result.created.length} ${result.created.length === 1 ? "work card" : "work cards"}.`);
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
          <DialogTitle>Create work cards</DialogTitle>
          <DialogDescription>Each selected opportunity becomes a delivery work card starting at triage. Spawned boxes check off in the brief so a retry never duplicates.</DialogDescription>
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
// the brief, so the card stays a deterministic sequence, never a parallel
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
    setPicked(strategies.find((entry) => !runIds.includes(entry.id))?.id ?? strategies[0]?.id ?? null);
  }, [open, strategies, runIds]);
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
      toast.success(`Started a ${active.label} round — appending to the brief.`);
      onOpenChange(false);
      onStarted();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Explore another strategy</DialogTitle>
          <DialogDescription>A fresh worker runs the strategy on the same request and appends a new section to the brief. Existing findings are never rewritten.</DialogDescription>
        </DialogHeader>
        {strategies.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading strategies…</p>
        ) : (
          <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border">
            {strategies.map((entry) => {
              const ran = runIds.includes(entry.id);
              return (
                <li key={entry.id}>
                  <label className="flex cursor-pointer items-start gap-2 p-2 hover:bg-muted/40">
                    <input
                      className="mt-1 h-4 w-4 shrink-0 cursor-pointer"
                      type="radio"
                      name="research-strategy-round"
                      checked={picked === entry.id}
                      onChange={() => setPicked(entry.id)}
                      disabled={busy}
                    />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {entry.label}
                        {ran ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">already ran — runs again</span> : null}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{entry.blurb}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
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

// Research-track card detail: hero + brief + fan-out + artifacts + manage +
// conversation. Delivery-only surfaces (stages, timeline, gates, intent)
// never render here; every leaf below is shared with the delivery body.
function ResearchDetailBody({ cardId, inboxEventId, onClose, navigate, card, detail, onChanged }: {
  cardId: string; inboxEventId: string | null; onClose: () => void; navigate: ReturnType<typeof useBbNavigate>;
  card: CardItem | null; detail: CardDetailResponse | null; onChanged: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [brief, setBrief] = useState<ResearchBriefState | null>(null);
  const [strategies, setStrategies] = useState<ResearchStrategyOption[]>([]);
  const [comment, setComment] = useState("");
  const [inboxEvent, setInboxEvent] = useState<{ kind: InboxNotification["kind"]; summary: string; occurredAt: number } | null>(null);
  const [repairOpen, setRepairOpen] = useState(false);
  const [restartWorkerOpen, setRestartWorkerOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [viewerFile, setViewerFile] = useState<{ display: string; path: string; target: WorkspaceFileTarget | HostFileTarget | null } | null>(null);
  const [fanOutOpen, setFanOutOpen] = useState(false);
  const [strategyRunOpen, setStrategyRunOpen] = useState(false);
  const inboxEventRef = useRef<HTMLElement | null>(null);

  const loadBrief = useCallback(async () => {
    try {
      const [briefResult, strategiesResult, eventResult] = await Promise.all([
        rpc.call("researchBrief", { cardId }),
        rpc.call("researchStrategies", {}).catch(() => ({ strategies: [] })),
        inboxEventId ? rpc.call("getNotification", { notificationId: inboxEventId, cardId }) : null,
      ]);
      setBrief(briefResult);
      setStrategies(strategiesResult.strategies);
      setInboxEvent(eventResult?.notification ?? null);
    } catch {
      setBrief({ found: false, briefPath: null, content: null, truncated: false, opportunities: [], error: "Unable to load the brief." });
    }
  }, [cardId, inboxEventId, rpc]);

  useEffect(() => { void loadBrief(); }, [loadBrief]);
  useDebouncedRealtime(["card-state"], () => { void loadBrief(); });
  useEffect(() => {
    if (!inboxEventId || !inboxEvent) return;
    inboxEventRef.current?.scrollIntoView({ block: "nearest" });
    inboxEventRef.current?.focus({ preventScroll: true });
  }, [inboxEventId, inboxEvent]);

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

  async function doRepair() {
    setRepairOpen(false);
    const result = await rpc.call("reseedCard", { cardId });
    if (!result.reseeded) {
      toast.error(result.error ?? "Restart failed");
      return;
    }
    toast.success("Fresh worker started on the same strategy.");
    onChanged();
    void loadBrief();
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
  const available = brief?.opportunities.filter((item) => !item.checked) ?? [];
  const briefGroups = useMemo(() => {
    const seen: string[] = [];
    for (const item of brief?.opportunities ?? []) {
      const group = item.group ?? "Opportunities";
      if (!seen.includes(group)) seen.push(group);
    }
    return seen;
  }, [brief]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto p-4">
        <div className="mx-auto w-full max-w-3xl space-y-6">
        {card ? (
          <>
            {inboxEventId && !((inboxEvent?.kind === "question" && hero?.kind === "decision") || (inboxEvent?.kind === "error" && hero?.kind === "error") || (inboxEvent?.kind === "paused" && hero?.kind === "paused")) ? <section ref={inboxEventRef} tabIndex={-1} className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label="Inbox notification"><p className="text-sm font-semibold">{inboxEvent ? `${INBOX_COPY[inboxEvent.kind].label}.` : "Opened from Stelow Inbox."}</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{inboxEvent?.summary ?? "This notification is no longer available."}</p>{inboxEvent ? <p className="mt-1 text-xs text-muted-foreground" title={new Date(inboxEvent.occurredAt).toLocaleString()}>{relativeTime(inboxEvent.occurredAt)}</p> : null}</section> : null}
            {hero && heroStyle ? (
              <section aria-label="Research status" {...(heroStyle.alert ? { role: "alert" } : {})} className={`rounded-lg border p-4 ${heroStyle.wrap}`}>
                <div className="flex items-start gap-2.5">
                  <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${heroStyle.dot}`} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <h2 className="text-[16px] font-semibold leading-snug tracking-tight text-foreground">{hero.title}</h2>
                    <p className="text-sm leading-relaxed text-muted-foreground">{hero.sub}</p>
                    <p className="pt-1 text-[15px] leading-relaxed text-foreground">{card.prompt}</p>
                    {brief && brief.found && available.length > 0 && card.status !== "completed" && card.status !== "archived" ? (
                      <p className="text-xs text-muted-foreground">Brief ready — review it below, fan out opportunities into work cards, then drag this card to Done.</p>
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
                          <Button size="sm" variant="outline" onClick={() => card.workerThreadId && navigate.toThread(card.workerThreadId)} title="Open the worker thread to inspect what happened.">Open thread ↗</Button>
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
                          {card.workerThreadId ? <Button size="sm" variant="outline" onClick={() => card.workerThreadId && navigate.toThread(card.workerThreadId)} title="Open the worker thread to inspect what happened.">Open thread ↗</Button> : null}
                        </>
                      ) : null}
                      {(hero.kind === "working" || hero.kind === "calm") && !(hero.kind === "calm" && card.activity === "idle" && card.workerThreadId && card.status !== "completed" && card.status !== "archived") ? (
                        card.workerThreadId ? <Button size="sm" variant="outline" onClick={() => card.workerThreadId && navigate.toThread(card.workerThreadId)} title="Open the worker thread.">Open thread ↗</Button> : null
                      ) : null}
                      {hero.kind === "calm" && card.activity === "idle" && card.workerThreadId && card.status !== "completed" && card.status !== "archived" ? (
                        <>
                          {presetStale ? <span className="w-full text-xs text-muted-foreground">Preset changed to {detail?.card.presetProviderId}/{detail?.card.presetModelId} — needs a fresh worker.</span> : null}
                          {presetStale ? (
                            <Button size="sm" disabled={restarting} onClick={() => setRestartWorkerOpen(true)} title="Start a fresh worker on the new preset, continuing the research.">{restarting ? "Restarting…" : "Restart worker…"}</Button>
                          ) : (
                            <Button size="sm" disabled={retrying} onClick={() => void doRetry()} title="Continue the same worker in place — nothing is reset.">{retrying ? "Retrying…" : "Resume"}</Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => card.workerThreadId && navigate.toThread(card.workerThreadId)} title="Open the worker thread.">Open thread ↗</Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
                {pendingFirst && card.activity === "awaiting-answer" ? (
                  <div className="mt-3 space-y-2 border-t border-amber-500/20 pt-3">
                    <AwaitingAnswerBanner cardId={card.id} question={pendingFirst} onAnswered={() => { onChanged(); void loadBrief(); }} />
                    {detail && detail.pendingQuestions.length > 1 ? (
                      <details className="rounded-md border bg-card p-2">
                        <summary className="min-h-11 cursor-pointer text-xs font-medium text-muted-foreground">More pending questions ({detail.pendingQuestions.length - 1})</summary>
                        <div className="mt-2 space-y-2">
                          {detail.pendingQuestions.slice(1).map((question) => <AwaitingAnswerBanner key={question.id} cardId={card.id} question={question} onAnswered={() => { onChanged(); void loadBrief(); }} />)}
                        </div>
                      </details>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}

            <CardDisclosure
              title="Research brief"
              hint={brief && brief.found ? `${available.length} available · ${brief.opportunities.length} total` : brief?.briefPath ?? "the worker is writing it"}
              defaultOpen
            >
              {!brief ? <p className="text-xs text-muted-foreground">Loading brief…</p> : null}
              {brief && !brief.found ? <p className="text-xs text-muted-foreground">{brief.error ?? "No brief yet — the research is still running."}</p> : null}
              {brief?.found && brief.content ? <div className="text-sm leading-relaxed"><Markdown content={brief.content} /></div> : null}
              {brief?.truncated ? <p className="text-xs text-muted-foreground">Brief truncated for display — the full file lives at {brief.briefPath}.</p> : null}
              {brief?.found && brief.opportunities.length > 0 ? (
                <div className="space-y-2 border-t pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Opportunities ({brief.opportunities.length})</h4>
                    <span className="flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => setStrategyRunOpen(true)} title="Run another strategy round on the same request — appends a new section to the brief.">Explore another strategy…</Button>
                      <Button size="sm" variant="outline" disabled={available.length === 0} onClick={() => setFanOutOpen(true)} title="Turn selected opportunities into delivery work cards.">Create work cards…</Button>
                    </span>
                  </div>
                  {briefGroups.map((group) => (
                    <div key={group} className="space-y-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{group}</p>
                      {(brief?.opportunities ?? []).filter((item) => (item.group ?? "Opportunities") === group).map((item) => (
                        <div key={item.id} className="flex items-start gap-2 text-sm">
                          <span className="mt-0.5" aria-hidden>{item.checked ? "☑" : "☐"}</span>
                          <span className={item.checked ? "text-muted-foreground line-through" : ""}>{item.title}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : null}
              {detail && detail.expiredQuestions.length > 0 ? <ExpiredQuestionsSection cardId={card.id} questions={detail.expiredQuestions} /> : null}
            </CardDisclosure>

            {detail && detail.artifacts.length > 0 ? (
              <CardDisclosure title="Artifacts" hint={`${detail.artifacts.length}`}>
                <div className="flex flex-wrap gap-1">
                  {detail.artifacts.map((file) => (
                    <button
                      key={file.path}
                      onClick={() => setViewerFile({ display: file.display, path: file.absolutePath, target: fileLinkTarget(card.workspaceKind === "exploratory", detail.fileEnvironmentId, file.path, file.hostId, file.absolutePath) })}
                      className="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-xs text-foreground hover:bg-muted"
                      title={`Review ${file.display}`}
                    >
                      <span>📄</span>
                      <span>{file.display}</span>
                    </button>
                  ))}
                </div>
              </CardDisclosure>
            ) : null}

            <CardDisclosure
              title="Manage"
              hint={`${detail?.card.presetName ?? "default"}${detail?.card.presetOverridden ? " · overridden" : ""}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone="bg-muted text-muted-foreground">
                  Research · {detail?.card.presetName ?? "default"}
                  {detail?.card.presetProviderId && detail?.card.presetModelId ? (
                    <span className="ml-1.5 font-mono text-[10px] text-muted-foreground/80">{detail.card.presetProviderId}/{detail.card.presetModelId}</span>
                  ) : null}
                </Pill>
                <button onClick={() => setPresetDialogOpen(true)} className="cursor-pointer min-h-11 rounded-md px-2 text-xs font-medium text-primary hover:underline">Change preset…</button>
              </div>
              <p className="text-xs text-muted-foreground">A change takes effect only when a new worker starts — Resume continues the current one.</p>
              {presetStale ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2">
                  <p className="min-w-40 flex-1 text-xs text-muted-foreground">The running worker predates this preset — Resume will not switch provider/model.</p>
                  <Button size="sm" disabled={restarting} onClick={() => setRestartWorkerOpen(true)}>{restarting ? "Restarting…" : "Restart worker…"}</Button>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-4 border-t pt-3">
                <button onClick={() => setRepairOpen(true)} title="Start over with a new worker on the same strategy. Comments are kept." className="cursor-pointer min-h-11 text-xs text-muted-foreground hover:text-foreground hover:underline">Restart fresh…</button>
                <button onClick={() => setArchiveOpen(true)} className="cursor-pointer min-h-11 text-xs text-muted-foreground hover:text-destructive hover:underline">Archive research</button>
              </div>
              {detail && detail.workerHistory.length > 0 ? (
                <details className="border-t pt-2">
                  <summary className="min-h-11 cursor-pointer text-xs font-medium text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Worker history ({detail.workerHistory.length}) — archived threads stay readable</summary>
                  <div className="mt-1 divide-y divide-border rounded-md border">
                    {detail.workerHistory.map((entry) => (
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
              ) : null}
            </CardDisclosure>

            <CardDisclosure
              title="Conversation"
              hint={detail?.comments.length ? `${detail.comments.length}` : "talk to the agent"}
              defaultOpen={hero?.kind === "decision"}
            >
              <div className="divide-y divide-border">
                {detail?.comments.length ? detail.comments.map((entry) => (
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
                <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} className="min-h-24 w-full rounded-md border bg-background p-2 text-sm leading-relaxed focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" placeholder="Ask, correct, or add context... (Cmd/Ctrl+Enter to send)" onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && comment.trim()) void submitComment(); }} />
              </label>
              <div className="flex justify-end"><Button disabled={!comment.trim()} onClick={() => void submitComment()}>Send to agent</Button></div>
            </CardDisclosure>

          </>
        ) : null}
        </div>
      </div>
      <ConfirmActionDialog
        open={repairOpen}
        onOpenChange={setRepairOpen}
        title="Restart with a fresh worker?"
        description={`A new worker restarts ${primaryStrategyLabel ? `the ${primaryStrategyLabel} strategy` : "the original strategy"} from scratch with a clean brief — later rounds are discarded. Existing comments are kept. Try Retry first — restart only if the worker itself is broken.`}
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
        onChanged={() => { onChanged(); void loadBrief(); }}
      />
      <ArtifactViewerDialog
        open={viewerFile !== null}
        onOpenChange={(next) => { if (!next) setViewerFile(null); }}
        cardId={cardId}
        file={viewerFile}
        editorTarget={viewerFile?.target ?? null}
        pendingQuestion={pendingFirst}
        onQuestionAnswered={() => { setViewerFile(null); onChanged(); void loadBrief(); }}
        onCommented={() => onChanged()}
      />
      <FanOutDialog
        open={fanOutOpen}
        onOpenChange={setFanOutOpen}
        cardId={cardId}
        opportunities={brief?.opportunities ?? []}
        onFanned={() => { onChanged(); void loadBrief(); }}
      />
      <StrategyRunDialog
        open={strategyRunOpen}
        onOpenChange={setStrategyRunOpen}
        cardId={cardId}
        strategies={strategies}
        runIds={card?.researchStrategies ?? []}
        onStarted={() => { onChanged(); void loadBrief(); }}
      />
      <ConfirmActionDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Archive this research?"
        description="The research is moved to the Archived column and the worker thread is stopped. Comments and history are preserved."
        confirmLabel="Archive"
        confirmTone="destructive"
        onConfirm={doArchive}
      />
    </div>
  );
}

function CardDetailBody({ cardId, inboxEventId, onClose, navigate }: { cardId: string; inboxEventId: string | null; onClose: () => void; navigate: ReturnType<typeof useBbNavigate> }) {
  const rpc = useRpc<typeof rpcContract>();
  const [card, setCard] = useState<CardItem | null>(null);
  const [detail, setDetail] = useState<CardDetailResponse | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState<string | null>(null);
  const [pendingAdvance, setPendingAdvance] = useState<string | null>(null);
  const [repairOpen, setRepairOpen] = useState(false);
  const [restartWorkerOpen, setRestartWorkerOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoteName, setPromoteName] = useState("");
  const [promoting, setPromoting] = useState(false);
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [viewerFile, setViewerFile] = useState<{ display: string; path: string; target: WorkspaceFileTarget | HostFileTarget | null } | null>(null);
  const [inboxEvent, setInboxEvent] = useState<{ kind: InboxNotification["kind"]; summary: string; occurredAt: number } | null>(null);
  const inboxEventRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    try {
      const detailResult = await rpc.call("cardDetail", { cardId });
      const listResult = await rpc.call("listCards", { projectId: detailResult.card.projectId });
      const eventResult = inboxEventId ? await rpc.call("getNotification", { notificationId: inboxEventId, cardId }) : null;
      setDetail(detailResult);
      setCard(listResult.cards.find((entry) => entry.id === cardId) ?? null);
      setInboxEvent(eventResult?.notification ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load card.");
    }
  }, [cardId, inboxEventId, rpc]);

  useEffect(() => { void load(); }, [load]);
  useDebouncedRealtime(["card-state"], () => { void load(); });
  useEffect(() => {
    if (!inboxEventId || !inboxEvent) return;
    inboxEventRef.current?.scrollIntoView({ block: "nearest" });
    inboxEventRef.current?.focus({ preventScroll: true });
  }, [inboxEventId, inboxEvent]);

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
      toast.success("Work item archived.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Archive failed.");
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

  // Hero + disclosures read the primary action off the card's own activity
  // (no separate kind): decision > error > paused-with-work > working > calm.
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
          <ResearchDetailBody cardId={cardId} inboxEventId={inboxEventId} onClose={onClose} navigate={navigate} card={card} detail={detail} onChanged={() => void load()} />
        ) : null}
        {card && card.kind !== "research" ? (
          <>
            {inboxEventId && !((inboxEvent?.kind === "question" && hero?.kind === "decision") || (inboxEvent?.kind === "error" && hero?.kind === "error") || (inboxEvent?.kind === "paused" && hero?.kind === "paused")) ? <section ref={inboxEventRef} tabIndex={-1} className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label="Inbox notification"><p className="text-sm font-semibold">{inboxEvent ? `${INBOX_COPY[inboxEvent.kind].label}.` : "Opened from Stelow Inbox."}</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{inboxEvent?.summary ?? "This notification is no longer available."}</p>{inboxEvent ? <p className="mt-1 text-xs text-muted-foreground" title={new Date(inboxEvent.occurredAt).toLocaleString()}>{relativeTime(inboxEvent.occurredAt)}</p> : null}</section> : null}
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
                          <Button size="sm" variant="outline" onClick={() => card.workerThreadId && navigate.toThread(card.workerThreadId)} title="Open the worker thread to inspect what happened.">Open thread ↗</Button>
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
                          {card.workerThreadId ? <Button size="sm" variant="outline" onClick={() => card.workerThreadId && navigate.toThread(card.workerThreadId)} title="Open the worker thread to inspect what happened.">Open thread ↗</Button> : null}
                        </>
                      ) : null}
                      {(hero.kind === "working" || hero.kind === "calm") && !(hero.kind === "calm" && card.activity === "idle" && card.workerThreadId && card.status !== "completed" && card.status !== "archived") ? (
                        card.workerThreadId ? <Button size="sm" variant="outline" onClick={() => card.workerThreadId && navigate.toThread(card.workerThreadId)} title="Open the worker thread.">Open thread ↗</Button> : null
                      ) : null}
                      {hero.kind === "calm" && card.activity === "idle" && card.workerThreadId && card.status !== "completed" && card.status !== "archived" ? (
                        <>
                          {presetStale ? <span className="w-full text-xs text-muted-foreground">Preset changed to {detail?.card.presetProviderId}/{detail?.card.presetModelId} — needs a fresh worker.</span> : null}
                          {presetStale ? (
                            <Button size="sm" disabled={restarting} onClick={() => setRestartWorkerOpen(true)} title="Start a fresh worker on the new preset, continuing from the current stage.">{restarting ? "Restarting…" : "Restart worker…"}</Button>
                          ) : (
                            <Button size="sm" disabled={retrying} onClick={() => void doRetry()} title="Continue the same worker in place from the current stage — nothing is reset.">{retrying ? "Retrying…" : "Resume"}</Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => card.workerThreadId && navigate.toThread(card.workerThreadId)} title="Open the worker thread.">Open thread ↗</Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
                {pendingFirst && card.activity === "awaiting-answer" ? (
                  <div className="mt-3 space-y-2 border-t border-amber-500/20 pt-3">
                    <AwaitingAnswerBanner cardId={card.id} question={pendingFirst} onAnswered={() => void load()} />
                    {detail && detail.pendingQuestions.length > 1 ? (
                      <details className="rounded-md border bg-card p-2">
                        <summary className="min-h-11 cursor-pointer text-xs font-medium text-muted-foreground">More pending questions ({detail.pendingQuestions.length - 1})</summary>
                        <div className="mt-2 space-y-2">
                          {detail.pendingQuestions.slice(1).map((question) => <AwaitingAnswerBanner key={question.id} cardId={card.id} question={question} onAnswered={() => void load()} />)}
                        </div>
                      </details>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}

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
              {detail && detail.scopes.length > 0 ? <ScopesList scopes={detail.scopes} /> : <p className="text-xs text-muted-foreground">No scopes broken down yet — the agent is still shaping the work.</p>}
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
                    fileEnvironmentId={detail.fileEnvironmentId}
                    useWorkspaceLinks={card.workspaceKind === "exploratory"}
                    onViewFile={(file) => setViewerFile(file)}
                    onPick={(stage) => setPendingAdvance(stage)}
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
              {detail && detail.expiredQuestions.length > 0 ? <ExpiredQuestionsSection cardId={card.id} questions={detail.expiredQuestions} /> : null}
            </CardDisclosure>

            {/* DISCLOSURE 2 — Manage (preset + danger zone, always collapsed) */}
            <CardDisclosure
              title="Manage"
              hint={`${detail?.card.presetName ?? "default"}${detail?.card.presetOverridden ? " · overridden" : ""}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                {card.stage ? (
                  <Pill tone="bg-muted text-muted-foreground">
                    {BAND_LABEL[STAGE_BAND[card.stage] ?? "analysis"]} · {detail?.card.presetName ?? "default"}
                    {detail?.card.presetProviderId && detail?.card.presetModelId ? (
                      <span className="ml-1.5 font-mono text-[10px] text-muted-foreground/80">{detail.card.presetProviderId}/{detail.card.presetModelId}</span>
                    ) : null}
                  </Pill>
                ) : null}
                <button onClick={() => setPresetDialogOpen(true)} className="cursor-pointer min-h-11 rounded-md px-2 text-xs font-medium text-primary hover:underline">Change preset…</button>
              </div>
              <p className="text-xs text-muted-foreground">Preset for the <strong>{stageLabel(card.stage)}</strong> phase{detail?.card.presetOverridden ? " — overridden for this card" : " — board default"}. A change takes effect only when a new worker starts — Resume continues the current one.</p>
              {presetStale ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2">
                  <p className="min-w-40 flex-1 text-xs text-muted-foreground">The running worker predates this preset — Resume will not switch provider/model.</p>
                  <Button size="sm" disabled={restarting} onClick={() => setRestartWorkerOpen(true)}>{restarting ? "Restarting…" : "Restart worker…"}</Button>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-4 border-t pt-3">
                <button onClick={() => setRepairOpen(true)} title="Start over with a new worker from triage. Scope work and comments are kept." className="cursor-pointer min-h-11 text-xs text-muted-foreground hover:text-foreground hover:underline">Restart fresh…</button>
                <button onClick={() => setArchiveOpen(true)} className="cursor-pointer min-h-11 text-xs text-muted-foreground hover:text-destructive hover:underline">Archive work item</button>
              </div>
              {detail && detail.workerHistory.length > 0 ? (
                <details className="border-t pt-2">
                  <summary className="min-h-11 cursor-pointer text-xs font-medium text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Worker history ({detail.workerHistory.length}) — archived threads stay readable</summary>
                  <div className="mt-1 divide-y divide-border rounded-md border">
                    {detail.workerHistory.map((entry) => (
                      <div key={entry.threadId} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                        <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${entry.endedAt === null ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          <span className="font-medium text-foreground">{entry.endedAt === null ? "Current worker" : ({ "band-swap": "Phase preset", restart: "Manual restart", reseed: "Restarted fresh", initial: "First worker" } as Record<string, string>)[entry.endedReason ?? ""] ?? "Replaced worker"}</span>
                          {entry.presetName ? <span> · {entry.presetName}</span> : null}
                          <span title={new Date(entry.startedAt).toLocaleString()}> · {relativeTime(entry.startedAt)}</span>
                        </span>
                        <button onClick={() => navigate.toThread(entry.threadId)} title="Open this worker thread (archived threads stay readable)." className="cursor-pointer min-h-11 shrink-0 rounded-md px-2 font-medium text-primary hover:underline">Open ↗</button>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </CardDisclosure>
            {/* DISCLOSURE 3 — Conversation (history + composer) */}
            <CardDisclosure
              title="Conversation"
              hint={detail?.comments.length ? `${detail.comments.length}` : "talk to the agent"}
              defaultOpen={hero?.kind === "decision"}
            >
              <div className="divide-y divide-border">
                {detail?.comments.length ? detail.comments.map((entry) => (
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
                <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} className="min-h-24 w-full rounded-md border bg-background p-2 text-sm leading-relaxed focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" placeholder="Ask, correct, or add context... (Cmd/Ctrl+Enter to send)" onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && comment.trim()) void submitComment(); }} />
              </label>
              <div className="flex justify-end"><Button disabled={!comment.trim()} onClick={() => void submitComment()}>Send to agent</Button></div>
            </CardDisclosure>

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
        pendingQuestion={pendingFirst}
        onQuestionAnswered={() => { setViewerFile(null); void load(); }}
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
                Move this work item from <strong>{stageLabel(card?.stage ?? "")}</strong> to <strong>{pendingAdvance ? stageLabel(pendingAdvance) : ""}</strong>.
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
        title="Archive this work item?"
        description="The work item is moved to the Archived column and the worker thread is stopped. Comments and history are preserved."
        confirmLabel="Archive"
        confirmTone="destructive"
        onConfirm={doArchive}
      />
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
  const payload = interaction.payload as { question?: string; multiple?: boolean; options?: { label: string; description: string }[] };
  const options = Array.isArray(payload.options) ? payload.options : [];
  const [answers, setAnswers] = useState<string[]>([]);
  const toggle = (label: string) => setAnswers((current) => payload.multiple ? current.includes(label) ? current.filter((item) => item !== label) : [...current, label] : [label]);
  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <p className="font-medium">{payload.question ?? interaction.title}</p>
      <div className="space-y-2">
        {options.map((option) => <button key={option.label} onClick={() => toggle(option.label)} className={`cursor-pointer w-full rounded-md border p-3 text-left ${answers.includes(option.label) ? "border-primary bg-primary/10" : "border-border"}`}><div className="font-medium">{option.label}</div><div className="text-sm text-muted-foreground">{option.description}</div></button>)}
      </div>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => void cancel()}>Cancel</Button><Button disabled={answers.length === 0} onClick={() => void submit({ answers })}>Continue</Button></div>
    </div>
  );
}

function OpenStelowBoardAction({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [cardId, setCardId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setCardId(null);
    void rpc.call("cardByWorkerThread", { threadId }).then((result) => {
      if (!cancelled) setCardId(result.cardId);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [rpc, threadId]);
  // Not a card worker thread: render nothing instead of a generic shortcut.
  if (!cardId) return null;
  return <button onClick={() => navigate.toPluginPanel("board", { subPath: `card/${cardId}` })} title="Open this work item" className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md border bg-card px-3 py-2 text-xs font-medium shadow-sm hover:border-primary/50">Stelow work item ↗</button>;
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
  app.slots.navPanel({
    id: "inbox",
    title: "Stelow Inbox",
    icon: "Inbox",
    path: "inbox",
    component: InboxPanel,
    experimental_sidebarAccessory: StelowInboxSidebarAccessory,
  });
  app.slots.navPanel({
    id: "board",
    title: "Stelow Work",
    icon: "Columns2",
    path: "board",
    component: (props) => { PillsyStyles(); return <BoardPanel subPath={props.subPath} />; },
    experimental_sidebarAccessory: StelowWorkSidebarAccessory,
  });
  app.slots.navPanel({
    id: "research",
    title: "Stelow Research",
    icon: "ListTodo",
    path: "research",
    component: (props) => { PillsyStyles(); return <ResearchPanel subPath={props.subPath} />; },
    experimental_sidebarAccessory: StelowResearchSidebarAccessory,
  });
  app.slots.pendingInteraction({ id: "stelow-question", component: QuestionForm });
  app.slots.threadPanelAction({ id: "stelow-card-detail", title: "Stelow work item", icon: "Columns2", component: CardDrawerAdapter });
  app.slots.experimental_threadHeaderAction({ id: "open-stelow-board", title: "Open Stelow Work", component: OpenStelowBoardAction });

  app.slots.messageDirective({
    id: "stelow-artifact",
    component: StelowArtifactDirective,
  });
});

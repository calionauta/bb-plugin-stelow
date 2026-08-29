import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Markdown,
  definePluginApp,
  experimental_NewThreadComposer as NewThreadComposer,
  useBbContext,
  useBbNavigate,
  useComposer,
  useRealtime,
  useRpc,
  type NewThreadRequest,
  type PluginFileOpenerProps,
  type PluginMessageDirectiveProps,
  type PluginPendingInteractionProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

function Pill({ children, tone = "bg-muted text-muted-foreground", className = "" }: { children: React.ReactNode; tone?: string; className?: string }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${tone} ${className}`}>{children}</span>;
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
  error: "Worker failed — needs attention",
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
  if (card.status === "completed") return "Ready to review";
  return "Paused — resume it";
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

interface RunningAccessoryHandle {
  count: number;
  tone: string;
}

// 'Live' = in any workflow phase (not a terminal). Archived/completed excluded.
const isLiveCard = (card: { status: string }) => card.status !== "archived" && card.status !== "completed";

function useRunningAccessory(): RunningAccessoryHandle {
  const rpc = useRpc<typeof rpcContract>();
  const [count, setCount] = useState(0);
  const reload = useCallback(async () => {
    try {
      const result = await rpc.call("listCards", { projectId: null });
      setCount(result.cards.filter(isLiveCard).length);
    } catch {
      /* host will show stale silently */
    }
  }, [rpc]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useDebouncedRealtime(["card-state", "board-changed"], () => void reload());
  const tone = count > 0 ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground";
  return { count, tone };
}

function StelowSidebarAccessory() {
  const { count, tone } = useRunningAccessory();
  return (
    <span
      aria-label={`${count} Stelow cards in progress`}
      className={`rounded-full px-1.5 py-0.5 text-2xs font-medium tabular-nums ${tone}`}
    >
      {count}
    </span>
  );
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
  const [boardPresets, setBoardPresets] = useState<PresetManagerPreset[]>([]);
  const [boardBandPresets, setBoardBandPresets] = useState<{ band: string; presetId: string | null; stages: string[] }[]>([]);
  const [boardPresetsOpen, setBoardPresetsOpen] = useState(false);
  const [restartFocusKey, setRestartFocusKey] = useState(0);

  const load = useCallback(async (targetId: string | null) => {
    setLoading(true);
    try {
      const [projectsResult, cardsResult, presetsResult, bandPresetsResult] = await Promise.all([
        rpc.call("projects", {}).catch(() => null),
        rpc.call("listCards", { projectId: targetId }).catch(() => ({ cards: [] })),
        rpc.call("listPresets", {}).catch(() => ({ presets: [] })),
        rpc.call("listBandPresets", {}).catch(() => ({ bands: [] })),
      ]);
      setProjects(projectsResult?.projects ?? []);
      setCards(cardsResult.cards);
      setBoardPresets(presetsResult.presets);
      setBoardBandPresets(bandPresetsResult.bands);
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
  const reason = !activeProjectId ? "Select a normal bb project (not the singleton Personal project) in the sidebar." : !prompt.trim() ? "Describe a product request to start the workflow." : null;
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
    // Compose the prompt from the composer's text + attached files, so the
    // agent sees the same content the user does (including inline file links).
    const textPart = request.input.find((part) => part.type === "text");
    const text = textPart && "text" in textPart ? (textPart as { text: string }).text.trim() : "";
    const fileParts = request.input.filter((part) => part.type === "localFile" || part.type === "image" || part.type === "localImage");
    const attached = fileParts
      .map((part) => {
        if (part.type === "image" || part.type === "localImage") return `[image: ${(part as { url?: string; path?: string }).url ?? (part as { path?: string }).path ?? ""}]`;
        return (part as { path?: string; name?: string }).path ?? (part as { name?: string }).name ?? "";
      })
      .filter(Boolean) as string[];
    const prompt = [text, ...(attached.length > 0 ? [`\n\nAttached files:\n${attached.map((path) => `- ${path}`).join("\n")}`] : [])].join("\n");
    if (!prompt.trim()) return;
    try {
      const result = await rpc.call("createCard", { projectId: targetProjectId, prompt, intent, appetite, reviewMode });
      setPrompt("");
      navigate.openThreadPanel({ actionId: "stelow-card-detail", title: result.cardId, params: { cardId: result.cardId } });
      toast.success("Card created in Triage. The agent will triage it.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to create the card.");
    }
  }

  async function moveCard(cardId: string, target: string) {
    if (!(COLUMNS as readonly string[]).includes(target)) return;
    const result = await rpc.call("moveCard", { cardId, status: target as "analysis" | "planning" | "execution" | "review" | "completed" | "archived" });
    if (!result.ok) toast.error(result.error ?? "Move failed");
  }

  const cardMatch = subPath.match(/^card\/(card_[A-Za-z0-9]+)\/?$/);
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
          <CardDetailBody cardId={cardId} onClose={() => navigate.toPluginPanel("board", { subPath: "" })} navigate={navigate} />
        </div>
      </div>
    );
  }

  const reviewMatch = subPath.match(/^review-document\/(.+)$/);
  if (reviewMatch && reviewMatch[1]) {
    const path = decodeURIComponent(reviewMatch[1]);
    return (
      <div className="flex h-full flex-col overflow-hidden bg-background">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <button onClick={() => navigate.toPluginPanel("board", { subPath: "" })} className="text-xs text-muted-foreground hover:text-foreground">← Stelow board</button>
          <span className="truncate pl-2 text-xs font-medium text-muted-foreground" title={path}>{path.split("/").pop()}</span>
        </div>
        <div className="flex-1 overflow-auto">
          <DocumentReviewImpl path={path} source={{ kind: "workspace", threadId: null, environmentId: null, projectId: boardProjectId ?? routeProjectId ?? null }} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden bg-background">
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto max-w-[1500px] space-y-5">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">Stelow board</h1>
              <span className="text-xs text-muted-foreground">· {cards.filter(isLiveCard).length} cards · {inbox.length} need attention</span>
              <div className="flex-1" />
            </div>
            <PresetManagerDialog
              open={boardPresetsOpen}
              onOpenChange={setBoardPresetsOpen}
              rpc={rpc}
              presets={boardPresets}
              onChanged={() => load(boardProjectId ?? routeProjectId)}
            />
            <p className="text-sm text-muted-foreground">Describe a request below to start a workflow. The agent runs in the background and posts updates here.</p>
          </div>

          <div className="rounded-xl border bg-card/60 p-3">
            <div className="mb-3 grid gap-3 border-b pb-3 sm:grid-cols-2">
              <WorkflowChoiceSelect label="Appetite" value={appetite} options={APPETITE_OPTIONS} onChange={setAppetite} />
              <WorkflowChoiceSelect label="Review mode" value={reviewMode} options={REVIEW_MODE_OPTIONS} onChange={setReviewMode} />
              <div className="sm:col-span-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Worker policy</span>
                <span>{workerPolicy.map(({ band, preset }) => `${band}: ${preset?.name ?? "Default"}`).join(" · ")}</span>
                <Button size="sm" variant="ghost" className="ml-auto h-7 px-2 text-xs" onClick={() => setBoardPresetsOpen(true)}>Configure presets</Button>
              </div>
              <p className="sm:col-span-2 text-xs text-muted-foreground">These choices are saved with the new workflow. Its worker follows this shared phase policy, starting with the Analysis preset.</p>
            </div>
            <NewThreadComposer
              defaultProjectId={activeProjectId ?? undefined}
              defaultProviderId={analysisWorkerPreset?.providerId}
              defaultModel={analysisWorkerPreset?.modelId}
              defaultReasoningLevel={analysisWorkerPreset?.reasoningLevel as NewThreadRequest["reasoningLevel"] | undefined}
              defaultPermissionMode={analysisWorkerPreset?.permissionMode as NewThreadRequest["permissionMode"] | undefined}
              initialPrompt={prompt}
              layout="contained"
              draftKey="stelow-board-create"
              onSubmit={(request) => void start(request)}
            />
          </div>
          {reason ? <p className="-mt-2 px-1 text-xs text-muted-foreground">{reason}</p> : null}

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

          {loading ? <p className="text-sm text-muted-foreground">Loading Stelow…</p> : null}
          {cards.length === 0 && !loading ? <p className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">No cards yet. Describe a request above to start one.</p> : null}

          <div className="grid gap-3 overflow-x-auto" style={{ gridTemplateColumns: COLUMNS.map((column) => collapsedColumns[column] ? "minmax(56px, 0.5fr)" : "minmax(220px, 1.5fr)").join(" ") }}>
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
          </div>

          <button onClick={() => setRestartFocusKey((k) => k + 1)} className="sr-only" aria-hidden="true" tabIndex={-1}>refresh focus</button>
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
      <select value={value} onChange={(event) => onChange(event.target.value as T)} className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" aria-label={label}>
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
    <div className="relative flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition ${activeCount > 0 ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}
      >
        <span aria-hidden>⚙</span>
        <span>Filters</span>
        {activeCount > 0 ? <span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">{activeCount}</span> : null}
      </button>
      {filterAttention ? <button onClick={() => onAttention(!filterAttention)} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-amber-500 bg-amber-500/15 px-3 text-xs font-medium text-amber-700 dark:text-amber-300" aria-label="Remove attention filter" aria-pressed="true">
        <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
        Needs attention
        <span aria-hidden className="ml-1">×</span>
      </button> : null}
      {activeCount > 0 ? <button onClick={onReset} className="inline-flex h-7 items-center rounded-full border bg-background px-3 text-xs text-muted-foreground hover:text-foreground">Clear</button> : null}
      {open ? (
        <div role="dialog" aria-label="Filters" className="absolute left-3 top-10 z-20 w-[min(36rem,calc(100vw-2rem))] rounded-md border bg-card p-3 shadow-lg">
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
      <select value={value} onChange={(event) => onChange(event.target.value)} className={`rounded-md border px-2 py-1 text-sm ${isAll ? "border-border bg-background text-muted-foreground" : "border-primary bg-primary/10 text-foreground"}`}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {selected ? null : null}
    </label>
  );
}

function BoardColumn({ column, cards, collapsed, onToggleCollapsed, onDrop }: { column: string; cards: CardItem[]; collapsed: boolean; onToggleCollapsed: () => void; onDrop: (cardId: string) => void }) {
  const [over, setOver] = useState(false);
  return (
    <section onDragOver={(event) => { event.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(event) => { event.preventDefault(); setOver(false); const id = event.dataTransfer.getData("text/stelow-card"); if (id) onDrop(id); }} className={`flex min-h-40 flex-col rounded-lg border bg-muted/30 p-2 transition ${over ? "border-primary bg-primary/5" : "border-border"} ${collapsed ? "items-center" : ""}`}>
      <button onClick={onToggleCollapsed} className={`${collapsed ? "flex h-full w-full cursor-pointer flex-col items-center gap-2 py-2 hover:bg-foreground/5" : "mb-2 flex cursor-pointer items-center justify-between gap-2 rounded-md px-1 py-0.5 hover:bg-foreground/5"} text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground`} title={collapsed ? `Expand ${COLUMN_LABELS[column]}` : `Collapse ${COLUMN_LABELS[column]}`} aria-label={collapsed ? `Expand ${COLUMN_LABELS[column]}` : `Collapse ${COLUMN_LABELS[column]}`}>
        {collapsed ? (
          <>
            <span className="rounded-md bg-foreground/10 px-1.5 text-foreground">{cards.length}</span>
            <span style={{ writingMode: "vertical-rl" }} className="text-[10px] tracking-widest text-foreground/80">{COLUMN_LABELS[column]}</span>
            <span aria-hidden className="text-foreground/60">▸</span>
          </>
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="text-foreground/60">▾</span>
              <span>{COLUMN_LABELS[column]}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="rounded-md bg-foreground/10 px-2 text-foreground">{cards.length}</span>
              <span aria-hidden className="text-foreground/60">▸</span>
            </span>
          </>
        )}
      </button>
      {!collapsed ? (
        <div className="space-y-2" role="list" aria-label={`${COLUMN_LABELS[column]} cards`}>
          {cards.map((card) => <BoardCard key={card.id} card={card} />)}
        </div>
      ) : null}
    </section>
  );
}

function BoardCard({ card }: { card: CardItem }) {
  const navigate = useBbNavigate();
  const attention = card.needsAttention;
  const running = card.activity === "running";
  const borderClass = running
    ? "stelow-border-running"
    : attention
    ? "stelow-border-attention"
    : "border-border hover:border-primary/60";
  const open = useCallback(() => navigate.toPluginPanel("board", { subPath: `card/${card.id}` }), [navigate, card.id]);
  const openWorker = useCallback(() => { if (card.workerThreadId) navigate.toThread(card.workerThreadId); }, [navigate, card.workerThreadId]);
  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
      return;
    }
    if ((event.key === "w" || event.key === "W") && card.workerThreadId) {
      event.preventDefault();
      openWorker();
    }
  }, [open, openWorker, card.workerThreadId]);
  return (
    <button
      role="listitem"
      draggable
      onDragStart={(event) => { event.dataTransfer.setData("text/stelow-card", card.id); event.dataTransfer.effectAllowed = "move"; }}
      onClick={open}
      onDoubleClick={openWorker}
      onKeyDown={onKeyDown}
      title="Click to inspect · double-click or W to open the worker thread"
      className={`stelow-board-card relative block w-full cursor-pointer overflow-hidden rounded-lg border bg-card p-3 text-left shadow-sm transition hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${borderClass}`}
      aria-label={`Open card ${card.displayName}. Press Enter to inspect, W to open the worker thread.`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 truncate text-sm font-medium leading-tight text-foreground">{card.displayName}</div>
        <ActivityPill activity={card.activity} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <Pill className="whitespace-nowrap">{INTENT_LABEL[card.intent] ?? card.intent}</Pill>
        <span className="ml-auto truncate rounded-md bg-foreground/10 px-1.5 py-0.5 text-[10px] font-medium text-foreground/80">{stageLabel(card.stage)}</span>
      </div>
      {attention ? (
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
          <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
          <span>{attentionLabel(card)}</span>
        </div>
      ) : null}
      {card.activity === "error" && card.lastError ? <p className="mt-2 line-clamp-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-[11px] text-destructive" title={card.lastError}>{card.lastError}</p> : null}
      {card.activity === "idle" ? <div className="mt-1 text-[10px] text-muted-foreground">Idle since {new Date(card.updatedAt).toLocaleString()}</div> : null}
    </button>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md bg-muted p-2"><div className="text-[10px] uppercase text-muted-foreground">{label}</div><div className="truncate font-medium">{value}</div></div>;
}

// Timeline of the 17 workflow stages, grouped by phase (band). Each stage is a
// chip: passed / current / upcoming. Clicking an allowed target advances or
// regresses ONE stage — the timeline is the position context AND the advance
// control, so the user always sees where the card is and what it can move to.
function StageTimeline({ currentStage, nextStages, onPick }: { currentStage: string; nextStages: string[]; onPick: (stage: string) => void }) {
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
                return (
                  <button
                    key={stage}
                    type="button"
                    disabled={!clickable || isCurrent}
                    title={STAGE_PRODUCES[stage]}
                    onClick={() => onPick(stage)}
                    className={`relative inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
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
                    {canAdvance ? <span aria-hidden className="text-[9px]">→</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <p className="text-[11px] text-muted-foreground">→ advance one step at a time (gates apply); ← go back any number of steps. The agent usually advances on its own.</p>
    </div>
  );
}

function CardDrawerAdapter(props: PluginThreadPanelProps) {
  const params = props.params;
  const cardId = typeof params === "object" && params && "cardId" in params && typeof params.cardId === "string" ? params.cardId : "";
  const navigate = useBbNavigate();
  if (!cardId) return <p className="p-4 text-sm text-muted-foreground">Pick a card from the Stelow board to see its detail here.</p>;
  return <CardDetailBody cardId={cardId} onClose={() => { /* host tab close */ }} navigate={navigate} />;
}

function CardDetailHeader({ cardId, onBack, restartFocusKey }: { cardId: string; onBack: () => void; restartFocusKey?: number }) {
  const rpc = useRpc<typeof rpcContract>();
  const [card, setCard] = useState<CardItem | null>(null);
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
  return (
    <header className="flex items-center gap-2 border-b bg-card/80 px-3 py-1.5">
      <button onClick={onBack} title="Back to board (Esc)" className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md bg-background px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
        <span aria-hidden>←</span>
        <span>Board</span>
      </button>
      <nav className="min-w-0 flex-1 truncate text-xs text-muted-foreground" aria-label="Breadcrumb">
        <span>Stelow</span>
        <span aria-hidden className="mx-1 text-border">/</span>
        <span className="font-medium text-foreground">{card?.displayName ?? card?.name ?? "Loading…"}</span>
        {card ? <span className="ml-2 text-muted-foreground">· {statusLabel(card.status)}{card.status !== card.stage ? ` · ${stageLabel(card.stage)}` : ""}</span> : null}
      </nav>
      {card ? <>
        <ActivityPill activity={card.activity} />
      </> : null}
      <button ref={closeRef} onClick={onBack} title="Close (Esc)" aria-label="Close card details" className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md bg-background text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
        <span aria-hidden>×</span>
      </button>
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

function ScopesList({ scopes }: { scopes: Extract<CardDetailResponse, { scopes: unknown }>["scopes"] }) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set(scopes.filter((scope) => scope.status === "in-progress").map((scope) => scope.id)));
  const { ordered, waitingOn } = orderScopes(scopes);
  const byId = new Map(scopes.map((s) => [s.id, s]));
  const finished = (id: string) => ["done", "completed"].includes(byId.get(id)?.status ?? "");
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Scopes ({scopes.length})</h3>
      {scopes.length > 1 ? <p className="text-[11px] text-muted-foreground">Ordered by dependency — a scope that depends on another appears after it; ⛔ marks one waiting on an unfinished dependency.</p> : null}
      {ordered.map((scope) => {
        const isOpen = openIds.has(scope.id);
        const wait = waitingOn.get(scope.id) ?? [];
        const blockedNow = wait.length > 0;
        const tasksSorted = [...scope.tasks].sort((a, b) => statusRank(a.status) - statusRank(b.status));
        return (
          <details key={scope.id} open={isOpen} onToggle={(event) => { const next = new Set(openIds); if ((event.currentTarget as HTMLDetailsElement).open) next.add(scope.id); else next.delete(scope.id); setOpenIds(next); }} className={`rounded-md border p-3 ${scope.status === "in-progress" ? "stelow-border-running" : blockedNow ? "border-amber-500/50" : "border-border"}`}>
            <summary className="cursor-pointer list-none space-y-1">
              <div className="flex flex-wrap items-center gap-1">
                <span className="font-mono text-xs text-muted-foreground">{scope.id}</span>
                <span className="font-medium">{scope.name}</span>
                {scope.type ? <Pill>{scope.type}</Pill> : null}
                <Pill tone={statusTone(scope.status)}><span className="mr-1">{statusGlyph(scope.status)}</span>{statusLabel(scope.status)}</Pill>
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
                className={`rounded-md border p-2 text-left text-sm ${answers.includes(option.label) ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background/40 text-foreground"}`}
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
          <div className="text-sm font-medium text-amber-900 dark:text-amber-200">Waiting for your answer — the agent paused</div>
          <p className="mt-1 text-sm text-amber-900/80 dark:text-amber-200/80">{question.question}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {question.options.map((option) => <Button key={option.label} size="sm" variant="outline" disabled={answering} onClick={() => onAnswer(option.label)}>{option.label}</Button>)}
          </div>
          <p className="mt-2 text-xs text-amber-900/70 dark:text-amber-200/70">The ask timed out, but the agent is waiting — answering here resumes the workflow.</p>
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
      <h3 className="text-sm font-semibold">Timed-out questions waiting for your answer</h3>
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
          <DialogDescription>Presets set the provider, model, reasoning level, and permission mode used when a card starts its worker thread.</DialogDescription>
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
          <p className="mb-2 text-xs text-muted-foreground">Each phase uses its own preset. The worker is switched automatically when the card reaches a phase with a different preset; cards with no phase preset use the card's preset (or default).</p>
          <div className="grid gap-2">
            {bandPresets.map((band) => (
              <div key={band.band} className="flex items-center gap-2 text-sm">
                <span className="w-24 shrink-0 capitalize">{band.band}</span>
                <select
                  className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
                  value={band.presetId ?? ""}
                  onChange={(event) => {
                    const value = event.target.value || null;
                    setBusy(true);
                    void rpc.call("setBandPreset", { band: band.band, presetId: value }).then(() => { void onChanged(); void rpc.call("listBandPresets", {}).then((result) => setBandPresets(result.bands)).catch(() => setBandPresets([])); }).catch(() => setMessage("Failed to set phase preset.")).finally(() => setBusy(false));
                  }}
                >
                  <option value="">— Card default —</option>
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
                <select className="h-9 rounded-md border bg-background px-2 text-sm" value={form.providerId} onChange={(event) => { setForm({ ...form, providerId: event.target.value, modelId: options.models.find((model) => model.providerId === event.target.value)?.model ?? "" }); }}>
                  {options.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.displayName} ({provider.id})</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-2"><span>Model</span>
                <select className="h-9 rounded-md border bg-background px-2 text-sm" value={form.modelId} onChange={(event) => setForm({ ...form, modelId: event.target.value })}>
                  {providerModels.length === 0 ? <option value={form.modelId}>{form.modelId}</option> : null}
                  {providerModels.map((model) => <option key={model.model} value={model.model}>{model.displayName} ({model.model})</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground"><span>Reasoning</span>
                <select className="h-9 rounded-md border bg-background px-2 text-sm" value={form.reasoningLevel} onChange={(event) => setForm({ ...form, reasoningLevel: event.target.value })}>
                  {["low", "medium", "high", "xhigh", "max"].map((level) => <option key={level} value={level}>{level}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground"><span>Permission mode</span>
                <select className="h-9 rounded-md border bg-background px-2 text-sm" value={form.permissionMode} onChange={(event) => setForm({ ...form, permissionMode: event.target.value as "accept-edits" | "auto" | "full" })}>
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

function ConfirmActionDialog({ open, onOpenChange, title, description, confirmLabel, confirmTone, onConfirm }: { open: boolean; onOpenChange: (next: boolean) => void; title: string; description: string; confirmLabel: string; confirmTone?: "destructive" | "default"; onConfirm: () => void | Promise<void> }) {
  const [pending, setPending] = useState(false);
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

function CardDetailBody({ cardId, onClose, navigate }: { cardId: string; onClose: () => void; navigate: ReturnType<typeof useBbNavigate> }) {
  const rpc = useRpc<typeof rpcContract>();
  const [card, setCard] = useState<CardItem | null>(null);
  const [detail, setDetail] = useState<CardDetailResponse | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState<string | null>(null);
  const [pendingAdvance, setPendingAdvance] = useState<string | null>(null);
  const [repairOpen, setRepairOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const detailResult = await rpc.call("cardDetail", { cardId });
      const listResult = await rpc.call("listCards", { projectId: detailResult.card.projectId });
      setDetail(detailResult);
      setCard(listResult.cards.find((entry) => entry.id === cardId) ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load card.");
    }
  }, [cardId, rpc]);

  useEffect(() => { void load(); void rpc.call("markCardSeen", { cardId }); }, [cardId, load, rpc]);
  useDebouncedRealtime(["card-state"], () => { void load(); });

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

  async function doRepair() {
    setRepairOpen(false);
    const result = await rpc.call("reseedCard", { cardId });
    if (!result.reseeded) {
      toast.error(result.error ?? "Repair failed");
      return;
    }
    toast.success("Workflow repaired. Agent restarts from triage.");
    await load();
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

  // Resume (formerly Repair) is the primary action whenever the worker is
  // idle on an unfinished card — a stopped worker may have left a step
  // incomplete. Read off the card's own activity (no separate kind).
  const showResume = card?.activity === "idle" && card.workerThreadId != null;
  const pendingFirst = detail?.pendingQuestions?.[0] ?? null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-auto p-4">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {card ? (
          <>
            <p className="text-sm text-foreground">{card.prompt}</p>
            {detail?.mentionedFiles && detail.mentionedFiles.length > 0 ? (
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Mentioned files:</span>
                <div className="flex flex-wrap gap-1">
                  {detail.mentionedFiles.map((file) => (
                    <button
                      key={file.path}
                      onClick={() => navigate.toPluginPanel("review-document", { subPath: file.path })}
                      className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-0.5 text-xs text-foreground hover:bg-muted"
                      title={`Open ${file.path}`}
                    >
                      <span>📄</span>
                      <span>{file.display}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {detail?.artifacts && detail.artifacts.length > 0 ? (
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Assets produced by the workflow:</span>
                <div className="flex flex-wrap gap-1">
                  {detail.artifacts.map((asset) => (
                    <button
                      key={asset.path}
                      onClick={() => navigate.toPluginPanel("review-document", { subPath: asset.path })}
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-foreground hover:bg-emerald-500/20"
                      title={`${asset.stage}: ${asset.path}`}
                    >
                      <span>📎</span>
                      <span className="text-muted-foreground">{asset.stage}</span>
                      <span>{asset.display}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Meta label="Stage" value={stageLabel(card.stage)} />
              {card.stage === "select" ? (
                <p className="col-span-2 text-xs text-muted-foreground">
                  Stage <strong>select</strong> (<em>Item Selection</em>) invites you to choose which item / group from the
                  triage inbox to work on. It is <strong>not</strong> asking for the intent type (that is the Intent dropdown
                  above, already set). Pick the item in the thread; when done the agent advances on its own — or use
                  <em> Advance stage</em> below to move on now.
                </p>
              ) : null}
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Intent {card.intent && card.intent !== "unknown" ? `· ${INTENT_LABEL[card.intent] ?? card.intent}` : ""}</span>
                <select
                  aria-label="Intent"
                  title="Change intent"
                  className="h-7 rounded-md border bg-background px-1.5 text-xs font-medium"
                  value={card.intent}
                  onChange={async (event) => {
                    const nextIntent = event.target.value as "new-product" | "feature" | "bugfix" | "refactor" | "investigate" | "unknown";
                    const result = await rpc.call("updateCardIntent", { cardId, intent: nextIntent });
                    if (result.ok) {
                      toast.success(`Intent changed to ${INTENT_LABEL[nextIntent] ?? nextIntent}`);
                      await load();
                    } else {
                      toast.error(result.error ?? "Could not change intent.");
                    }
                  }}
                >
                  <option value="new-product">New Product</option>
                  <option value="feature">Feature</option>
                  <option value="bugfix">Bugfix</option>
                  <option value="refactor">Refactor</option>
                  <option value="investigate">Investigate</option>
                  <option value="unknown">Unknown (agent decides)</option>
                </select>
              </div>
              <Meta label="Updated" value={new Date(card.updatedAt).toLocaleString()} />
            </div>
            {card.lastError ? <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{card.lastError}</p> : null}

            {pendingFirst && card.activity === "awaiting-answer" ? <AwaitingAnswerBanner cardId={card.id} question={pendingFirst} onAnswered={() => void load()} /> : null}

            {detail && detail.expiredQuestions.length > 0 ? <ExpiredQuestionsSection cardId={card.id} questions={detail.expiredQuestions} /> : null}

            {detail && card.activity === "awaiting-answer" && detail.pendingQuestions.length > 1 ? (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">More pending questions</h3>
                {detail.pendingQuestions.slice(1).map((question) => <AwaitingAnswerBanner key={question.id} cardId={card.id} question={question} onAnswered={() => void load()} />)}
              </section>
            ) : null}

            {detail && detail.scopes.length > 0 ? <ScopesList scopes={detail.scopes} /> : null}

            {detail && card ? (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Workflow</h3>
                <StageTimeline
                  currentStage={card.stage}
                  nextStages={detail.nextStages}
                  onPick={(stage) => setPendingAdvance(stage)}
                />
              </section>
            ) : null}

            <section className="space-y-1">
              <h3 className="text-sm font-semibold">Agent preset</h3>
              <p className="text-xs text-muted-foreground">Presets are configured globally per workflow phase from the board's <strong>Presets</strong> button — not per card. This card is in the <strong>{stageLabel(card.stage)}</strong> phase.</p>
              <div className="flex flex-wrap items-center gap-2">
                {card.stage ? (
                  <Pill tone="bg-muted text-muted-foreground">
                    {BAND_LABEL[STAGE_BAND[card.stage] ?? "analysis"]} · {detail?.card.presetName ?? "default"}
                    {detail?.card.presetProviderId && detail?.card.presetModelId ? (
                      <span className="ml-1.5 font-mono text-[10px] text-muted-foreground/80">{detail.card.presetProviderId}/{detail.card.presetModelId}</span>
                    ) : null}
                  </Pill>
                ) : null}
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Comments</h3>
              <div className="space-y-2 rounded-md border bg-muted/30 p-2">
                {detail?.comments.length ? detail.comments.map((entry) => (
                  <div key={entry.id} className="rounded-md border bg-card p-3">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <Pill tone={entry.author === "agent" ? "bg-primary/15 text-primary" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"}>{entry.author}</Pill>
                      <span>{new Date(entry.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="mt-1 text-sm"><Markdown content={entry.body} /></p>
                  </div>
                )) : <p className="text-xs text-muted-foreground">No comments yet.</p>}
              </div>
              <textarea value={comment} onChange={(event) => setComment(event.target.value)} className="min-h-24 w-full rounded-md border bg-background p-2 text-sm" placeholder="Send a comment to the agent." />
              <div className="flex justify-end"><Button disabled={!comment.trim()} onClick={() => void submitComment()}>Send to agent</Button></div>
            </section>
          </>
        ) : null}
      </div>
      <footer className="flex flex-wrap gap-1 border-t p-3">
        {card?.workerThreadId ? <Button size="sm" variant="outline" onClick={() => navigate.toThread(card.workerThreadId ?? "")}>Open thread</Button> : null}
        {showResume ? (
          <Button size="sm" variant="outline" onClick={() => setRepairOpen(true)}>
            Resume
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={() => setArchiveOpen(true)}>Archive</Button>
      </footer>
      <ConfirmActionDialog
        open={repairOpen}
        onOpenChange={setRepairOpen}
        title="Repair this workflow?"
        description="Reseed state.md and stelow.json so the agent restarts from the triage stage. Existing scope work and comments are kept."
        confirmLabel="Repair"
        confirmTone="default"
        onConfirm={doRepair}
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
                  ? "This is a manual override — the agent usually advances on its own. Stage gates (product, interface, plan, diff) still apply on the next advance."
                  : "Going back is safe and reversible — the workflow will re-run earlier stages as needed."}
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
        description="The card is moved to the Archived column and the worker thread is stopped. Comments and history are preserved."
        confirmLabel="Archive"
        confirmTone="destructive"
        onConfirm={doArchive}
      />
    </div>
  );
}

function PillsyStyles() {
  if (typeof document === "undefined") return null;
  if (document.getElementById("stelow-style")) return null;
  const style = document.createElement("style");
  style.id = "stelow-style";
  style.textContent = [
    "@keyframes stelow-border-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }",
    ".stelow-board-card.stelow-border-running { position: relative; isolation: isolate; border-color: transparent !important; }",
    ".stelow-board-card.stelow-border-running::before { content: ''; position: absolute; inset: -1px; border-radius: inherit; padding: 1.5px; background: conic-gradient(from 0deg, hsl(220 90% 60% / 0.95), hsl(280 80% 60% / 0.95), hsl(160 75% 55% / 0.95), hsl(220 90% 60% / 0.95)); -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; animation: stelow-border-spin 4s linear infinite; pointer-events: none; z-index: -1; }",
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
        {options.map((option) => <button key={option.label} onClick={() => toggle(option.label)} className={`w-full rounded-md border p-3 text-left ${answers.includes(option.label) ? "border-primary bg-primary/10" : "border-border"}`}><div className="font-medium">{option.label}</div><div className="text-sm text-muted-foreground">{option.description}</div></button>)}
      </div>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => void cancel()}>Cancel</Button><Button disabled={answers.length === 0} onClick={() => void submit({ answers })}>Continue</Button></div>
    </div>
  );
}

function DocumentReviewImpl({ path, source }: { path: string; source: PluginFileOpenerProps["source"] }) {
  const { projectId: routeProjectId } = useBbContext();
  const projectId = source.projectId ?? routeProjectId;
  const rpc = useRpc<typeof rpcContract>();
  const [content, setContent] = useState("");
  const [sha256, setSha256] = useState("");
  const [selection, setSelection] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { const result = await rpc.call("readDocument", { projectId, path }); setContent(result.content); setSha256(result.sha256); setError(result.error); }, [path, projectId, rpc]);
  useEffect(() => { void load(); }, [load]);
  useDebouncedRealtime(["board-changed"], () => { void load(); });

  async function saveComment() {
    const result = await rpc.call("addComment", { projectId, path, expectedSha256: sha256, selectedText: selection, comment });
    if (!result.saved) return toast.error(result.error ?? "Comment failed");
    setComment(""); setSelection(""); toast.success("Review comment added"); await load();
  }

  return <div className="space-y-4">
    <div className="text-xs text-muted-foreground">{path}</div>
    {error ? <p className="text-sm text-destructive">{error}</p> : <div onMouseUp={() => setSelection(window.getSelection()?.toString() ?? "")} className="rounded-md border bg-card p-4"><Markdown content={content} /></div>}
    <Card><CardHeader><CardTitle className="text-base">Inline review comment</CardTitle></CardHeader><CardContent className="space-y-2">{selection ? <blockquote className="line-clamp-3 border-l pl-3 text-sm text-muted-foreground">{selection}</blockquote> : <p className="text-xs text-muted-foreground">Select text above to quote it, or comment on the whole document.</p>}<textarea value={comment} onChange={(event) => setComment(event.target.value)} className="min-h-24 w-full rounded-md border bg-background p-2 text-sm" placeholder="Request a change or leave context…" /><Button disabled={!comment.trim()} onClick={() => void saveComment()}>Add comment</Button></CardContent></Card>
  </div>;
}

function DocumentReview(props: PluginFileOpenerProps) {
  return <DocumentReviewImpl path={props.path} source={props.source} />;
}

function ThreadDocumentPanel({ params }: { params: unknown }) {
  const path = typeof params === "object" && params && "path" in params && typeof params.path === "string" ? params.path : "";
  return path ? <DocumentReviewImpl path={path} source={{ kind: "workspace", threadId: null, environmentId: null, projectId: null }} /> : <p className="text-sm text-muted-foreground">Choose an artifact from the Stelow board.</p>;
}

function OpenStelowBoardAction() {
  const navigate = useBbNavigate();
  return <button onClick={() => navigate.toPluginPanel("board", { subPath: "" })} className="rounded-md border bg-card px-2 py-1 text-xs shadow-sm hover:border-primary/50">Stelow board</button>;
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
      className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs text-foreground hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
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
    id: "board",
    title: "Stelow",
    icon: "Columns",
    path: "board",
    component: (props) => { PillsyStyles(); return <BoardPanel subPath={props.subPath} />; },
    experimental_sidebarAccessory: StelowSidebarAccessory,
  });
  app.slots.pendingInteraction({ id: "stelow-question", component: QuestionForm });
  app.slots.fileOpener({ id: "stelow-markdown-review", title: "Review with Stelow", extensions: ["md"], component: DocumentReview });
  app.slots.threadPanelAction({ id: "review-document", title: "Review Stelow document", icon: "FileText", component: ThreadDocumentPanel });
  app.slots.threadPanelAction({ id: "stelow-card-detail", title: "Stelow card", icon: "Columns", component: CardDrawerAdapter });
  app.slots.experimental_threadHeaderAction({ id: "open-stelow-board", title: "Stelow board", component: OpenStelowBoardAction });

  app.slots.messageDirective({
    id: "stelow-artifact",
    component: StelowArtifactDirective,
  });
});

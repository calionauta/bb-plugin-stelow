import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Markdown,
  definePluginApp,
  useBbContext,
  useBbNavigate,
  useComposer,
  useRealtime,
  useRpc,
  type PluginFileOpenerProps,
  type PluginPendingInteractionProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type ProjectList = Awaited<ReturnType<ReturnType<typeof useRpc<typeof rpcContract>>["call"]>>;
type ProjectItem = Extract<ProjectList, { projects: unknown }>["projects"][number];

type ProjectsResult = Awaited<ReturnType<typeof useRpc<typeof rpcContract>>["call"]> extends infer R ? Extract<R, { projects?: unknown }> : never;

const COLUMNS = ["draft", "planning", "awaiting-answer", "in-progress", "completed", "blocked", "archived"] as const;
const COLUMN_LABELS: Record<string, string> = {
  draft: "Triage",
  planning: "Shaping",
  "awaiting-answer": "Gate pending",
  "in-progress": "Running",
  completed: "Done",
  blocked: "Blocked",
  archived: "Archived",
};

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

function stageLabel(stage: string) {
  return STAGE_LABELS[stage] ?? stage;
}

type BoardResult = Awaited<ReturnType<ReturnType<typeof useRpc<typeof rpcContract>>["call"]>>;
type Workflow = Extract<BoardResult, { workflows: unknown }>["workflows"][number];
type ProjectsResponse = Extract<BoardResult, { projects: unknown }>;
type Project = ProjectsResponse["projects"][number];
type CardsResponse = Extract<BoardResult, { cards: unknown }>;
type CardItem = CardsResponse["cards"][number];
type CardDetailResponse = Extract<BoardResult, { card: unknown; comments: unknown; pendingQuestions: unknown }>;
type CardComment = CardDetailResponse["comments"][number];
type CardQuestion = CardDetailResponse["pendingQuestions"][number];

function startReason(projectId: string | null, prompt: string, rootPath: string | null): string | null {
  if (!projectId) return "Select a normal bb project (not the singleton Personal project) in the sidebar.";
  if (!prompt.trim()) return "Describe a product request to start the workflow.";
  if (!rootPath) return "The selected bb project has no workspace source. Add one with `bb project add`.";
  return null;
}

function activityGlyph(activity: CardItem["activity"]) {
  if (activity === "running") return "▶";
  if (activity === "awaiting-answer") return "?";
  if (activity === "error") return "✗";
  if (activity === "idle") return "⏸";
  return "✓";
}

function activityLabel(activity: CardItem["activity"]) {
  if (activity === "idle") return "Waiting for agent";
  if (activity === "running") return "Agent working";
  if (activity === "awaiting-answer") return "Question for you";
  if (activity === "error") return "Failed";
  return activity;
}

function activityTone(activity: CardItem["activity"]) {
  if (activity === "running") return "bg-primary/15 text-primary";
  if (activity === "awaiting-answer") return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  if (activity === "error") return "bg-destructive/15 text-destructive";
  if (activity === "idle") return "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300";
  return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
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
  if (status === "in-progress" || status === "approved") return "▶";
  if (status === "archived") return "○";
  return "·";
}

function Pill({ children, tone = "bg-muted text-muted-foreground", className = "" }: { children: React.ReactNode; tone?: string; className?: string }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${tone} ${className}`}>{children}</span>;
}

function BoardPanel({ subPath }: { subPath: string }) {
  const { projectId: routeProjectId } = useBbContext();
  const navigate = useBbNavigate();
  const composer = useComposer();
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
  const [intent, setIntent] = useState<"new-product" | "feature" | "bugfix" | "refactor" | "investigate">("feature");
  const [filterProjectId, setFilterProjectId] = useState<string | "all">("all");
  const [filterStage, setFilterStage] = useState<string>("all");
  const [filterIntent, setFilterIntent] = useState<string | "all">("all");
  const [filterStatus, setFilterStatus] = useState<string | "all">("all");
  const [filterActivity, setFilterActivity] = useState<string | "all">("all");
  const [filterAttention, setFilterAttention] = useState(false);

  const load = useCallback(async (targetId: string | null) => {
    setLoading(true);
    try {
      const [projectsResult, cardsResult] = await Promise.all([
        rpc.call("projects", {}).catch(() => null),
        rpc.call("listCards", { projectId: targetId }).catch(() => ({ cards: [] })),
      ]);
      setProjects(projectsResult?.projects ?? []);
      setCards(cardsResult.cards);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load Stelow.");
      setProjects([]);
      setCards([]);
    } finally {
      setLoading(false);
    }
  }, [rpc]);

  useEffect(() => { void load(boardProjectId ?? routeProjectId); }, [load, boardProjectId, routeProjectId]);
  useRealtime("card-state", () => { void load(boardProjectId ?? routeProjectId); });
  useRealtime("board-changed", () => { void load(boardProjectId ?? routeProjectId); });

  const activeProjectId = boardProjectId ?? routeProjectId;
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const reason = !activeProjectId ? "Select a normal bb project (not the singleton Personal project) in the sidebar." : !prompt.trim() ? "Describe a product request to start the workflow." : null;
  const inbox = cards.filter((card) => card.actionRequired && card.status !== "archived");
  const filteredCards = useMemo(() => cards.filter((card) => {
    if (filterProjectId !== "all" && card.projectId !== filterProjectId) return false;
    if (filterIntent !== "all" && card.intent !== filterIntent) return false;
    if (filterStatus !== "all" && card.status !== filterStatus) return false;
    if (filterActivity !== "all" && card.activity !== filterActivity) return false;
    if (filterStage !== "all" && card.stage !== filterStage) return false;
    if (filterAttention && !card.actionRequired) return false;
    return true;
  }), [cards, filterProjectId, filterIntent, filterStatus, filterActivity, filterStage, filterAttention]);
  const stageOptions = useMemo(() => Array.from(new Set(cards.map((card) => card.stage))).sort(), [cards]);
  const grouped = useMemo(() => {
    const groups: Record<string, CardItem[]> = Object.fromEntries(COLUMNS.map((column) => [column, []]));
    for (const card of filteredCards) {
      const column = (COLUMNS as readonly string[]).includes(card.status) ? card.status : "draft";
      (groups[column] ?? groups.draft).push(card);
    }
    for (const column of Object.keys(groups)) {
      groups[column]!.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return groups;
  }, [filteredCards]);

  async function start() {
    if (!activeProjectId || !prompt.trim()) return;
    try {
      const result = await rpc.call("createCard", { projectId: activeProjectId, prompt: prompt.trim(), intent });
      setPrompt("");
      navigate.openThreadPanel({ actionId: "stelow-card-detail", title: result.cardId, params: { cardId: result.cardId } });
      toast.success("Card created. The agent is working in the background.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to create the card.");
    }
  }

  async function moveCard(cardId: string, target: string) {
    if (!(COLUMNS as readonly string[]).includes(target)) return;
    const result = await rpc.call("moveCard", { cardId, status: target as CardItem["status"] });
    if (!result.ok) toast.error(result.error ?? "Move failed");
  }

  function prefillAnswerInThread(question: CardQuestion, card: CardItem) {
    const draft = `${question.title}\n\n${question.question}\n\n${question.options.map((option) => `- ${option.label}${option.description ? ` — ${option.description}` : ""}`).join("\n")}\n\nMy answer: `;
    composer?.setText(draft);
    if (card.workerThreadId) navigate.toThread(card.workerThreadId);
  }

  const cardMatch = subPath.match(/^card\/(card_[A-Za-z0-9]+)\/?$/);
  if (cardMatch && cardMatch[1]) {
    const cardId = cardMatch[1];
    return (
      <div className="flex h-full flex-col overflow-hidden bg-background">
        <CardDetailHeader
          cardId={cardId}
          onBack={() => navigate.toPluginPanel("board", { subPath: "" })}
        />
        <div className="flex-1 overflow-auto">
          <CardDetailBody cardId={cardId} onClose={() => navigate.toPluginPanel("board", { subPath: "" })} composer={composer} navigate={navigate} />
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
              <span className="text-xs text-muted-foreground">· {cards.length} cards · {inbox.length} need attention</span>
            </div>
            <p className="text-sm text-muted-foreground">Describe a request below to start a workflow. The agent runs in the background and posts updates here.</p>
          </div>

          <form
            onSubmit={(event) => { event.preventDefault(); if (!reason) void start(); }}
            className="grid items-stretch gap-2 rounded-xl border bg-card/60 p-3 md:grid-cols-[1fr_2fr_auto_auto]"
          >
            <ProjectPill value={activeProjectId} onChange={setBoardProjectId} projects={projects} />
            <Input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe a product request to start with Stelow…" className="h-10" />
            <select className="h-10 rounded-md border bg-background px-3 text-sm" value={intent} onChange={(event) => setIntent(event.target.value as typeof intent)} aria-label="Intent">
              {Object.entries(INTENT_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <span title={reason ?? "Start a Stelow workflow"}><Button type="submit" disabled={Boolean(reason)} className="h-10 px-5">Start</Button></span>
          </form>
          {reason ? <p className="-mt-2 px-1 text-xs text-muted-foreground">{reason}</p> : null}

          <FilterBar
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
        </div>
      </div>
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

function FilterBar({ projects, stageOptions, filterProjectId, filterStage, filterIntent, filterStatus, filterActivity, filterAttention, onProject, onStage, onIntent, onStatus, onActivity, onAttention, onReset }: {
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
  const filtersActive = filterProjectId !== "all" || filterStage !== "all" || filterIntent !== "all" || filterStatus !== "all" || filterActivity !== "all" || filterAttention;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
      <FilterChip label="Project" value={filterProjectId} onChange={onProject} options={[{ value: "all", label: "All projects" }, ...projects.map((project) => ({ value: project.id, label: project.name }))]} />
      <FilterChip label="Type" value={filterIntent} onChange={onIntent} options={[{ value: "all", label: "All types" }, ...Object.entries(INTENT_LABEL).map(([value, label]) => ({ value, label }))]} />
      <FilterChip label="Status" value={filterStatus} onChange={onStatus} options={[{ value: "all", label: "Any status" }, ...COLUMNS.map((column) => ({ value: column, label: COLUMN_LABELS[column] ?? column }))]} />
      <FilterChip label="Stage" value={filterStage} onChange={onStage} options={[{ value: "all", label: "Any stage" }, ...stageOptions.map((stage) => ({ value: stage, label: stage }))]} />
      <FilterChip label="Activity" value={filterActivity} onChange={onActivity} options={[{ value: "all", label: "Any activity" }, { value: "idle", label: "idle" }, { value: "running", label: "running" }, { value: "awaiting-answer", label: "awaiting-answer" }, { value: "error", label: "error" }]} />
      <button onClick={() => onAttention(!filterAttention)} className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition ${filterAttention ? "border-amber-500 bg-amber-500/15 text-amber-700 dark:text-amber-300" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}>
        <span aria-hidden className={`size-1.5 rounded-full ${filterAttention ? "bg-amber-500" : "bg-muted-foreground"}`} />
        Needs attention
      </button>
      {filtersActive ? <button onClick={onReset} className="inline-flex h-7 items-center rounded-full border bg-background px-3 text-xs text-muted-foreground hover:text-foreground">Clear</button> : null}
    </div>
  );
}

function FilterChip({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  const selected = options.find((option) => option.value === value);
  const isAll = value === "all";
  return (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className={`h-7 rounded-full border px-3 text-xs ${isAll ? "border-border bg-background text-muted-foreground" : "border-primary bg-primary/10 text-foreground"}`}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      {isAll ? null : selected ? null : null}
    </select>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="rounded-md border bg-background px-2 py-1 text-sm text-foreground">
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
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
        <div className="space-y-2">
          {cards.map((card) => <BoardCard key={card.id} card={card} />)}
        </div>
      ) : null}
    </section>
  );
}

function BoardCard({ card }: { card: CardItem }) {
  const navigate = useBbNavigate();
  const attention = card.actionRequired;
  const running = card.activity === "running";
  const borderClass = running
    ? "stelow-border-running"
    : attention
    ? "stelow-border-attention"
    : "border-border hover:border-primary/60";
  return (
    <button
      draggable
      onDragStart={(event) => { event.dataTransfer.setData("text/stelow-card", card.id); event.dataTransfer.effectAllowed = "move"; }}
      onClick={() => navigate.toPluginPanel("board", { subPath: `card/${card.id}` })}
      onDoubleClick={() => { if (card.workerThreadId) navigate.toThread(card.workerThreadId); }}
      title="Click to inspect · double-click to open the worker thread"
      className={`stelow-board-card relative block w-full cursor-pointer overflow-hidden rounded-lg border bg-card p-3 text-left shadow-sm transition hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${borderClass}`}
      aria-label={`Open card ${card.displayName}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 truncate text-sm font-medium leading-tight text-foreground">{card.displayName}</div>
        <Pill tone={activityTone(card.activity)} className="shrink-0 whitespace-nowrap"><span className={`mr-1 inline-block ${running ? "stelow-pill-working rounded-full px-1" : ""}`}>{activityGlyph(card.activity)}</span>{activityLabel(card.activity)}</Pill>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <Pill className="whitespace-nowrap">{INTENT_LABEL[card.intent] ?? card.intent}</Pill>
        <Pill tone={statusTone(card.status)} className="whitespace-nowrap"><span className="mr-1">{statusGlyph(card.status)}</span>{statusLabel(card.status)}</Pill>
        <span className="ml-auto truncate rounded-md bg-foreground/10 px-1.5 py-0.5 text-[10px] font-medium text-foreground/80">{stageLabel(card.stage)}</span>
      </div>
      {attention ? <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300"><span aria-hidden className="size-1.5 rounded-full bg-amber-500" />Needs your attention</div> : null}
      {card.activity === "idle" ? <div className="mt-1 text-[10px] text-muted-foreground">Idle since {new Date(card.updatedAt).toLocaleString()}</div> : null}
    </button>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md bg-muted p-2"><div className="text-[10px] uppercase text-muted-foreground">{label}</div><div className="truncate font-medium">{value}</div></div>;
}

function CardDrawerAdapter(props: PluginThreadPanelProps) {
  const params = props.params;
  const cardId = typeof params === "object" && params && "cardId" in params && typeof params.cardId === "string" ? params.cardId : "";
  const navigate = useBbNavigate();
  const composer = useComposer();
  if (!cardId) return <p className="p-4 text-sm text-muted-foreground">Pick a card from the Stelow board to see its detail here.</p>;
  return <CardDetailBody cardId={cardId} onClose={() => { /* host tab close */ }} composer={composer} navigate={navigate} />;
}

function CardDetailHeader({ cardId, onBack }: { cardId: string; onBack: () => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const [card, setCard] = useState<CardItem | null>(null);
  useEffect(() => {
    let cancelled = false;
    void rpc.call("listCards", { projectId: null }).then((result) => {
      if (cancelled) return;
      setCard(result.cards.find((entry) => entry.id === cardId) ?? null);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [cardId, rpc]);
  useRealtime("card-state", () => {
    void rpc.call("listCards", { projectId: null }).then((result) => {
      setCard(result.cards.find((entry) => entry.id === cardId) ?? null);
    }).catch(() => undefined);
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onBack(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);
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
        {card ? <span className="ml-2 text-muted-foreground">· {stageLabel(card.stage)}</span> : null}
      </nav>
      {card ? <>
        <Pill tone={activityTone(card.activity)}><span className="mr-1">{activityGlyph(card.activity)}</span>{activityLabel(card.activity)}</Pill>
        <Pill tone={statusTone(card.status)}><span className="mr-1">{statusGlyph(card.status)}</span>{statusLabel(card.status)}</Pill>
      </> : null}
      <button onClick={onBack} title="Close (Esc)" aria-label="Close card details" className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md bg-background text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
        <span aria-hidden>×</span>
      </button>
    </header>
  );
}

function ScopesList({ scopes }: { scopes: Extract<CardDetailResponse, { scopes: unknown }>["scopes"] }) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set(scopes.filter((scope) => scope.status === "in-progress").map((scope) => scope.id)));
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Scopes ({scopes.length})</h3>
      {scopes.map((scope) => {
        const isOpen = openIds.has(scope.id);
        return (
          <details key={scope.id} open={isOpen} onToggle={(event) => { const next = new Set(openIds); if ((event.currentTarget as HTMLDetailsElement).open) next.add(scope.id); else next.delete(scope.id); setOpenIds(next); }} className={`rounded-md border p-3 ${scope.status === "in-progress" ? "stelow-border-running" : "border-border"}`}>
            <summary className="cursor-pointer list-none space-y-1">
              <div className="flex flex-wrap items-center gap-1">
                <span className="font-mono text-xs text-muted-foreground">{scope.id}</span>
                <span className="font-medium">{scope.name}</span>
                {scope.type ? <Pill>{scope.type}</Pill> : null}
                <Pill tone={statusTone(scope.status)}><span className="mr-1">{statusGlyph(scope.status)}</span>{statusLabel(scope.status)}</Pill>
              </div>
              {(scope.blockedBy?.length || scope.dependsOn?.length) ? (
                <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                  {scope.blockedBy?.map((dep) => <span key={dep} className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5">blocked by {dep}</span>)}
                  {scope.dependsOn?.map((dep) => <span key={dep} className="rounded-md border px-2 py-0.5">after {dep}</span>)}
                </div>
              ) : null}
            </summary>
            <div className="mt-3 space-y-1 border-l pl-3">
              {scope.tasks.length === 0 ? <p className="text-xs text-muted-foreground">No tasks tracked.</p> : scope.tasks.map((task) => (
                <div key={task.id} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 font-mono">{statusGlyph(task.status)}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span>{task.name}</span>
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

function CardDetailBody({ cardId, onClose, composer, navigate }: { cardId: string; onClose: () => void; composer: ReturnType<typeof useComposer>; navigate: ReturnType<typeof useBbNavigate> }) {
  const rpc = useRpc<typeof rpcContract>();
  const [card, setCard] = useState<CardItem | null>(null);
  const [detail, setDetail] = useState<CardDetailResponse | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState<string | null>(null);
  const [confirmingRepair, setConfirmingRepair] = useState(false);

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
  useRealtime("card-state", () => { void load(); });

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

  async function archive() {
    await rpc.call("cancelCard", { cardId });
  }

  async function repair() {
    if (!confirmingRepair) {
      setConfirmingRepair(true);
      setTimeout(() => setConfirmingRepair(false), 4000);
      return;
    }
    const result = await rpc.call("reseedCard", { cardId });
    setConfirmingRepair(false);
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

  

  function prefillAnswerInThread(question: CardQuestion) {
    const draft = `${question.title}\n\n${question.question}\n\n${question.options.map((option) => `- ${option.label}${option.description ? ` — ${option.description}` : ""}`).join("\n")}\n\nMy answer: `;
    composer?.setText(draft);
    if (card?.workerThreadId) navigate.toThread(card.workerThreadId);
  }

  const showRepair = Boolean(card?.lastError) || (card?.activity === "idle" && card ? Date.now() - card.updatedAt > 60 * 60 * 1000 : false);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-auto p-4">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {card ? (
          <>
            <p className="text-sm text-foreground">{card.prompt}</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Meta label="Stage" value={stageLabel(card.stage)} />
              <Meta label="Updated" value={new Date(card.updatedAt).toLocaleString()} />
            </div>
            {card.lastError ? <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{card.lastError}</p> : null}

            {detail && detail.pendingQuestions.length > 0 ? (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Pending questions</h3>
                {detail.pendingQuestions.map((question) => (
                  <div key={question.id} className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                    <div className="text-sm font-medium">{question.title}</div>
                    <p className="mt-1 text-sm text-muted-foreground">{question.question}</p>
                    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">{question.options.map((option) => <li key={option.label}><span className="font-medium text-foreground">{option.label}</span>{option.description ? ` — ${option.description}` : ""}</li>)}</ul>
                    <Button size="sm" className="mt-2" onClick={() => prefillAnswerInThread(question)}>Answer in thread</Button>
                  </div>
                ))}
              </section>
            ) : null}

            {detail && detail.scopes.length > 0 ? <ScopesList scopes={detail.scopes} /> : null}

            {detail && detail.nextStages.length > 0 ? (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Advance stage</h3>
                <p className="text-xs text-muted-foreground">Drives <code>bb stelow advance</code>. Use to override.</p>
                <div className="flex flex-wrap gap-1">
                  {detail.nextStages.map((stage) => (
                    <span key={stage} title={stage}><Button size="sm" variant="outline" disabled={advancing !== null} onClick={() => void advance(stage)}>{advancing === stage ? "…" : stageLabel(stage)}</Button></span>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Comments</h3>
              <div className="space-y-2 rounded-md border bg-muted/30 p-2">
                {detail?.comments.length ? detail.comments.map((entry) => (
                  <div key={entry.id} className="rounded-md border bg-card p-3">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <Pill tone={entry.author === "agent" ? "bg-primary/15 text-primary" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"}>{entry.author}</Pill>
                      <span>{new Date(entry.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{entry.body}</p>
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
        {showRepair ? (
          <Button size="sm" variant={confirmingRepair ? "destructive" : "outline"} onClick={() => void repair()}>
            {confirmingRepair ? "Confirm repair" : "Repair"}
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={() => void archive()}>Archive</Button>
      </footer>
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

function DocumentReview({ path, source }: PluginFileOpenerProps) {
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
  useRealtime("board-changed", () => { void load(); });

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

function ThreadDocumentPanel({ params }: { params: unknown }) {
  const path = typeof params === "object" && params && "path" in params && typeof params.path === "string" ? params.path : "";
  return path ? <DocumentReview path={path} source={{ kind: "workspace", threadId: null, environmentId: null, projectId: null }} /> : <p className="text-sm text-muted-foreground">Choose an artifact from the Stelow board.</p>;
}

function OpenStelowBoardAction() {
  const navigate = useBbNavigate();
  return <button onClick={() => navigate.toPluginPanel("board", { subPath: "" })} className="rounded-md border bg-card px-2 py-1 text-xs shadow-sm hover:border-primary/50">Stelow board</button>;
}

export default definePluginApp((app) => {
  app.slots.navPanel({ id: "board", title: "Stelow", icon: "Columns", path: "board", component: (props) => { PillsyStyles(); return <BoardPanel subPath={props.subPath} />; } });
  app.slots.pendingInteraction({ id: "stelow-question", component: QuestionForm });
  app.slots.fileOpener({ id: "stelow-markdown-review", title: "Review with Stelow", extensions: ["md"], component: DocumentReview });
  app.slots.threadPanelAction({ id: "review-document", title: "Review Stelow document", icon: "FileText", component: ThreadDocumentPanel });
  app.slots.threadPanelAction({ id: "stelow-card-detail", title: "Stelow card", icon: "Columns", component: CardDrawerAdapter });
  app.slots.experimental_threadHeaderAction({ id: "open-stelow-board", title: "Stelow board", component: OpenStelowBoardAction });
});

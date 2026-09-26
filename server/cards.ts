import { isAbsolute, relative, resolve } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { resolveArtifactPath } from "../lib/artifact-manifest.mjs";
import { isClaimTerminal, errorNeedsAttention } from "../lib/card-terminal.mjs";
import { doingNowNames } from "../lib/doing-now.mjs";
import { totalScopeElapsedMs } from "../lib/scope-elapsed.mjs";
import { hasPendingReview } from "../lib/inbox-events.mjs";
import { loadCardScopes } from "./scopes.js";
import { STAGE_TO_BAND } from "../lib/workflow-vocabulary.mjs";
import { isDoneStatus } from "../lib/trackables.mjs";
import { normalizeKind } from "../lib/tracks.mjs";
import { normalizeStatus } from "./scopes.js";
import { stallCount } from "../lib/worker-ledger.mjs";
import { createCardInternal, type CardCreateInput, type CardsCreateDeps } from "./cards-create.js";
import { githubUnavailableStatus, type GithubStatus } from "./github-status.js";
import type { WorkerCard } from "./workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type Workspace = { path: string; hostId: string | null };
type ScopeSummary = {
  scopesTotal: number;
  scopesDone: number;
  tasksTotal: number;
  tasksDone: number;
  elapsedMs: number | null;
  doingNow: string[];
  executingScope: string | null;
};
type Preset = { name: string; provider_id: string; model_id: string };

export function createCardStore(bb: BbPluginApi, db: Db) {
  const getCard = (cardId: string): WorkerCard | undefined =>
    db.prepare("SELECT * FROM cards WHERE id = ?").get(cardId) as WorkerCard | undefined;

  const cardWorkspace = async (card: WorkerCard): Promise<Workspace | null> => {
    if (card.workspace_kind === "exploratory") {
      return card.workspace_path
        ? { path: card.workspace_path, hostId: card.workspace_host_id }
        : null;
    }
    const project = await bb.sdk.projects.get({ projectId: card.project_id }).catch(() => null);
    const source = project?.sources.find((entry) => entry.isDefault) ?? project?.sources[0];
    return source?.path ? { path: source.path, hostId: source.hostId } : null;
  };

  return { getCard, cardWorkspace };
}

type CardsDeps = {
  db: Db;
  bb: BbPluginApi;
  now: () => number;
  errors: { cardNotFound: string; workspaceUnavailable: string };
  idleAttentionMs: number;
  create: CardsCreateDeps;
  loadBoard: (projectId: string | null) => Promise<unknown>;
  githubStatus: () => Promise<GithubStatus>;
  githubAutomationEnabled: () => boolean;
  store: ReturnType<typeof createCardStore>;
  strategyList: (row: WorkerCard) => string[];
  getReliablePreset: (band: string, cardId: string) => Preset;
  fetchPendingQuestions: (threadId: string | null) => Promise<unknown[]>;
  openExpiredQuestionIds: (cardId: string) => string[];
};

export function createCardsServer(deps: CardsDeps) {
  const { getCard, cardWorkspace } = deps.store;
  const createInternal = createCardInternal(deps.create);
  const listCards = async ({ projectId, kind }: { projectId: string | null; kind?: string | null }) => {
    const rows = queryCards(deps.db, projectId, kind ?? null);
    const projects = await deps.bb.sdk.projects.list();
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));
    const summaries = new Map<string, ScopeSummary>();
    const cards = await Promise.all(rows.map((row) => enrichCard(
      deps,
      cardWorkspace,
      summaries,
      projectNames,
      row,
    )));
    return { cards };
  };

  const readCardFile = async ({ cardId, path }: { cardId: string; path: string }) => {
    const card = getCard(cardId);
    if (!card) return { content: null, truncated: false, error: deps.errors.cardNotFound };
    const workspace = await cardWorkspace(card);
    if (!workspace?.path) return { content: null, truncated: false, error: deps.errors.workspaceUnavailable };
    const full = readableCardPath(workspace.path, path);
    if (!full) return { content: null, truncated: false, error: "Path escapes the workspace." };
    return readTextFile(deps.bb, full);
  };

  return {
    getCard,
    cardWorkspace,
    createInternal,
    handlers: {
      board: async ({ projectId }: { projectId: string | null }) => ({
        ...(await deps.loadBoard(projectId)) as Record<string, unknown>,
        githubStatus: await deps.githubStatus().catch(() => githubUnavailableStatus()),
        githubAutomationEnabled: deps.githubAutomationEnabled(),
      }),
      listCards,
      readCardFile,
      createCard: (input: CardCreateInput) => createInternal(input),
    },
  };
}

function queryCards(
  db: Db,
  projectId: string | null,
  kind: string | null,
): WorkerCard[] {
  const where = [
    ...(projectId ? ["project_id = ?"] : []),
    ...(kind ? ["kind = ?"] : []),
  ].join(" AND ");
  const values = [projectId, kind].filter((value): value is string => value !== null);
  const statement = db.prepare(
    `SELECT * FROM cards${where ? ` WHERE ${where}` : ""} ORDER BY updated_at DESC`,
  );
  return (where ? statement.all(...values) : statement.all()) as WorkerCard[];
}

async function enrichCard(
  deps: CardsDeps,
  workspaceFor: (card: WorkerCard) => Promise<Workspace | null>,
  summaries: Map<string, ScopeSummary>,
  projectNames: Map<string, string>,
  row: WorkerCard,
) {
  const activity = await liveActivity(deps, row);
  const attention = attentionState(deps, row, activity);
  const preset = deps.getReliablePreset(STAGE_TO_BAND[row.stage] ?? "analysis", row.id);
  const summary = await scopeSummary(workspaceFor, summaries, row);
  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name ?? row.name,
    prompt: row.prompt,
    intent: row.intent,
    projectId: row.project_id,
    projectName: row.workspace_kind === "exploratory" ? "Exploratory work" : (projectNames.get(row.project_id) ?? row.project_id),
    workspaceKind: row.workspace_kind,
    workspacePath: row.workspace_path,
    environmentLabel: row.environment_label ?? null,
    kind: normalizeKind(row.kind),
    researchStrategy: row.research_strategy,
    researchStrategies: deps.strategyList(row),
    exploreStage: row.explore_stage ?? null,
    status: normalizeStatus(row.status),
    stage: row.stage,
    workerThreadId: row.worker_thread_id,
    activity,
    lastError: row.last_error,
    needsAttention: attention !== null,
    hasPendingReview: hasPendingReview(deps.db, row.id),
    presetName: preset.name,
    presetProviderId: preset.provider_id,
    presetModelId: preset.model_id,
    updatedAt: row.updated_at,
    stallCount: stallCount(deps.db, row.id),
    scopeSummary: {
      scopesTotal: summary.scopesTotal,
      scopesDone: summary.scopesDone,
      tasksTotal: summary.tasksTotal,
      tasksDone: summary.tasksDone,
      elapsedMs: summary.elapsedMs,
    },
    doingNow: summary.doingNow,
    executingScope: summary.executingScope,
  };
}

async function liveActivity(
  deps: CardsDeps,
  row: WorkerCard,
): Promise<"idle" | "running" | "awaiting-answer" | "error"> {
  let activity = row.activity as "idle" | "running" | "awaiting-answer" | "error";
  if (activity === "error" || !row.worker_thread_id) return activity;
  const pending = await deps.fetchPendingQuestions(row.worker_thread_id);
  return pending.length > 0 || deps.openExpiredQuestionIds(row.id).length > 0
    ? "awaiting-answer"
    : activity;
}

function attentionState(
  deps: CardsDeps,
  row: WorkerCard,
  activity: "idle" | "running" | "awaiting-answer" | "error",
): "question" | "error" | "idle" | null {
  if (isClaimTerminal(row.status)) {
    return activity === "awaiting-answer" ? "question" : null;
  }
  if (activity === "awaiting-answer") return "question";
  if (errorNeedsAttention(row.status, row.last_error, activity)) return "error";
  const idleAt = row.last_idle_at && row.last_idle_at > 0 ? row.last_idle_at : row.updated_at;
  return activity === "idle" && row.worker_thread_id !== null && deps.now() - idleAt >= deps.idleAttentionMs
    ? "idle"
    : null;
}

async function scopeSummary(
  workspaceFor: (card: WorkerCard) => Promise<Workspace | null>,
  summaries: Map<string, ScopeSummary>,
  row: WorkerCard,
): Promise<ScopeSummary> {
  const cached = summaries.get(row.id);
  if (cached) return cached;
  const empty = { scopesTotal: 0, scopesDone: 0, tasksTotal: 0, tasksDone: 0, elapsedMs: null, doingNow: [] as string[], executingScope: null };
  try {
    const workspace = await workspaceFor(row);
    if (!workspace?.path) return empty;
    const scopes = loadCardScopes(workspace.path, row.id);
    const summary = {
      scopesTotal: scopes.length,
      scopesDone: scopes.filter((scope) => isDoneStatus(scope.status)).length,
      tasksTotal: scopes.reduce((total, scope) => total + scope.tasks.length, 0),
      tasksDone: scopes.reduce((total, scope) => total + scope.tasks.filter((task) => isDoneStatus(task.status)).length, 0),
      elapsedMs: totalScopeElapsedMs(scopes),
      doingNow: doingNowNames(scopes),
      executingScope: scopes.find((scope) => scope.status === "in-progress")?.name ?? null,
    };
    summaries.set(row.id, summary);
    return summary;
  } catch {
    return empty;
  }
}

function readableCardPath(rootPath: string, path: string): string | null {
  const resolved = resolveArtifactPath(rootPath, path);
  if (resolved) return resolved;
  if (!isAbsolute(path) || path.split(/[\\/]+/).some((segment) => segment === "..")) return null;
  const absolute = resolve(path);
  return relative(rootPath, absolute).split(/[\\/]+/)[0] !== ".." ? absolute : null;
}

async function readTextFile(bb: BbPluginApi, path: string) {
  try {
    const file = await bb.sdk.files.read({ path });
    const content = typeof file.content === "string" ? file.content : null;
    if (content === null || content.includes("\0")) {
      return { content: null, truncated: false, error: "Not a readable text file." };
    }
    const limit = 200_000;
    return { content: content.slice(0, limit), truncated: content.length > limit, error: null };
  } catch {
    return { content: null, truncated: false, error: "Could not read the file." };
  }
}

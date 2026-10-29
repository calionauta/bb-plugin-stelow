import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { existsSync } from "node:fs";
import { isClaimTerminal, errorNeedsAttention } from "../lib/card-terminal.mjs";
import { effectiveActivity } from "../lib/card-activity.mjs";
import { defaultProjectSource, resolveCardWorkspacePath } from "../lib/card-workspace.mjs";
import { doingNowNames } from "../lib/doing-now.mjs";
import { totalScopeElapsedMs } from "../lib/scope-elapsed.mjs";
import { hasPendingReview } from "../lib/inbox-events.mjs";
import { integrationPending } from "../lib/integration-pending.mjs";
import { loadCardScopes } from "./scopes.js";
import { createCardFileHandlers } from "./card-files.js";
import { STAGE_TO_BAND } from "../lib/workflow-vocabulary.mjs";
import { isDoneStatus } from "../lib/trackables.mjs";
import { normalizeKind } from "../lib/tracks.mjs";
import { readCardStatus } from "../lib/card-status.mjs";
import { stallCount } from "../lib/worker-ledger.mjs";
import { runFailure } from "../lib/run-failure.mjs";
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
      // Kept as-is rather than routed through the rule: an exploratory card's
      // workspace is its own directory by definition and never falls back to a
      // project source, so a missing one is UNKNOWN, not "use the checkout".
      return resolveCardWorkspacePath(
        {
          workspaceKind: card.workspace_kind,
          workspacePath: card.workspace_path,
          workspaceHostId: card.workspace_host_id,
        },
        null,
      );
    }
    const project = await bb.sdk.projects.get({ projectId: card.project_id }).catch(() => null);
    // A card that recorded a linked worktree works there: the project's default
    // source is a different directory holding a different branch, and binding
    // verify/scan/done to it is the dead end that kept finished cards at audit.
    return resolveCardWorkspacePath(
      {
        workspaceKind: card.workspace_kind,
        workspacePath: card.workspace_path,
        workspaceHostId: card.workspace_host_id,
      },
      defaultProjectSource(project),
      existsSync,
    );
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
  getReliablePreset: (band: string | string[], cardId: string) => Preset;
  /** `null` is UNKNOWN (the live ask read failed); a caller must not read it
   * as "nothing is waiting". */
  fetchPendingQuestions: (threadId: string | null) => Promise<unknown[] | null>;
  openExpiredQuestionIds: (cardId: string) => string[];
};

export function createCardsServer(deps: CardsDeps) {
  const { getCard, cardWorkspace } = deps.store;
  const createInternal = createCardInternal(deps.create);
  const fileHandlers = createCardFileHandlers({ bb: deps.bb, errors: deps.errors, getCard, cardWorkspace });
  const listCards = async ({ projectId, kind }: { projectId?: string | null; kind?: string | null }) => {
    const rows = queryCards(deps.db, projectId ?? null, kind ?? null);
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
      ...fileHandlers,
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

/**
 * The two timestamps the board reads, and they are different questions.
 *
 * `updatedAt` is when the row was last written — a sync poll moves it without
 * the card having moved, so it orders the board but says nothing about how long
 * a card has waited. `lastIdleAt` is when the worker stopped producing, which
 * is what `idleDurationLabel` measures and what the host already uses to decide
 * the card needs attention at all (`attentionState` above). Both travel so the
 * tile can answer "how long has this been sitting" from the stall's own clock.
 */
function idleClock(row: WorkerCard) {
  return { updatedAt: row.updated_at, lastIdleAt: row.last_idle_at ?? null };
}

/** The name a card's context line shows; an exploratory card has no project. */
function projectLabel(projectNames: Map<string, string>, row: WorkerCard): string {
  if (row.workspace_kind === "exploratory") return "Exploratory work";
  return projectNames.get(row.project_id) ?? row.project_id;
}

/**
 * The card's derived signals, read once per row and spread into the projection.
 *
 * These travel BESIDE `activity`, never inside it. Each is a measurement or a
 * recorded fact about something other than the card's own thread state, so folding
 * any of them into `activity` would erase the last verified projection the board is
 * showing — the mistake `readMissSince` is annotated against below.
 *
 * They live here, in `server/cards.ts`, rather than in a helper module because
 * `tests/creation-contracts.test.mjs` pins the literal
 * `hasPendingReview: hasPendingReview(deps.db, row.id)` against the server source.
 * Keeping that expression verbatim keeps the pin green; moving it to a new file or
 * renaming the argument turns it red. The grouping exists for the LINE BUDGET, not
 * for taste: `enrichCard` sat at 49 of a 50-line ceiling, so the four derivations move
 * out as one spread and the new field fits. Never solve a budget by compressing a
 * comment or packing a line — both fail `quality:shape`.
 */
function cardSignals(deps: CardsDeps, row: WorkerCard) {
  return {
    hasPendingReview: hasPendingReview(deps.db, row.id),
    integrationPending: integrationPending(deps.db, row),
    stallCount: stallCount(deps.db, row.id),
    // The newest failed host run, as the tile's second failure source. It is a
    // recorded fact about a run, not about the worker thread, so it travels
    // beside `activity` like the other three.
    runFailure: runFailure(deps.db, row),
  };
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
    projectName: projectLabel(projectNames, row),
    workspaceKind: row.workspace_kind,
    workspacePath: row.workspace_path,
    environmentLabel: row.environment_label ?? null,
    kind: normalizeKind(row.kind),
    researchStrategy: row.research_strategy,
    researchStrategies: deps.strategyList(row),
    exploreStage: row.explore_stage ?? null,
    status: readCardStatus(row.status),
    stage: row.stage,
    workerThreadId: row.worker_thread_id,
    activity,
    lastError: row.last_error,
    // The host-read latch, carried raw (see lib/host-read-streak.mjs). It is a
    // measurement about the host, not a verdict about the card, which is why it
    // travels beside `activity` instead of inside it: overwriting activity
    // would erase the last verified projection the board is currently showing.
    readMissSince: row.read_miss_since ?? null,
    needsAttention: attention !== null,
    ...cardSignals(deps, row),
    presetName: preset.name,
    presetProviderId: preset.provider_id,
    presetModelId: preset.model_id,
    ...idleClock(row),
    scopeSummary: scopeTally(summary),
    doingNow: summary.doingNow,
    executingScope: summary.executingScope,
  };
}

async function liveActivity(
  deps: CardsDeps,
  row: WorkerCard,
): Promise<"idle" | "running" | "awaiting-answer" | "error" | "held"> {
  const activity = row.activity as "idle" | "running" | "awaiting-answer" | "error" | "held";
  if (activity === "error" || !row.worker_thread_id) return activity;
  const pending = await deps.fetchPendingQuestions(row.worker_thread_id);
  // An unreadable question source is UNKNOWN, not zero: `null` keeps the last
  // verified projection. A successful read of zero ENDS an await — the stored
  // column is never rewritten when its question is answered or expires, so
  // trusting it here left three cards amber with nothing to answer.
  const openQuestions = pending === null
    ? null
    : pending.length + deps.openExpiredQuestionIds(row.id).length;
  return effectiveActivity(activity, openQuestions);
}

function attentionState(
  deps: CardsDeps,
  row: WorkerCard,
  activity: "idle" | "running" | "awaiting-answer" | "error" | "held",
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

/**
 * The five counters, without the two names.
 *
 * `doingNow` and `executingScope` are computed alongside the tally because they
 * come off the same scope read, and they are separate board fields — so the
 * tally is projected rather than spread. Passing the whole summary would put
 * two extra keys inside `scopeSummary`, and a consumer reading a key the
 * contract does not declare is a consumer that breaks when the contract does.
 */
function scopeTally(summary: ScopeSummary) {
  const { scopesTotal, scopesDone, tasksTotal, tasksDone, elapsedMs } = summary;
  return { scopesTotal, scopesDone, tasksTotal, tasksDone, elapsedMs };
}

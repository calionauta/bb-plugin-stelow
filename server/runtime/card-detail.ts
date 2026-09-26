import { basename, isAbsolute, join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { enrichEntriesForDetail } from "../../lib/trackable-evidence.mjs";
import { cleanOptions } from "../../lib/question-batch.mjs";
import { parseWorkflowConfig } from "../../lib/workflow-config.mjs";
import { STAGE_TO_BAND } from "../../lib/workflow-vocabulary.mjs";
import {
  loadCardScopes,
  trackingEntryForCard,
} from "../scopes.js";
import {
  lapsedScopeClaims,
  liveClaimsForWorkspace,
} from "../../lib/card-claims.mjs";
import { workflowStateRelativeDir } from "../../lib/workflow-state-identity.mjs";
import type { ScopeXray } from "../scope-map-reader.js";
import type { WorkerCard } from "../workers-types.js";
import { readDetailArtifacts } from "./card-detail-artifacts.js";
import { assembleDetail } from "./card-detail-presentation.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type Scope = ReturnType<typeof loadCardScopes>[number];
export type Attachment = { path: string; type: "localFile" | "localImage" };
type AskOption = {
  label: string;
  description: string;
  preview: string | null;
  artifact: { path: string } | null;
};
type OptionArtifact = { artifact: { absolutePath: string | null } | null };
export type Workspace = { path: string; hostId: string | null };
export type Staleness = {
  docRevised: boolean;
  docRemoved: boolean;
  checkoutMoved: boolean;
  commitCount: number;
  touchedPaths: string[];
};
export type Question = { id: string; options: OptionArtifact[] } & Record<string, unknown>;
export type Preset = {
  id: string;
  name: string;
  provider_id: string | null;
  model_id: string | null;
};

export type CardDetailDeps = {
  db: Db;
  bb: BbPluginApi;
  now: () => number;
  idleAttentionMs: number;
  getCard: (cardId: string) => WorkerCard | undefined;
  cardWorkspace: (card: WorkerCard) => Promise<Workspace | null>;
  syncThreadState: (cardId: string) => Promise<unknown>;
  fetchPendingQuestions: (threadId: string | null) => Promise<Question[]>;
  resolveAskOptions: (card: WorkerCard, options: AskOption[]) => Promise<AskOption[]>;
  cardAttachments: (raw: string | null) => Attachment[];
  detectMentionedFiles: (
    bb: BbPluginApi,
    sourcePath: string | null,
    prompt: string,
  ) => Promise<Array<{ path: string; display: string; absolutePath: string }>>;
  workspaceRelative: (rootPath: string, path: string) => string | null;
  parseNextStages: (sourcePath: string | null, stage: string) => string[];
  getReliablePreset: (band: string, cardId: string) => Preset;
  strategyList: (card: WorkerCard) => string[];
  flowTimes: (card: WorkerCard) => { leadMs: number | null; cycleMs: number | null };
  verifiedHeadSha: (cardId: string) => string | null;
  workers: { history: (cardId: string) => Promise<unknown[]> };
  executionLifecycle: { detailList: (cardId: string) => unknown[] };
  stalenessForQuestions: (
    cardId: string,
    questions: Question[],
  ) => Promise<Map<string, Staleness>>;
  stateDir: (
    sourcePath: string,
    card: WorkerCard,
  ) => Promise<string | null>;
  scopeXray: (stateDir: string | null) => Promise<ScopeXray | null>;
  fileTimestamp: (
    file: { modifiedAtMs?: unknown } | null,
    fallback: string,
  ) => string;
  auditReceiptNote: (path: string) => string | null;
  cardNotFound: string;
};

export function createCardDetailHandler(deps: CardDetailDeps) {
  return (input: { cardId: string }) => readCardDetail(deps, input);
}

async function readCardDetail(
  deps: CardDetailDeps,
  { cardId }: { cardId: string },
) {
    const initial = deps.getCard(cardId);
    if (!initial) throw new Error(deps.cardNotFound);
    if (initial.worker_thread_id) {
      await deps.syncThreadState(cardId).catch(() => undefined);
    }
    const card = deps.getCard(cardId);
    if (!card) throw new Error(deps.cardNotFound);
    const inputs = await loadDetailInputs(deps, card, cardId);
    return assembleDetail(deps, inputs);
}

async function loadDetailInputs(
  deps: CardDetailDeps,
  card: WorkerCard,
  cardId: string,
) {
  const comments = readComments(deps.db, cardId);
  const pending = await deps.fetchPendingQuestions(card.worker_thread_id);
  const expiredQuestions = await readExpiredQuestions(deps, card);
  const workspace = await readWorkspace(deps, card);
  const mentionedFiles = await readMentionedFiles(deps, card, workspace);
  const attachments = readAttachments(deps, card, workspace);
  const fileEnvironmentId = await readFileEnvironment(deps, card, cardId);
  const scopes = loadCardScopes(workspace.path, card.id);
  const enrichedScopes = await enrichScopes(deps, card, workspace, scopes);
  const artifacts = await readDetailArtifacts(
    {
      bb: deps.bb,
      stateDir: deps.stateDir,
      fileTimestamp: deps.fileTimestamp,
      auditReceiptNote: deps.auditReceiptNote,
      workspaceRelative: deps.workspaceRelative,
    },
    card,
    workspace.path,
    workspace.hostId,
  );
  const activity = effectiveActivity(card, pending.length + expiredQuestions.length);
  const preset = deps.getReliablePreset(presetBand(card), card.id);
  const [workerHistory, questionStaleness] = await Promise.all([
    deps.workers.history(cardId),
    deps.stalenessForQuestions(cardId, [...pending, ...expiredQuestions]),
  ]);
  const stageSkips = await readStageSkips(deps, card, workspace.path);
  const scopeXray = await readScopeXray(deps, card, workspace.path);
  return {
    card, workspace, comments, pending, expired: expiredQuestions, mentionedFiles, attachments,
    fileEnvironmentId, scopes: enrichedScopes, artifacts, activity, preset,
    workerHistory, questionStaleness, stageSkips, scopeXray,
  };
}

async function readWorkspace(
  deps: CardDetailDeps,
  card: WorkerCard,
): Promise<{ projectName: string; path: string | null; hostId: string | null }> {
  const workspace = await deps.cardWorkspace(card);
  let projectName = card.project_id;
  if (card.workspace_kind === "project") {
    try {
      projectName = (await deps.bb.sdk.projects.get({ projectId: card.project_id })).name;
    } catch {
      /* project removed; keep card viewable */
    }
  }
  return {
    projectName,
    path: workspace?.path ?? null,
    hostId: workspace?.hostId ?? null,
  };
}

async function readMentionedFiles(
  deps: CardDetailDeps,
  card: WorkerCard,
  workspace: { path: string | null; hostId: string | null },
) {
  const files = await deps.detectMentionedFiles(deps.bb, workspace.path, card.prompt);
  if (!workspace.hostId) return [];
  return files.map((file) => ({
    ...file,
    hostId: workspace.hostId!,
    relPath: workspace.path
      ? deps.workspaceRelative(workspace.path, file.absolutePath) ??
        (isAbsolute(file.path) ? null : file.path)
      : null,
  }));
}

function readAttachments(
  deps: CardDetailDeps,
  card: WorkerCard,
  workspace: { path: string | null; hostId: string | null },
) {
  return deps.cardAttachments(card.attachments).map((attachment) => {
    const path = String(attachment.path ?? "");
    const absolute = workspace.path
      ? isAbsolute(path) ? path : join(workspace.path, path)
      : path;
    return {
      ...attachment,
      display: deps.workspaceRelative(workspace.path ?? "", path) ?? basename(path),
      relPath: workspace.path ? deps.workspaceRelative(workspace.path, absolute) : null,
      absolutePath: absolute,
      hostId: workspace.hostId,
    };
  });
}

async function readFileEnvironment(
  deps: CardDetailDeps,
  card: WorkerCard,
  cardId: string,
): Promise<string | null> {
  const hasRecoveryCheckout = card.workspace_kind === "exploratory" &&
    Boolean(deps.db.prepare("SELECT 1 FROM workspace_recoveries WHERE card_id = ?").get(cardId));
  const fileEnvironmentId = !hasRecoveryCheckout && card.worker_thread_id
    ? await deps.bb.sdk.threads
        .get({ threadId: card.worker_thread_id })
        .then((thread) => {
          const id = (thread as { environmentId?: unknown }).environmentId;
          return typeof id === "string" && id ? id : null;
        })
        .catch(() => null)
    : null;
  return fileEnvironmentId;
}

async function readExpiredQuestions(
  deps: CardDetailDeps,
  card: WorkerCard,
): Promise<Question[]> {
  const rows = deps.db
    .prepare("SELECT * FROM expired_questions WHERE card_id = ? AND answered = 0 ORDER BY expired_at DESC")
    .all(card.id) as Array<Record<string, unknown>>;
  const questions: Question[] = [];
  for (const row of rows) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(String(row.options));
    } catch {
      parsed = null;
    }
    questions.push({
      id: String(row.id),
      question: String(row.question),
      multiple: Boolean(row.multiple),
      kind: row.kind === "split" ? "split" : "standard",
      options: await deps.resolveAskOptions(
        card,
        cleanOptions(parsed),
      ) as Question["options"],
      expiredAt: Number(row.expired_at),
    });
  }
  return questions;
}

async function enrichScopes(
  deps: CardDetailDeps,
  card: WorkerCard,
  workspace: { path: string | null },
  scopes: Scope[],
): Promise<unknown[]> {
  const bare = scopes.map((scope) => ({
    ...scope,
    tasks: (Array.isArray(scope.tasks) ? scope.tasks : []).map((task) => ({
      ...task,
      conditions: [],
    })),
    conditions: [],
    claimed: null as boolean | null,
  }));
  if (card.kind !== "build" || !workspace.path) return bare;
  return enrichBuildScopes(deps, card, workspace.path, scopes);
}

async function enrichBuildScopes(
  deps: CardDetailDeps,
  card: WorkerCard,
  sourcePath: string,
  scopes: Scope[],
): Promise<unknown[]> {
  const entry = trackingEntryForCard(sourcePath, card.id);
  const stateRel = entry ? workflowStateRelativeDir(entry) : null;
  if (!stateRel) return enrichScopesFallback(scopes);
  const at = Date.now();
  return enrichEntriesForDetail({
    entries: scopes,
    defaultKind: "scope",
    stateRelDir: stateRel,
    ownerId: card.id,
    liveClaims: readLiveClaims(deps.db, sourcePath),
    isLapsed: (target) => isScopeLapsed(deps.db, card, sourcePath, target, at),
    readContract: (rel) => deps.bb.sdk.files
      .read({ path: join(sourcePath, rel) })
      .then((file) => file.content)
      .catch(() => null),
    nowMs: at,
  });
}

function enrichScopesFallback(scopes: Scope[]): unknown[] {
  return scopes.map((scope) => ({
    ...scope,
    tasks: scope.tasks.map((task) => ({ ...task, conditions: [] })),
    conditions: [],
    claimed: null,
  }));
}

function readLiveClaims(db: Db, sourcePath: string) {
  try {
    return liveClaimsForWorkspace(db, { workspacePath: sourcePath });
  } catch {
    return [];
  }
}

function isScopeLapsed(
  db: Db,
  card: WorkerCard,
  sourcePath: string,
  target: { id?: string; targetFiles?: unknown },
  nowMs: number,
): boolean {
  try {
    const files = Array.isArray(target.targetFiles)
      ? target.targetFiles.filter((file): file is string => typeof file === "string")
      : [];
    return lapsedScopeClaims(db, {
      cardId: card.id,
      workspacePath: sourcePath,
      scope: target.id ?? null,
      files,
      nowMs,
    });
  } catch {
    return false;
  }
}

function readComments(db: Db, cardId: string) {
  return (db
    .prepare("SELECT * FROM comments WHERE card_id = ? ORDER BY created_at ASC")
    .all(cardId) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    target: row.target as "card" | "scope" | "task",
    targetId: String(row.target_id),
    author: row.author as "user" | "agent",
    body: String(row.body),
    createdAt: Number(row.created_at),
  }));
}

function effectiveActivity(card: WorkerCard, openQuestions: number) {
  if (card.activity === "error") return "error";
  if (openQuestions > 0) return "awaiting-answer";
  return card.activity as "idle" | "running" | "awaiting-answer" | "error";
}

function presetBand(card: WorkerCard): string {
  if (card.kind === "research") return "research";
  if (card.kind === "explore") return "explore";
  return STAGE_TO_BAND[card.stage] ?? "analysis";
}

async function readStageSkips(
  deps: CardDetailDeps,
  card: WorkerCard,
  sourcePath: string | null,
) {
  const fallback = { appetite: "Lean", reviewMode: "Auto", reviewGates: [] as string[] };
  try {
    if (!sourcePath || !card.dir_hash) return fallback;
    const stateDir = await deps.stateDir(sourcePath, card).catch(() => null);
    if (!stateDir) return fallback;
    const content = await deps.bb.sdk.files
      .read({ path: join(stateDir, "state.md") })
      .then((file) => file.content)
      .catch(() => null);
    return typeof content === "string" ? parseWorkflowConfig(content) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * The approved scope map, drawn. A build card with no map, or no state dir to
 * read one from, projects null — the panel says there is no map instead of
 * rendering an empty graph that looks like an empty plan.
 */
async function readScopeXray(
  deps: CardDetailDeps,
  card: WorkerCard,
  sourcePath: string | null,
) {
  if (card.kind !== "build" || !sourcePath || !card.dir_hash) return null;
  try {
    const stateDir = await deps.stateDir(sourcePath, card).catch(() => null);
    return await deps.scopeXray(stateDir);
  } catch {
    return null;
  }
}

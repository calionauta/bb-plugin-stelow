import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { hasPendingReview } from "../../lib/inbox-events.mjs";
import { diagnoseScopeSync } from "../../lib/spec-scope-reader.mjs";
import { errorNeedsAttention, isClaimTerminal } from "../../lib/card-terminal.mjs";
import { doingNowNames } from "../../lib/doing-now.mjs";
import { totalScopeElapsedMs } from "../../lib/scope-elapsed.mjs";
import { isDoneStatus } from "../../lib/trackables.mjs";
import { normalizeKind } from "../../lib/tracks.mjs";
import { stallCount } from "../../lib/worker-ledger.mjs";
import { splitActionState } from "../../lib/split-proposal.mjs";
import { skippedStages } from "../../lib/stage-skips.mjs";
import { STAGE_SEQUENCE } from "../../lib/workflow-vocabulary.mjs";
import { isArchivedCard } from "../../lib/worker-action-policy.mjs";
import { latestSpecTech, loadCardScopes, normalizeStatus } from "../scopes.js";
import type { ScopeXray } from "../scope-map-reader.js";
import type { WorkerCard } from "../workers-types.js";
import type {
  Attachment,
  CardDetailDeps,
  Preset,
  Question,
  Staleness,
} from "./card-detail.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type Scope = ReturnType<typeof loadCardScopes>[number];

export type DetailParts = {
  card: WorkerCard;
  workspace: { projectName: string; path: string | null; hostId: string | null };
  comments: Array<{
    id: string;
    target: "card" | "scope" | "task";
    targetId: string;
    author: "user" | "agent";
    body: string;
    createdAt: number;
  }>;
  pending: Question[];
  expired: Question[];
  mentionedFiles: Array<{
    path: string;
    display: string;
    absolutePath: string;
    hostId: string;
    relPath: string | null;
  }>;
  attachments: Array<Attachment & {
    display: string;
    relPath: string | null;
    absolutePath: string;
    hostId: string | null;
  }>;
  fileEnvironmentId: string | null;
  scopes: unknown[];
  artifacts: unknown[];
  activity: "idle" | "running" | "awaiting-answer" | "error";
  preset: Preset;
  workerHistory: unknown[];
  questionStaleness: Map<string, Staleness>;
  stageSkips: {
    appetite: string;
    reviewMode: string;
    reviewGates: string[];
  };
  scopeXray: ScopeXray | null;
};

export function assembleDetail(deps: CardDetailDeps, parts: DetailParts) {
  const { card, workspace } = parts;
  const openQuestions = parts.pending.length + parts.expired.length;
  const splitOpen = deps.db
    .prepare("SELECT 1 FROM split_proposals WHERE card_id = ? AND selected IS NULL")
    .get(card.id);
  return {
    card: detailCard(deps, parts, deps.flowTimes(card)),
    attachments: parts.attachments,
    mentionedFiles: parts.mentionedFiles,
    scopes: parts.scopes,
    comments: parts.comments,
    pendingQuestions: withStaleness(parts.pending, parts.questionStaleness),
    expiredQuestions: withStaleness(parts.expired, parts.questionStaleness),
    splitAction: splitActionState({
      kind: normalizeKind(card.kind),
      stage: card.stage,
      status: normalizeStatus(card.status),
      archived: isArchivedCard(card),
      openProposal: Boolean(splitOpen),
      openQuestions,
      hasWorker: card.worker_thread_id !== null,
    }),
    stageSkips: skippedStages({
      kind: normalizeKind(card.kind),
      intent: card.intent,
      reviewMode: parts.stageSkips.reviewMode,
      reviewGates: parts.stageSkips.reviewGates,
      sequence: STAGE_SEQUENCE,
    }),
    scopeSync: detailScopeSync(card, workspace.path, parts.scopes.length),
    scopeXray: parts.scopeXray,
    artifacts: parts.artifacts,
    workerHistory: parts.workerHistory,
    executionRuns: deps.executionLifecycle.detailList(card.id),
    fileEnvironmentId: parts.fileEnvironmentId,
    nextStages: deps.parseNextStages(workspace.path, card.stage),
    githubLink: readGithubLink(deps.db, card.id),
  };
}

function withStaleness(
  questions: Question[],
  staleness: Map<string, Staleness>,
): Question[] {
  return questions.map((question) => ({
    ...question,
    staleness: staleness.get(question.id) ?? null,
  }));
}

function detailScopeSync(
  card: WorkerCard,
  sourcePath: string | null,
  syncedScopes: number,
) {
  if (card.kind !== "build" || !sourcePath) return null;
  const spec = latestSpecTech(sourcePath, card.id);
  const diagnosis = diagnoseScopeSync({
    specContent: spec?.content ?? null,
    syncedCount: syncedScopes,
  });
  return {
    state: diagnosis.state,
    syncedScopes,
    machineBlocks: diagnosis.machine,
    humanBlocks: diagnosis.human,
    specFile: spec?.file ?? null,
  };
}

function detailCard(
  deps: CardDetailDeps,
  parts: DetailParts,
  flow: { leadMs: number | null; cycleMs: number | null },
) {
  const { card, preset } = parts;
  const db = deps.db;
  const cardId = card.id;
  return {
    id: card.id,
    name: card.name,
    displayName: card.display_name ?? card.name,
    prompt: card.prompt,
    intent: card.intent,
    projectId: card.project_id,
    projectName: card.workspace_kind === "exploratory"
      ? "Exploratory work"
      : parts.workspace.projectName,
    workspaceKind: card.workspace_kind,
    workspacePath: card.workspace_path,
    environmentLabel: card.environment_label ?? null,
    kind: normalizeKind(card.kind),
    researchStrategy: card.research_strategy,
    researchStrategies: deps.strategyList(card),
    exploreStage: card.explore_stage ?? null,
    status: normalizeStatus(card.status),
    stage: card.stage,
    workerThreadId: card.worker_thread_id,
    activity: parts.activity,
    lastError: card.last_error,
    needsAttention: detailAttention(deps, card, parts.activity) !== null,
    hasPendingReview: hasPendingReview(db, cardId),
    presetName: preset.name,
    presetProviderId: preset.provider_id,
    presetModelId: preset.model_id,
    presetOverridden: hasPresetOverride(deps.db, card.id),
    updatedAt: card.updated_at,
    stallCount: stallCount(deps.db, card.id),
    scopeSummary: scopeSummary(parts.scopes),
    presetId: preset.id,
    workerPresetId: card.worker_preset_id,
    presetRestartPending: (card.preset_restart_pending ?? 0) === 1,
    leadMs: flow.leadMs,
    cycleMs: flow.cycleMs,
    doingNow: doingNowNames(parts.scopes as never[]),
    executingScope: executingScope(parts.scopes),
    verifiedHeadSha: deps.verifiedHeadSha(card.id),
  };
}

function hasPresetOverride(db: Db, cardId: string): boolean {
  return Boolean(
    db.prepare("SELECT preset_id FROM card_presets WHERE card_id = ?").get(cardId),
  );
}

function scopeSummary(scopes: unknown[]) {
  const rows = scopes as Scope[];
  return {
    scopesTotal: rows.length,
    scopesDone: rows.filter((scope) => isDoneStatus(scope.status)).length,
    tasksTotal: rows.reduce((total, scope) => total + scope.tasks.length, 0),
    tasksDone: rows.reduce(
      (total, scope) => total +
        scope.tasks.filter((task) => isDoneStatus(task.status)).length,
      0,
    ),
    elapsedMs: totalScopeElapsedMs(rows),
  };
}

function executingScope(scopes: unknown[]): string | null {
  return (scopes as Scope[]).find((scope) => scope.status === "in-progress")?.name ?? null;
}

function detailAttention(
  deps: CardDetailDeps,
  card: WorkerCard,
  effectiveActivity: string,
): "question" | "error" | "idle" | null {
  if (effectiveActivity === "awaiting-answer") return "question";
  if (errorNeedsAttention(
    card.status,
    card.last_error,
    effectiveActivity,
  )) return "error";
  const idleAt = card.last_idle_at && card.last_idle_at > 0
    ? card.last_idle_at
    : card.updated_at;
  const idle = effectiveActivity === "idle" && card.worker_thread_id !== null &&
    !isClaimTerminal(card.status) && deps.now() - idleAt >= deps.idleAttentionMs;
  return idle ? "idle" : null;
}

function readGithubLink(db: Db, cardId: string) {
  const row = db
    .prepare("SELECT repo, number, commented_at FROM github_imports WHERE card_id = ?")
    .get(cardId) as
    | { repo: string; number: number; commented_at: number | null }
    | undefined;
  return row
    ? {
        repo: row.repo,
        number: row.number,
        url: `https://github.com/${row.repo}/issues/${row.number}`,
        postedAt: row.commented_at,
      }
    : null;
}

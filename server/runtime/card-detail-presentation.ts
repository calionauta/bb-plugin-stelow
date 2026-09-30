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
import type { BlockedFileWait } from "../../lib/lock-blocked.mjs";
import type { HostHold } from "../../lib/host-hold.mjs";
import type { NativeRunRef } from "../../lib/native-run.mjs";
import { cardFileOccupancy } from "../../lib/file-occupancy.mjs";
import { isManagedWorktree } from "../../lib/shared-checkout-exposure.mjs";
import { liveClaimsForWorkspace } from "../../lib/card-claims.mjs";
import { resolveClaimCheckout } from "../../lib/card-claim-key.mjs";
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
  activity: "idle" | "running" | "awaiting-answer" | "error" | "held";
  preset: Preset;
  workerHistory: unknown[];
  questionStaleness: Map<string, Staleness>;
  stageSkips: {
    appetite: string;
    reviewMode: string;
    reviewGates: string[];
  };
  scopeXray: ScopeXray | null;
  /** The card-level file-claim wait, derived from `scopes`. Null when free. */
  fileLocks: BlockedFileWait | null;
  /** The host's hold on the card's next dispatch, with its derived sentence.
   * Null when the thread is free. Read on the detail only — see readHold. */
  hold: (HostHold & { summary: string | null }) | null;
  /** The card's live native run, with its derived sentence. Null when no run
   * owns the card. Read on the detail only — see readNativeRun. */
  nativeRun: (NativeRunRef & { summary: string | null }) | null;
};

/**
 * Who else holds this card's files, from the ledger the lock protocol already
 * keeps.
 *
 * The claim rows are the same ones `lock check` reads to refuse a conflict, so
 * this asks a question the data can already answer rather than introducing a
 * second source of truth. It is presentation, not enforcement: no decision
 * changes here, the reader simply gets to see the state before a collision
 * instead of only after one.
 *
 * Under a managed worktree the answer is always empty by construction, so it
 * says so rather than reporting "nobody" as though a scan had run.
 */
function detailFileOccupancy(
  deps: CardDetailDeps,
  card: { id: string; dir_hash?: string | null },
  workspace: { path: string | null },
) {
  const isolated = isManagedWorktree(workspace.path, card.id);
  if (isolated) return { isolated: true, lines: [] as string[], shared: 0 };
  const workspacePath = resolveClaimCheckout({ checkoutPath: workspace.path }) ?? null;
  if (!workspacePath) return { isolated: false, lines: [] as string[], shared: 0 };
  let rows: ReturnType<typeof liveClaimsForWorkspace> = [];
  try {
    rows = liveClaimsForWorkspace(deps.db, { workspacePath });
  } catch {
    // A card detail load must not fail because the ledger is mid-migration.
  }
  const answer = cardFileOccupancy(rows, { cardId: card.id, workspacePath });
  return { isolated: answer.isolated, lines: answer.lines, shared: answer.shared };
}

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
    fileOccupancy: detailFileOccupancy(deps, card, workspace),
    scopeXray: parts.scopeXray,
    nativeRun: parts.nativeRun,
    fileLocks: parts.fileLocks,
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
  return {
    ...cardIdentity(deps, card, parts),
    ...cardLifecycle(deps, card, parts),
    ...cardPreset(preset),
    ...cardProgress(deps, card, parts, flow),
  };
}

/** Who the card is. */
function cardIdentity(deps: CardDetailDeps, card: WorkerCard, parts: DetailParts) {
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
  };
}

/**
 * What the card is doing, and the two waits that explain an idle one.
 *
 * `hostHold` and `nativeRun` sit together because they answer the same
 * question — "why is this card not moving?" — from two different owners: the
 * host holding the next message, and a Workflows run working the stage. Each
 * carries its own derived sentence, so the card never writes a second version
 * of a reason `lib/host-hold.mjs` or `lib/native-run.mjs` already owns.
 */
function cardLifecycle(deps: CardDetailDeps, card: WorkerCard, parts: DetailParts) {
  const db = deps.db;
  const cardId = card.id;
  return {
    status: normalizeStatus(card.status),
    stage: card.stage,
    workerThreadId: card.worker_thread_id,
    activity: parts.activity,
    lastError: card.last_error,
    hostHold: parts.hold,
    nativeRun: parts.nativeRun,
    needsAttention: detailAttention(deps, card, parts.activity) !== null,
    hasPendingReview: hasPendingReview(db, cardId),
  };
}

/** Which preset the card's worker runs on, and whether the card overrode it. */
function cardPreset(preset: DetailParts["preset"]) {
  return {
    presetName: preset.name,
    presetProviderId: preset.provider_id,
    presetModelId: preset.model_id,
    presetId: preset.id,
  };
}

/** The counters and timings the card's own header reads. */
function cardProgress(
  deps: CardDetailDeps,
  card: WorkerCard,
  parts: DetailParts,
  flow: { leadMs: number | null; cycleMs: number | null },
) {
  return {
    presetOverridden: hasPresetOverride(deps.db, card.id),
    updatedAt: card.updated_at,
    stallCount: stallCount(deps.db, card.id),
    scopeSummary: scopeSummary(parts.scopes),
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

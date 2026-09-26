import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { questionWaitUpdates } from "../../lib/card-question-state.mjs";
import {
  lastTurnAdvancedStages,
  nextAutoContinue,
  shouldAutoContinue,
  shouldDoneNudge,
} from "../../lib/auto-continue.mjs";
import { autoContinueFields, buildContinueInput, buildContinueNudge } from "../../lib/worker-continuation.mjs";
import { healPresetStaleness } from "../../lib/worker-ledger.mjs";
import type { WorkerCard } from "../workers-types.js";
import {
  isActiveStatus,
  isIdleStatus,
  projectIdleTimestamp,
  projectNoProgress,
  projectRunningState,
  projectStateMetadata,
  projectThreadError,
  shouldSyncThread,
} from "./thread-state-projection.js";
import { agentText, sendAgentInput } from "./thread-send.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type CardUpdate = Record<string, unknown>;

type BuildThreadSyncDeps = {
  bb: BbPluginApi;
  db: Db;
  now: () => number;
  getCard: (cardId: string) => WorkerCard | undefined;
  cardWorkspace: (card: WorkerCard) => Promise<{ path: string; hostId: string | null } | null>;
  workflowStateDir: (
    bb: BbPluginApi,
    rootPath: string,
    workflowId: string,
    dirHash: string,
  ) => Promise<string | null>;
  updateCard: (cardId: string, fields: CardUpdate) => void;
  syncResearch: (card: WorkerCard) => Promise<void>;
  syncExplore: (card: WorkerCard) => Promise<void>;
  syncQuestions: (card: WorkerCard) => Promise<string[] | null>;
  applyFailed: (cardId: string, threadId: string, error: string | null) => Promise<void>;
  logComment: (cardId: string, body: string) => void;
  recordInbox: (
    card: WorkerCard,
    kind: "paused",
    message: string,
    key: string,
    at: number,
  ) => void;
  vetContinuation: (stateText: string | null) => Promise<boolean>;
  escalateIfStalled: (cardId: string) => void;
  stripMessageDirectives: (text: string | null) => string;
  interfacePick: string;
  auditDoneNudge: string;
  idleAttentionMs: number;
};

type ThreadSnapshot = {
  card: WorkerCard;
  stage: string;
  status: string;
  lastOutput: string | null;
};

export function createBuildThreadSync(deps: BuildThreadSyncDeps) {
  return async function syncThreadState(cardId: string): Promise<void> {
    const card = deps.getCard(cardId);
    if (!shouldSyncThread(card)) return;
    if (card.kind === "research") {
      await deps.syncResearch(card);
      return;
    }
    if (card.kind === "explore") {
      await deps.syncExplore(card);
      return;
    }
    try {
      const snapshot = await readBuildThread(deps, card);
      if (!snapshot) return;
      applyStateMetadata(deps, snapshot);
      if (isActiveStatus(snapshot.status) && await syncActive(deps, snapshot)) return;
      if (isIdleStatus(snapshot.status) && await syncIdle(deps, snapshot)) return;
      if (isFailed(snapshot.status)) {
        await deps.applyFailed(card.id, card.worker_thread_id!, null);
      }
    } catch (error) {
      deps.updateCard(cardId, projectThreadError(error));
    }
    deps.escalateIfStalled(cardId);
  };
}

async function readBuildThread(
  deps: BuildThreadSyncDeps,
  card: WorkerCard,
): Promise<ThreadSnapshot | null> {
  const stateBlob = await readStateBlob(deps, card);
  if (card.dir_hash && !stateBlob) {
    deps.updateCard(card.id, {
      activity: "error",
      last_error: "Workflow state ownership cannot be verified. Reseed this card; project-root state is intentionally ignored.",
    });
    return null;
  }
  const metadata = projectStateMetadata(card, stateBlob);
  applyIntent(deps, card, metadata.intent);
  const thread = await deps.bb.sdk.threads.get({ threadId: card.worker_thread_id! });
  healPreset(deps, card, thread);
  const lastOutput = await deps.bb.sdk.threads
    .output({ threadId: card.worker_thread_id! })
    .then((result) => result.output ?? null)
    .catch(() => null);
  return {
    card,
    stage: metadata.stage,
    status: String(thread.status),
    lastOutput,
  };
}

async function readStateBlob(
  deps: BuildThreadSyncDeps,
  card: WorkerCard,
): Promise<string | null> {
  const workspace = await deps.cardWorkspace(card);
  if (!workspace?.path) return null;
  const stateDir = card.dir_hash
    ? await deps.workflowStateDir(deps.bb, workspace.path, card.id, card.dir_hash)
    : null;
  if (card.dir_hash && !stateDir) return null;
  const path = stateDir ? join(stateDir, "state.md") : join(workspace.path, "state.md");
  return deps.bb.sdk.files.read({ path }).then((file) => file.content).catch(() => null);
}

function healPreset(deps: BuildThreadSyncDeps, card: WorkerCard, thread: unknown): void {
  try {
    healPresetStaleness(
      deps.db,
      card.id,
      (thread as { createdAt?: number }).createdAt,
      card.preset_restart_pending,
    );
  } catch {
    /* staleness remains best-effort */
  }
}

function applyIntent(
  deps: BuildThreadSyncDeps,
  card: WorkerCard,
  intent: string | null,
): void {
  if (!intent) return;
  deps.db.prepare("UPDATE cards SET intent = ?, updated_at = ? WHERE id = ?")
    .run(intent, deps.now(), card.id);
}

function applyStateMetadata(deps: BuildThreadSyncDeps, snapshot: ThreadSnapshot): void {
  if (snapshot.stage && snapshot.stage !== snapshot.card.stage) {
    deps.updateCard(snapshot.card.id, { stage: snapshot.stage });
  }
}

async function syncActive(
  deps: BuildThreadSyncDeps,
  snapshot: ThreadSnapshot,
): Promise<boolean> {
  const questionIds = await deps.syncQuestions(snapshot.card);
  if (questionIds === null) return true;
  deps.updateCard(
    snapshot.card.id,
    projectRunningState(snapshot.card, snapshot.stage, snapshot.lastOutput, questionIds),
  );
  return false;
}

async function syncIdle(
  deps: BuildThreadSyncDeps,
  snapshot: ThreadSnapshot,
): Promise<boolean> {
  const questionIds = await deps.syncQuestions(snapshot.card);
  if (questionIds === null) return true;
  if (questionIds.length > 0) {
    deps.updateCard(snapshot.card.id, questionWaitUpdates(snapshot.lastOutput));
    noteFreshOutput(deps, snapshot);
    return false;
  }
  const transitioning = snapshot.card.activity !== "idle";
  if (snapshot.stage === "audit") {
    const resumed = await syncAuditIdle(deps, snapshot, transitioning);
    if (!resumed) noteFreshOutput(deps, snapshot);
    return resumed;
  }
  const resumed = await resumeWithProgress(deps, snapshot, transitioning);
  if (!resumed) noteFreshOutput(deps, snapshot);
  return resumed;
}

async function syncAuditIdle(
  deps: BuildThreadSyncDeps,
  snapshot: ThreadSnapshot,
  transitioning: boolean,
): Promise<boolean> {
  if (await sendDoneNudge(deps, snapshot, transitioning)) return true;
  if (snapshot.card.status !== "completed" && transitioning) {
    deps.logComment(
      snapshot.card.id,
      "The workflow reached the audit stage, but the card completes only when the worker " +
      "runs `bb stelow done` (verified in code — build at audit, never past a pending " +
      "question). Resume continues the worker with that instruction; nothing is done until done runs.",
    );
  }
  const idleAt = snapshot.card.last_idle_at ?? deps.now();
  deps.updateCard(snapshot.card.id, {
    activity: "idle",
    last_assistant_text: snapshot.lastOutput,
    last_idle_at: idleAt,
    stage: snapshot.stage,
  });
  recordPausedAfter(
    deps,
    snapshot.card.id,
    idleAt,
    "At audit, waiting for the worker to run `bb stelow done` — resume continues it with that instruction.",
  );
  return false;
}

async function sendDoneNudge(
  deps: BuildThreadSyncDeps,
  snapshot: ThreadSnapshot,
  transitioning: boolean,
): Promise<boolean> {
  const decision = shouldDoneNudge({
    status: snapshot.status,
    cardStatus: snapshot.card.status,
    questionPending: false,
    transitioningIntoIdle: transitioning,
    autoCount: snapshot.card.auto_continue_count ?? 0,
    autoStage: snapshot.card.auto_continue_stage ?? null,
  });
  if (!decision.proceed) return false;
  const sent = await sendAgentInput(
    deps.bb,
    snapshot.card,
    [agentText(deps.auditDoneNudge)],
  );
  if (!sent) return false;
  const next = nextAutoContinue({
    stage: snapshot.stage,
    autoCount: snapshot.card.auto_continue_count ?? 0,
    autoStage: snapshot.card.auto_continue_stage ?? null,
  });
  const fields: CardUpdate = {
    activity: "running",
    last_idle_at: null,
    last_error: null,
    auto_continue_count: next.count,
    auto_continue_stage: next.stage,
  };
  if (snapshot.lastOutput != null) fields.last_assistant_text = snapshot.lastOutput;
  deps.updateCard(snapshot.card.id, fields);
  return true;
}

async function resumeWithProgress(
  deps: BuildThreadSyncDeps,
  snapshot: ThreadSnapshot,
  transitioning: boolean,
): Promise<boolean> {
  const progressed = await detectProgress(deps, snapshot);
  const decision = shouldAutoContinue({
    status: snapshot.status,
    stage: snapshot.stage,
    questionPending: false,
    transitioningIntoIdle: transitioning,
    progressed,
    autoCount: snapshot.card.auto_continue_count ?? 0,
    autoStage: snapshot.card.auto_continue_stage ?? null,
  });
  const vetoed = decision.proceed &&
    !(await deps.vetContinuation(snapshot.lastOutput == null
      ? null
      : `Stage ${snapshot.stage}. Worker output:\n${snapshot.lastOutput}`));
  if (decision.proceed && !vetoed && await resumeWorker(deps, snapshot)) return true;
  persistStandardIdle(deps, snapshot, transitioning, vetoed);
  return false;
}

async function detectProgress(
  deps: BuildThreadSyncDeps,
  snapshot: ThreadSnapshot,
): Promise<boolean> {
  if (snapshot.lastOutput != null && snapshot.lastOutput !== snapshot.card.last_assistant_text) {
    return true;
  }
  try {
    const recent = await deps.bb.sdk.threads.events.list({
      threadId: snapshot.card.worker_thread_id!,
      order: "desc",
      limit: "100",
      types: ["turn/completed", "turn/started", "item/completed"],
    });
    return lastTurnAdvancedStages(recent);
  } catch {
    return false;
  }
}

async function resumeWorker(deps: BuildThreadSyncDeps, snapshot: ThreadSnapshot): Promise<boolean> {
  const input = buildContinueInput(buildContinueNudge(deps.interfacePick), "private");
  const sent = await sendAgentInput(deps.bb, snapshot.card, input);
  if (!sent) return false;
  const next = nextAutoContinue({
    stage: snapshot.stage,
    autoCount: snapshot.card.auto_continue_count ?? 0,
    autoStage: snapshot.card.auto_continue_stage ?? null,
  });
  deps.updateCard(
    snapshot.card.id,
    autoContinueFields(next, snapshot.lastOutput),
  );
  return true;
}

function persistStandardIdle(
  deps: BuildThreadSyncDeps,
  snapshot: ThreadSnapshot,
  transitioning: boolean,
  vetoed: boolean,
): void {
  const noProgress = projectNoProgress(
    snapshot.card,
    transitioning,
    snapshot.lastOutput,
  );
  if (noProgress) {
    deps.logComment(
      snapshot.card.id,
      "Worker stopped with no new output — treated as paused. If this repeats, inspect " +
      "the thread before retrying: a silent stop usually means the worker is waiting on " +
      "input it never asked for.",
    );
  }
  const idleAt = projectIdleTimestamp(
    snapshot.card,
    transitioning,
    noProgress,
    deps.now(),
    deps.idleAttentionMs,
  );
  deps.updateCard(snapshot.card.id, {
    activity: "idle",
    last_assistant_text: snapshot.lastOutput,
    last_idle_at: idleAt,
  });
  if (idleAt == null) return;
  const suffix = vetoed
    ? " Auto-continue vetoed the resume: the last output showed no real progress."
    : "";
  recordPausedAfter(
    deps,
    snapshot.card.id,
    idleAt,
    `Idle with unfinished work — retry continues in place, restart begins fresh.${suffix}`,
  );
}

function recordPausedAfter(
  deps: BuildThreadSyncDeps,
  cardId: string,
  idleAt: number,
  message: string,
): void {
  if (!idleAt || deps.now() - idleAt < deps.idleAttentionMs) return;
  const current = deps.getCard(cardId);
  if (!current || current.status === "archived" || current.status === "completed") return;
  deps.recordInbox(current, "paused", message, `paused:${cardId}:${idleAt}`, idleAt);
}

function noteFreshOutput(deps: BuildThreadSyncDeps, snapshot: ThreadSnapshot): void {
  if (snapshot.lastOutput && snapshot.lastOutput !== snapshot.card.last_assistant_text) {
    deps.logComment(
      snapshot.card.id,
      deps.stripMessageDirectives(snapshot.lastOutput),
    );
  }
}

function isFailed(status: string): boolean {
  return status === "failed" || status === "error";
}

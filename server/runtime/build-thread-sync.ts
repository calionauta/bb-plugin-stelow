import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { questionWaitUpdates } from "../../lib/card-question-state.mjs";
import {
  lastTurnStelowCalls,
  nextAutoContinue,
  shouldAutoContinue,
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
import { syncTerminalIdle, type StelowCalls } from "./build-thread-terminal.js";
import { recordPausedAfter } from "./paused-inbox.js";
import { sendAgentInput } from "./thread-send.js";
import type { WorkflowStateResolution } from "./workflow-state.js";

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
  resolveWorkflowStateDir: (
    bb: BbPluginApi,
    rootPath: string,
    workflowId: string,
    dirHash: string,
  ) => Promise<WorkflowStateResolution>;
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
  // Operator-visible logging only — a fact about the host, never a verdict
  // about the card. `last_error` feeds `errorNeedsAttention` → `cardCanResume`,
  // so a transport fault written there renders "Resume work" for something no
  // resume can fix. These three do the counting; the streak table decides when
  // that becomes one line in the log.
  noteUnreadable: (cardId: string) => void;
  noteReadable: (cardId: string) => void;
  forgetUnreadable: (cardId: string) => void;
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
    if (!shouldSyncThread(card)) {
      deps.forgetUnreadable(cardId);
      return;
    }
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
  const state = await readStateBlob(deps, card);
  if (state.kind === "unresolved") {
    deps.updateCard(card.id, {
      activity: "error",
      last_error: "Workflow state ownership cannot be verified. Reseed this card; project-root state is intentionally ignored.",
    });
    return null;
  }
  // An unreadable workspace is nobody's verdict. Returning here leaves the
  // card on its last verified projection instead of overwriting it with a
  // failure the host caused, and the next tick (45s) asks again. Nothing is
  // written to the card — that is what keeps a transport fault out of
  // `last_error`, and therefore off the Resume button. What silence costs is
  // the trace, so the miss is counted instead: after READ_STREAK_WARN_AT
  // consecutive misses the host is named once in the plugin log. `readStateBlob`
  // has three `unreadable` returns and all of them land here, so one call site
  // counts all of them.
  if (state.kind === "unreadable") {
    deps.noteUnreadable(card.id);
    return null;
  }
  // Both remaining answers mean the host DID answer — including `unresolved`,
  // which is a verdict about the card rather than about the host.
  deps.noteReadable(card.id);
  const metadata = projectStateMetadata(card, state.blob);
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

/**
 * The card's own state file, and whether the host answered at all.
 *
 * Three answers, because the caller acts differently on each: a blob it can
 * project, "the ownership records disagree" (a verdict — the card lost its
 * state), and "nobody answered" (not a verdict — the host was busy, slow or
 * restarting, and the card is left alone).
 */
async function readStateBlob(
  deps: BuildThreadSyncDeps,
  card: WorkerCard,
): Promise<
  | { kind: "read"; blob: string }
  | { kind: "unresolved" }
  | { kind: "unreadable" }
> {
  const workspace = await deps.cardWorkspace(card);
  if (!workspace?.path) return { kind: "unreadable" };
  if (card.dir_hash) {
    const resolution = await deps.resolveWorkflowStateDir(
      deps.bb,
      workspace.path,
      card.id,
      card.dir_hash,
    );
    // `unowned` is the only verdict the lookup can reach, and it is the one
    // this caller turns into the reseed refusal. The other two answers are
    // carried through under the same names so no caller has to know that a
    // "could not be read" is not a "could not be resolved".
    if (resolution.kind === "resolved") return { kind: "read", blob: resolution.state };
    return resolution.kind === "unowned"
      ? { kind: "unresolved" }
      : { kind: "unreadable" };
  }
  const blob = await deps.bb.sdk.files
    .read({ path: join(workspace.path, "state.md") })
    .then((file) => file.content)
    .catch(() => null);
  return blob === null ? { kind: "unreadable" } : { kind: "read", blob };
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
  // One fetch, two readers: the terminal park names what the finished turn ran,
  // the resume below reads the same window for its advance scan.
  const calls = await readStelowCalls(deps, snapshot);
  if (snapshot.stage === "audit") {
    const resumed = await syncTerminalIdle(deps, snapshot, transitioning, calls);
    if (!resumed) noteFreshOutput(deps, snapshot);
    return resumed;
  }
  const resumed = await resumeWithProgress(deps, snapshot, transitioning, calls);
  if (!resumed) noteFreshOutput(deps, snapshot);
  return resumed;
}

async function resumeWithProgress(
  deps: BuildThreadSyncDeps,
  snapshot: ThreadSnapshot,
  transitioning: boolean,
  calls: StelowCalls,
): Promise<boolean> {
  const progressed = detectProgress(snapshot, calls);
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

/** The finished turn's Stelow verbs, read once per idle sync. `null` means
 * "don't know" — no thread, or a failed read — and both readers treat that as
 * nothing to report rather than as progress or as a refusal. */
async function readStelowCalls(
  deps: BuildThreadSyncDeps,
  snapshot: ThreadSnapshot,
): Promise<StelowCalls> {
  if (!snapshot.card.worker_thread_id) return null;
  try {
    const events = await deps.bb.sdk.threads.events.list({
      threadId: snapshot.card.worker_thread_id,
      order: "desc",
      limit: "100",
      types: ["turn/completed", "turn/started", "item/completed"],
    });
    return lastTurnStelowCalls(events);
  } catch {
    return null;
  }
}

function detectProgress(snapshot: ThreadSnapshot, calls: StelowCalls): boolean {
  if (snapshot.lastOutput != null && snapshot.lastOutput !== snapshot.card.last_assistant_text) {
    return true;
  }
  return calls?.advanced ?? false;
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
    last_error: null,
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

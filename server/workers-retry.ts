import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  MAX_SPAWN_RETRIES,
  claimSpawnRetry,
  isRetryableSpawnError,
  spawnRetryAttempts,
  spawnRetryDelayMs,
} from "../lib/spawn-retry.mjs";
import { truncateCause } from "../lib/worker-failure.mjs";
import type { WorkerCard, WorkerScheduler } from "./workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

type RetryDeps = {
  db: Db;
  getCard: (cardId: string) => WorkerCard | undefined;
  updateCard: (cardId: string, fields: Record<string, unknown>) => void;
  comment: (cardId: string, body: string) => void;
  publish: (cardId: string) => void;
  fresh: (
    cardId: string,
    reason: "start" | "restart",
    options?: { automatic?: boolean },
  ) => Promise<{ ok: boolean; error: string | null }>;
  failedCause: (threadId: string) => Promise<string | null>;
  scheduler?: WorkerScheduler;
  retryDelayMs?: (attempt: number) => number;
};

type RetryState = {
  deps: RetryDeps;
  pending: Map<string, string>;
  timers: Map<string, ReturnType<typeof setTimeout>>;
  scheduler: WorkerScheduler;
  retryDelayMs: (attempt: number) => number;
};

const terminal = (status: string) => ["completed", "archived", "blocked"].includes(status);

const defaultScheduler: WorkerScheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer),
};

function canRetry(state: RetryState, card: WorkerCard, cause: string): boolean {
  if (card.last_assistant_text != null) return false;
  if (!isRetryableSpawnError(cause)) return false;
  if (state.pending.get(card.id) === card.worker_thread_id) return false;
  return spawnRetryAttempts(card) < MAX_SPAWN_RETRIES;
}

function schedule(state: RetryState, cardId: string, threadId: string, cause: string): boolean {
  if (state.pending.get(cardId) === threadId) return true;
  let attempt = 0;
  try {
    attempt = claimSpawnRetry(state.deps.db, cardId, threadId, MAX_SPAWN_RETRIES);
  } catch {
    return false;
  }
  if (attempt < 1) return false;
  state.pending.set(cardId, threadId);
  // The cause that just failed, not `card.last_error` — that column still holds
  // the previous message (or nothing), which is how a specific
  // `session/set_model` refusal used to be written up as "unknown error".
  const short = truncateCause(cause) ?? "unknown error";
  state.deps.updateCard(cardId, {
    activity: "running",
    last_error: `Worker failed to start (${short}) — automatic retry ${attempt}/${MAX_SPAWN_RETRIES}.`,
  });
  const timer = state.scheduler.setTimeout(() => {
    state.timers.delete(cardId);
    void runAttempt(state, cardId, threadId, attempt);
  }, state.retryDelayMs(attempt));
  state.timers.set(cardId, timer);
  return true;
}

async function runAttempt(
  state: RetryState,
  cardId: string,
  threadId: string,
  attempt: number,
): Promise<void> {
  try {
    const card = state.deps.getCard(cardId);
    if (!card || terminal(card.status)) return;
    if (card.worker_thread_id !== threadId || card.last_assistant_text != null) return;
    const result = await state.deps.fresh(cardId, "restart", { automatic: true });
    if (result.ok) {
      state.deps.comment(cardId, `Worker start recovered automatically (attempt ${attempt}/${MAX_SPAWN_RETRIES}).`);
      state.deps.publish(cardId);
      return;
    }
    if (attempt < MAX_SPAWN_RETRIES && result.error && isRetryableSpawnError(result.error)) {
      state.pending.delete(cardId);
      schedule(state, cardId, threadId, result.error);
      return;
    }
    const cause = result.error ?? "Worker failed to start.";
    state.deps.updateCard(cardId, {
      activity: "error",
      last_error: `${cause} (automatic spawn retries exhausted)`,
    });
  } finally {
    if (state.pending.get(cardId) === threadId) state.pending.delete(cardId);
  }
}

function failureCause(
  card: WorkerCard | undefined,
  eventError: string | null,
  providerCause: string | null,
): string | null {
  // The event-derived cause is the specific one. `thread.failed` carries the
  // generic wrapper ("Command thread.start failed") while the thread's own
  // system/error detail names what the provider actually refused, so the
  // wrapper must never shadow the detail and decide retryability by itself.
  if (providerCause?.trim()) return providerCause.trim();
  if (eventError?.trim()) return eventError.trim();
  return card?.last_error?.trim() || null;
}

async function applyFailed(
  state: RetryState,
  cardId: string,
  threadId: string,
  eventError: string | null,
): Promise<void> {
  const current = state.deps.getCard(cardId);
  if (current && (terminal(current.status) || state.pending.get(cardId) === threadId)) return;
  const specific = failureCause(current, eventError, await state.deps.failedCause(threadId));
  const fresh = state.deps.getCard(cardId);
  if (!fresh || terminal(fresh.status) || state.pending.get(cardId) === threadId) return;
  if (specific && canRetry(state, fresh, specific) && schedule(state, cardId, threadId, specific)) return;
  state.deps.updateCard(cardId, specific
    ? { activity: "error", last_error: specific }
    : { activity: "error" });
}

function dispose(state: RetryState): void {
  for (const timer of state.timers.values()) state.scheduler.clearTimeout(timer);
  state.timers.clear();
}

export function createWorkerRetry(deps: RetryDeps) {
  const state: RetryState = {
    deps,
    pending: new Map(),
    timers: new Map(),
    scheduler: deps.scheduler ?? defaultScheduler,
    retryDelayMs: deps.retryDelayMs ?? spawnRetryDelayMs,
  };
  return {
    applyFailed: (cardId: string, threadId: string, eventError: string | null) =>
      applyFailed(state, cardId, threadId, eventError),
    dispose: () => dispose(state),
  };
}

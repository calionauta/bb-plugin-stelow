import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  MAX_SPAWN_RETRIES,
  claimSpawnRetry,
  isRetryableSpawnError,
  spawnRetryDelayMs,
} from "../lib/spawn-retry.mjs";
import { truncateCause } from "../lib/worker-failure.mjs";
import type { WorkerCard } from "./workers.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

type RetryDeps = {
  db: Db;
  getCard: (cardId: string) => WorkerCard | undefined;
  updateCard: (cardId: string, fields: Record<string, unknown>) => void;
  comment: (cardId: string, body: string) => void;
  publish: (cardId: string) => void;
  fresh: (cardId: string, reason: "start" | "restart") => Promise<{ ok: boolean; error: string | null }>;
  failedCause: (threadId: string) => Promise<string | null>;
};

const terminal = (status: string) => ["completed", "archived", "blocked"].includes(status);

export function createWorkerRetry(deps: RetryDeps) {
  const pending = new Map<string, string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function canRetry(card: WorkerCard, cause: string): boolean {
    if (card.last_assistant_text != null) return false;
    if (!isRetryableSpawnError(cause)) return false;
    if (pending.get(card.id) === card.worker_thread_id) return false;
    const used = card.spawn_retry_thread === card.worker_thread_id
      ? (card.spawn_retry_count ?? 0)
      : 0;
    return used < MAX_SPAWN_RETRIES;
  }

  function schedule(cardId: string, threadId: string): boolean {
    if (pending.get(cardId) === threadId) return true;
    let attempt = 0;
    try {
      attempt = claimSpawnRetry(deps.db, cardId, threadId, MAX_SPAWN_RETRIES);
    } catch {
      return false;
    }
    if (attempt < 1) return false;
    pending.set(cardId, threadId);
    const card = deps.getCard(cardId);
    const short = truncateCause(card?.last_error) ?? "unknown error";
    deps.updateCard(cardId, {
      activity: "running",
      last_error: `Worker failed to start (${short}) — automatic retry ${attempt}/${MAX_SPAWN_RETRIES}.`,
    });
    const timer = setTimeout(() => {
      timers.delete(cardId);
      void runAttempt(cardId, threadId, attempt);
    }, spawnRetryDelayMs(attempt));
    timers.set(cardId, timer);
    return true;
  }

  async function runAttempt(cardId: string, threadId: string, attempt: number): Promise<void> {
    try {
      const card = deps.getCard(cardId);
      if (!card || terminal(card.status)) return;
      if (card.worker_thread_id !== threadId) return;
      if (card.last_assistant_text != null) return;
      const result = await deps.fresh(cardId, "restart");
      if (result.ok) {
        deps.comment(cardId, `Worker start recovered automatically (attempt ${attempt}/${MAX_SPAWN_RETRIES}).`);
        deps.publish(cardId);
        return;
      }
      if (attempt < MAX_SPAWN_RETRIES && result.error && isRetryableSpawnError(result.error)) {
        pending.delete(cardId);
        schedule(cardId, threadId);
        return;
      }
      const cause = result.error ?? "Worker failed to start.";
      deps.updateCard(cardId, { activity: "error", last_error: `${cause} (automatic spawn retries exhausted)` });
    } finally {
      if (pending.get(cardId) === threadId) pending.delete(cardId);
    }
  }

  async function applyFailed(cardId: string, threadId: string, eventError: string | null): Promise<void> {
    const current = deps.getCard(cardId);
    if (current && terminal(current.status)) return;
    if (current && pending.get(cardId) === threadId) return;
    const specific = failureCause(current, eventError, await deps.failedCause(threadId));
    const fresh = deps.getCard(cardId);
    if (!fresh || terminal(fresh.status)) return;
    if (pending.get(cardId) === threadId) return;
    if (specific && canRetry(fresh, specific) && schedule(cardId, threadId)) return;
    deps.updateCard(cardId, specific
      ? { activity: "error", last_error: specific }
      : { activity: "error" });
  }

  function failureCause(
    card: WorkerCard | undefined,
    eventError: string | null,
    providerCause: string | null,
  ): string | null {
    if (eventError?.trim()) return eventError.trim();
    if (card?.last_error?.trim()) return card.last_error.trim();
    return providerCause;
  }

  function dispose(): void {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  }

  return { applyFailed, dispose };
}

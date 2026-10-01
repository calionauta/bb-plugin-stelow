import type { WorkerScheduler } from "./workers-types.js";

type RespawnScheduler = {
  schedule: (cardId: string, presetId: string) => void;
  dispose: () => void;
};

export const defaultWorkerScheduler: WorkerScheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer),
};

export function createRespawnScheduler(
  scheduler: WorkerScheduler,
  respawn: (cardId: string, presetId: string) => void,
): RespawnScheduler {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let disposed = false;
  return {
    schedule(cardId, presetId) {
      if (disposed) return;
      // One pending swap per card, and the newest one wins. `timers.set`
      // overwrote the handle without cancelling the timer it replaced, so a
      // deferred band swap followed by a direct respawn left the old timer
      // armed: it fired 10ms later and spawned a SECOND coordinator thread for
      // a card that had just been given one. The card would then own two live
      // worker threads, and the one it no longer pointed at could not be
      // stopped by anything that knew the card's id — because nothing did.
      const pending = timers.get(cardId);
      if (pending !== undefined) scheduler.clearTimeout(pending);
      const timer = scheduler.setTimeout(() => {
        timers.delete(cardId);
        if (!disposed) respawn(cardId, presetId);
      }, 10);
      timers.set(cardId, timer);
    },
    dispose() {
      disposed = true;
      for (const timer of timers.values()) scheduler.clearTimeout(timer);
      timers.clear();
    },
  };
}

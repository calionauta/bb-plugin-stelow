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

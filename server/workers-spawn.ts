import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { WorkerSpawnArgs } from "./workers-types.js";

export type WorkerThread = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["spawn"]>>;
type SpawnArgs = Parameters<BbPluginApi["sdk"]["threads"]["spawn"]>[0];

/**
 * The single SDK spawn site. Every thread — worker or disposable — is born
 * here, so a seventh spawn path fails the spawn-freshness pin before it
 * ships silently.
 */
export async function spawnThread(
  bb: BbPluginApi,
  args: SpawnArgs,
): Promise<WorkerThread> {
  return bb.sdk.threads.spawn(args);
}

export async function spawnCardWorker(
  bb: BbPluginApi,
  args: WorkerSpawnArgs,
): Promise<WorkerThread> {
  // delegation-site: worker-spawn
  return spawnThread(bb, args as SpawnArgs);
}

export async function replaceCardWorker(
  bb: BbPluginApi,
  args: WorkerSpawnArgs,
  previousThreadId: string | null,
): Promise<WorkerThread> {
  const replacement = await spawnCardWorker(bb, args);
  await stopThread(bb, previousThreadId);
  return replacement;
}

export async function stopThread(bb: BbPluginApi, threadId: string | null): Promise<void> {
  if (!threadId) return;
  try { await bb.sdk.threads.archive({ threadId }); } catch { /* already gone */ }
  try { await bb.sdk.threads.stop({ threadId }); } catch { /* already gone */ }
}

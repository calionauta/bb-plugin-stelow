import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { WorkerCard } from "./workers-types.js";

type SpawnArgs = Parameters<BbPluginApi["sdk"]["threads"]["spawn"]>[0];
export type ThreadEnvironment = SpawnArgs["environment"];

type WorkerEnvironment = {
  id?: string;
  path?: string | null;
  hostId?: string | null;
  status?: string;
};

export type PresetParams = {
  providerId: string;
  modelId: string;
  reasoningLevel: string;
  permissionMode: string;
  environmentKind: string;
  baseBranch: string | null;
  machineId: string | null;
  instructions: string;
};

export function workerEnvironment(
  source: { path: string; hostId: string },
  params: Pick<PresetParams, "environmentKind" | "machineId">,
  forceWorkspaceHost = false,
): ThreadEnvironment {
  if (forceWorkspaceHost || params.environmentKind === "project-default") {
    const hostId = forceWorkspaceHost ? source.hostId : (params.machineId ?? source.hostId);
    return { type: "host" as const, hostId, workspace: { type: "unmanaged" as const, path: source.path } };
  }
  return { type: "project-default" as const };
}

/** The slice the environment readers need. Narrower than the whole worker. */
export type EnvironmentDeps = {
  bb: BbPluginApi;
  getCard: (cardId: string) => WorkerCard | undefined;
};

export async function workerEnvironmentOf(
  deps: Pick<EnvironmentDeps, "bb">,
  card: WorkerCard,
): Promise<WorkerEnvironment | null> {
  if (!card.worker_thread_id) return null;
  try {
    const thread = await deps.bb.sdk.threads.get({ threadId: card.worker_thread_id });
    const environmentId = (thread as { environmentId?: unknown }).environmentId;
    if (typeof environmentId !== "string" || !environmentId) return null;
    const environment = await deps.bb.sdk.environments.get({ environmentId });
    return environment?.status === "ready" && environment.path ? environment : null;
  } catch {
    return null;
  }
}

/**
 * Keep the thread's existing environment when it still has one.
 *
 * A replacement worker inherits the card's environment rather than the
 * project's default, so restarting a card does not silently move it off the
 * worktree it was working in. A card whose environment is gone falls back to
 * whatever the caller chose.
 */
export async function continuingEnvironment(
  deps: Pick<EnvironmentDeps, "bb">,
  card: WorkerCard,
  fallback: ThreadEnvironment,
): Promise<ThreadEnvironment> {
  const environment = await workerEnvironmentOf(deps, card).catch(() => null);
  return environment?.id ? { type: "reuse", environmentId: environment.id } : fallback;
}

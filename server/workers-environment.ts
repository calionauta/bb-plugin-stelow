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

/**
 * The base a new worktree branches from, in the host's own vocabulary.
 *
 * `host` + `managed-worktree` carries `{kind:"named"|"default"}`, and the host
 * passes it straight to the worktree provider as its `branch` input. A preset
 * that names a base gets that base; one that does not gets the host's default,
 * which is the project's own — never a guess at a branch that does not exist.
 */
function worktreeBaseBranch(
  baseBranch: string | null | undefined,
): { kind: "named"; name: string } | { kind: "default" } {
  const named = typeof baseBranch === "string" ? baseBranch.trim() : "";
  return named ? { kind: "named" as const, name: named } : { kind: "default" as const };
}

/**
 * The environment a preset asks its worker for.
 *
 * The single owner of that answer, because every spawn path routes through it
 * (creation, respawn, reseed, drafting, CLI review) and a second derivation is
 * how a card ends up isolated on create and back in the shared checkout on the
 * next restart.
 *
 * `new-worktree` ASKS the host for a managed worktree and gets one: bb
 * provisions it under `sw-<cardId>` on its own branch and supplies the machine
 * itself, so isolation needs no machine selection and no provider id from us.
 * It used to resolve to `{type:"project-default"}` — the shared project
 * checkout — which is why a card on a New-worktree preset still shared one
 * working tree with every other card, while `describeCardEnvironment` and the
 * shared-checkout report both spoke as though isolation existed.
 *
 * Anything this build does not recognise stays on `project-default`: an unknown
 * environment kind must not silently start provisioning worktrees.
 */
export function workerEnvironment(
  source: { path: string; hostId: string },
  params: Pick<PresetParams, "environmentKind" | "machineId"> & { baseBranch?: string | null },
  forceWorkspaceHost = false,
): ThreadEnvironment {
  if (params.environmentKind === "new-worktree" && !forceWorkspaceHost) {
    return {
      type: "host" as const,
      hostId: params.machineId ?? source.hostId,
      workspace: { type: "managed-worktree" as const, baseBranch: worktreeBaseBranch(params.baseBranch) },
    };
  }
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

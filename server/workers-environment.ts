import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { recordedWorkspace } from "../lib/worker-workspace.mjs";
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

/**
 * Remember the checkout a freshly spawned worker actually got.
 *
 * A card on a `new-worktree` preset works in a managed checkout, and every gate
 * that matters — the host test run, the security scan, `done` — must bind to
 * THAT directory. Nothing recorded it, so `cardWorkspace` answered the project's
 * shared source and the gates ran against a tree the card never wrote; the
 * refusal names the symptom and no card action clears it.
 *
 * Best-effort and post-spawn: a failure here must never turn a started worker
 * into a failed start. `recordedWorkspace` refuses to guess, so an unknown
 * environment or one that resolves to the project writes nothing.
 */
export async function recordWorkerWorkspace(
  deps: {
    bb: BbPluginApi;
    getCard: (cardId: string) => WorkerCard | undefined;
    updateCard: (cardId: string, fields: Record<string, unknown>) => void;
  },
  cardId: string,
  attempts = 3,
): Promise<void> {
  const card = deps.getCard(cardId);
  if (!card?.worker_thread_id) return;
  // A fresh environment may still be provisioning when the spawn returns, and
  // `workerEnvironmentOf` only answers for a READY one. Three short tries cover
  // the gap without turning the spawn into a wait; a card that misses all three
  // is recorded on its next restart.
  let environment = await workerEnvironmentOf(deps, card).catch(() => null);
  for (let attempt = 1; attempt < attempts && !environment?.path; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    environment = await workerEnvironmentOf(deps, card).catch(() => null);
  }
  if (!environment?.path) return;
  const project = await deps.bb.sdk.projects
    .get({ projectId: card.project_id })
    .catch(() => null);
  const source = project?.sources.find((entry) => entry.isDefault) ?? project?.sources[0];
  const recorded = recordedWorkspace(environment.path, source?.path ?? null);
  if (!recorded) return;
  deps.updateCard(cardId, { ...recorded, workspace_host_id: environment.hostId ?? null });
}

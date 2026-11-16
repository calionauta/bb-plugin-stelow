/**
 * The produced artifacts, registered by the HOST.
 *
 * The `artifacts:` manifest had two writers and two formats: the helper
 * wrote it in the state front-matter, and a host prompt told the worker to
 * append a block of its own. The worker's append landed AFTER the
 * front-matter — a SECOND `artifacts:` key, which is a duplicate key in
 * YAML — and the helper never saw it, so the next advance dropped the
 * worker's artifact from the card with no error anywhere.
 *
 * The worker now only SAYS what it produced, with a chip. The host reads
 * the chips and asks the helper to register each one: the helper is the
 * only writer, so the manifest has one shape and one owner, and the worker
 * never edits YAML.
 */
import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { WorkerCard } from "../workers-types.js";

export type ProducedArtifact = { path: string; label: string };

export type HelperResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

/** The runtime the registration runs against. */
export type RegistrationCore = {
  runHelper: (
    args: string[],
    cwd: string,
    stateDir?: string,
  ) => Promise<HelperResult>;
  cardWorkspace: (card: WorkerCard) => Promise<{ path: string } | null>;
  resolveWorkflowStateDir: (
    bb: BbPluginApi,
    rootPath: string,
    workflowId: string,
    dirHash: string,
  ) => Promise<{ kind: string; path?: string }>;
  bb: BbPluginApi;
};

export type RegistrationDeps = {
  runHelper: (
    args: string[],
    cwd: string,
    stateDir?: string,
  ) => Promise<HelperResult>;
  cardWorkspace: (card: WorkerCard) => Promise<{ path: string } | null>;
  resolveStateDir: (
    card: WorkerCard,
    rootPath: string,
  ) => Promise<string | null>;
};

/**
 * The artifacts a worker said it produced.
 *
 * The chip is `::stelow-artifact{path="<relative path>" display="<label>"}`.
 * A chip with no path says nothing, and the same path twice says one
 * artifact — the card shows one card per file, not one per mention.
 */
export function parseArtifactChips(output: string | null): ProducedArtifact[] {
  const chips = [...String(output ?? "").matchAll(/::stelow-artifact\{([^}]*)\}/g)];
  const found: ProducedArtifact[] = [];
  for (const chip of chips) {
    const path = /\bpath="([^"]*)"/.exec(chip[1])?.[1]?.trim();
    if (!path) continue;
    const label =
      /\bdisplay="([^"]*)"/.exec(chip[1])?.[1]?.trim() ||
      path.split("/").pop() ||
      path;
    if (found.some((entry) => entry.path === path)) continue;
    found.push({ path, label });
  }
  return found;
}

/**
 * Register what the worker produced.
 *
 * Returns how many entries the helper accepted. A failure is not fatal:
 * the card still completes, and the host's own artifact listing still finds
 * the files — registration is what makes them show up as DELIVERABLES
 * rather than as unregistered leftovers.
 */
export async function registerProducedArtifacts(
  core: RegistrationCore,
  card: WorkerCard,
  stage: string,
  output: string | null,
): Promise<number> {
  const chips = parseArtifactChips(output);
  if (chips.length === 0) return 0;
  const deps = registrationDeps(core);
  const workspace = await deps.cardWorkspace(card).catch(() => null);
  if (!workspace) return 0;
  const stateDir = await deps.resolveStateDir(card, workspace.path).catch(() => null);
  if (!stateDir) return 0;
  let registered = 0;
  for (const chip of chips) {
    const result = await deps
      .runHelper(
        [
          "artifacts",
          "add",
          "--stage",
          stage,
          "--path",
          chip.path,
          "--label",
          chip.label,
        ],
        workspace.path,
        stateDir,
      )
      .catch(() => null);
    if (result && result.code === 0) registered += 1;
  }
  return registered;
}

/**
 * Register the audit.md, through the helper.
 *
 * The audit is written AFTER the last advance, so the helper's file walk
 * never saw it — the build worker used to register it by hand, which made
 * the worker a second writer of the manifest. The host registers it.
 *
 * Best effort: a card that cannot register its audit still completes, and
 * the host's own artifact listing still finds the file. What registration
 * buys is the audit rendering as a DELIVERABLE on the card rather than as
 * an unregistered leftover.
 */
export async function registerAuditArtifact(
  deps: Pick<RegistrationDeps, "runHelper">,
  projectPath: string,
  stateDir: string,
): Promise<void> {
  await deps
    .runHelper(
      ["artifacts", "add", "--stage", "audit", "--path", join(stateDir, "audit.md")],
      projectPath,
      stateDir,
    )
    .catch(() => null);
}

/**
 * The registration deps, bound to the runtime.
 *
 * The state dir is resolved the way the rest of the host resolves it: the
 * card's own workflow entry owns it, and nobody else's.
 */
function registrationDeps(core: RegistrationCore): RegistrationDeps {
  return {
    runHelper: core.runHelper,
    cardWorkspace: core.cardWorkspace,
    resolveStateDir: async (card, rootPath) => {
      if (!card.dir_hash) return null;
      const resolution = await core.resolveWorkflowStateDir(
        core.bb,
        rootPath,
        card.id,
        card.dir_hash,
      );
      return resolution.kind === "resolved" ? (resolution.path ?? null) : null;
    },
  };
}

/**
 * The per-card reads every surface shares: which checkout a card owns, which
 * stage it is in, what its artifact parent is, and whether the documents it
 * registered are deep enough or covered by a passing review.
 *
 * These are deliberately shared rather than re-derived per surface. A managed
 * worktree must never fall back to the project's source checkout by accident,
 * and state.md is the stage's own record — reading the DB mirror instead would
 * let preview, diff, and the done gates disagree about where a card is.
 */
import { dirname } from "node:path";
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import {
  parseArtifactManifest,
  resolveArtifactPath,
} from "../../lib/artifact-manifest.mjs";
import { buildDocDepths } from "../../lib/artifact-validation.mjs";
import { reviewCoversFingerprint } from "../../lib/review-verdict.mjs";
import { parseWorkflowConfig } from "../../lib/workflow-config.mjs";
import { requiredForStage } from "../../lib/question-contracts.mjs";
import { publicationSource } from "../../lib/vcs-publication.mjs";
import { ROUNDS_DIR } from "../../lib/research-rounds.mjs";
import type { WorkerCard } from "../workers-types.js";
import { workspaceRelative } from "./card-files.js";
import { array, record, text } from "./values.js";
import { join } from "./root-paths.js";
import { workflowStateDir } from "./workflow-state.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export type PreviewEnvironment = {
  id?: string | null;
  path?: string | null;
  hostId?: string | null;
  isWorktree?: boolean;
  workspaceProvisionType?: string | null;
  branchName?: string | null;
} | null;

export type CardCheckout = {
  path: string;
  hostId: string | null;
  environmentId: string | null;
  environment: PreviewEnvironment;
  source: string;
};

export type CardSeamsDeps = {
  bb: BbPluginApi;
  db: Db;
  getCard: (cardId: string) => WorkerCard | undefined;
  cardWorkspace: (
    card: WorkerCard,
  ) => Promise<{ path: string; hostId: string | null } | null>;
  workerEnvironmentOf: (
    card: WorkerCard,
  ) => Promise<PreviewEnvironment>;
};

async function stateDirFor(
  deps: CardSeamsDeps,
card: WorkerCard): Promise<string | null> {
  if (!card.dir_hash) return null;
  const workspace = await deps.cardWorkspace(card).catch(() => null);
  if (!workspace?.path) return null;
  return workflowStateDir(
    deps.bb,
    workspace.path,
    card.id,
    card.dir_hash,
  ).catch(() => null);
}
async function cardCheckout(
  deps: CardSeamsDeps,
card: WorkerCard): Promise<CardCheckout | null> {
  // A legacy exploratory card may have a user-confirmed, evidence-backed
  // external checkout. Prefer that audited target for read-only diff and
  // preview surfaces; publication still requires a live BB environment.
  if (card.workspace_kind === "exploratory") {
    const recovery = deps.db
      .prepare(
        "SELECT source_path FROM workspace_recoveries WHERE card_id = ?",
      )
      .get(card.id) as { source_path: string } | undefined;
    if (recovery?.source_path) {
      return {
        path: recovery.source_path,
        hostId: card.workspace_host_id,
        environmentId: null,
        environment: null,
        source: "Recovered project checkout",
      };
    }
  }
  const environment = await deps.workerEnvironmentOf(card);
  if (environment?.path) {
    return {
      path: environment.path,
      hostId: environment.hostId ?? null,
      environmentId: environment.id ?? null,
      environment,
      source: publicationSource(environment),
    };
  }
  const workspace = await deps.cardWorkspace(card);
  return workspace?.path
    ? {
        path: workspace.path,
        hostId: workspace.hostId,
        environmentId: null,
        environment: null,
        source: "Project source",
      }
    : null;
}
async function cardStageSlug(
  deps: CardSeamsDeps,
card: WorkerCard): Promise<string | null> {
  try {
    const dir = await stateDirFor(deps, card);
    const blob = dir
      ? await deps.bb.sdk.files
          .read({ path: join(dir, "state.md") })
          .then((file) => file.content)
          .catch(() => null)
      : null;
    const stage = blob
      ? text(blob.match(/current_stage:\s*(\S+)/m)?.[1])
      : "";
    return stage || (card.stage ?? null);
  } catch {
    return card.stage ?? null;
  }
}
async function askContractChecklist(
  deps: CardSeamsDeps,
  cardId: string,
): Promise<Array<{ id: string; kind: string }> | null> {
  try {
    return await checklistFor(deps, cardId);
  } catch {
    return null;
  }
}
async function ensureArtifactParent(
  deps: CardSeamsDeps,
  workspacePath: string,
  relPath: string,
): Promise<void> {
  try {
    const full = resolveArtifactPath(workspacePath, relPath);
    if (!full) return;
    await deps.bb.sdk.files.mkdir({
      path: dirname(full),
      rootPath: workspacePath,
      recursive: true,
    });
  } catch {
    /* workers can still create parents with their native writer */
  }
}
async function buildDocDepthsForCard(
  deps: CardSeamsDeps,
  card: WorkerCard,
): Promise<Array<{ path: string; label: string; failures: string[] }>> {
  const workspace = await deps.cardWorkspace(card).catch(() => null);
  if (!workspace?.path || !card.dir_hash) return [];
  const stateDir = await workflowStateDir(
    deps.bb,
    workspace.path,
    card.id,
    card.dir_hash,
  ).catch(() => null);
  if (!stateDir) return [];
  const stateBlob = await deps.bb.sdk.files
    .read({ path: join(stateDir, "state.md") })
    .then((f) => f.content)
    .catch(() => null);
  if (!stateBlob) return [];
  const contents = new Map<string, string | null>();
  for (const fields of parseArtifactManifest(stateBlob)) {
    if (typeof fields.path !== "string" || !fields.path.endsWith(".md")) {
      continue;
    }
    const full = resolveArtifactPath(workspace.path, fields.path);
    contents.set(
      fields.path,
      full
        ? await deps.bb.sdk.files
            .read({ path: full })
            .then((f) => f.content)
            .catch(() => null)
        : null,
    );
  }
  return buildDocDepths(stateBlob, (path) => contents.get(path) ?? null);
}
async function passingReviewCovers(
  deps: CardSeamsDeps,
  card: WorkerCard,
  fingerprint: string | null,
): Promise<boolean> {
  if (!fingerprint) return false;
  const stateDir = await stateDirFor(deps, card);
  if (!stateDir) return false;
  try {
    const listed = await deps.bb.sdk.files.listPaths({
      path: join(stateDir, "reviews"),
      includeFiles: true,
      includeDirectories: false,
    });
    const paths = array(record(listed).paths)
      .map((entry) => text(record(entry).path))
      .filter((path) => path.endsWith(".md"))
      .sort()
      .reverse();
    const files: Array<{ name: string; content: string | null }> = [];
    for (const path of paths) {
      const content = await deps.bb.sdk.files
        .read({ path })
        .then((f) => f.content)
        .catch(() => null);
      files.push({ name: path.split("/").pop() ?? path, content });
    }
    return reviewCoversFingerprint(files, fingerprint);
  } catch {
    return false;
  }
}

export function createCardSeams(deps: CardSeamsDeps) {
  return {
    stateDirFor: stateDirFor.bind(null, deps),
    cardCheckout: cardCheckout.bind(null, deps),
    cardStageSlug: cardStageSlug.bind(null, deps),
    askContractChecklist: askContractChecklist.bind(null, deps),
    ensureArtifactParent: ensureArtifactParent.bind(null, deps),
    buildDocDepthsForCard: buildDocDepthsForCard.bind(null, deps),
    passingReviewCovers: passingReviewCovers.bind(null, deps),
  };
}

/**
 * Workspace-relative round path inside the state dir's rounds/. Pure, so the
 * spawn seams that must exist before the workers do can still hand it over.
 */
export function roundRelPath(
  stateDirAbs: string,
  workspacePath: string,
  base: string,
): string {
  return (
    workspaceRelative(
      workspacePath,
      join(stateDirAbs, `${ROUNDS_DIR}/${base}`),
    ) ?? `${ROUNDS_DIR}/${base}`
  );
}

/** The checklist a card's stage requires, read through its own state file. */
async function checklistFor(
  deps: CardSeamsDeps,
  cardId: string,
): Promise<Array<{ id: string; kind: string }> | null> {
  const card = deps.getCard(cardId);
  if (!card) return null;
  const workspace = await deps.cardWorkspace(card);
  if (!workspace?.path) return null;
  const stateDir = card.dir_hash
    ? await workflowStateDir(deps.bb, workspace.path, card.id, card.dir_hash)
    : null;
  if (!stateDir) return null;
  const stateFile = await deps.bb.sdk.files
    .read({ path: join(stateDir, "state.md") })
    .catch(() => null);
  const state = typeof stateFile?.content === "string" ? stateFile.content : null;
  if (!state) return null;
  const { appetite, reviewMode, reviewGates } = parseWorkflowConfig(state, {
    strict: true,
  });
  if (!appetite || (!reviewMode && !reviewGates)) return null;
  const stage = text(state.match(/^current_stage:\s*(\S+)/m)?.[1]);
  if (!stage) return null;
  return requiredForStage({
    stage,
    appetite,
    reviewMode: reviewGates ?? reviewMode ?? [],
  });
}

export type CardSeams = ReturnType<typeof createCardSeams>;

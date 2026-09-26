import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { findAdoptableProject, normalizePromoteName } from "../../lib/promote-card.mjs";
import { STAGE_TO_BAND } from "../../lib/workflow-vocabulary.mjs";
import type { PresetRow } from "../presets.js";
import type { WorkerCard } from "../workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type Workspace = { path: string; hostId: string | null };
type Recovery = { kind: string };
type PromotionDeps = {
  db: Db;
  bb: BbPluginApi;
  now: () => number;
  getCard: (cardId: string) => WorkerCard | undefined;
  cardWorkspace: (card: WorkerCard) => Promise<Workspace | null>;
  recoverySnapshot: (card: WorkerCard) => Promise<Recovery>;
  getReliablePreset: (band: string, cardId: string) => PresetRow;
  getCardPreset: (cardId: string) => PresetRow;
  respawn: (
    cardId: string,
    presetId: string,
    reason: string,
    options: { previousProjectId: string },
  ) => Promise<{ ok: boolean; threadId?: string; error?: string }>;
  logComment: (cardId: string, body: string) => void;
  errors: {
    cardNotFound: string;
    cardArchived: string;
    workspaceUnavailable: string;
  };
};

export function createCardPromotion(deps: PromotionDeps) {
  return ({ cardId, name }: { cardId: string; name: string }) =>
    promoteCard(deps, cardId, name);
}

async function promoteCard(deps: PromotionDeps, cardId: string, name: string) {
  const card = deps.getCard(cardId);
  if (!card) return promotionFailure(deps.errors.cardNotFound);
  if (card.workspace_kind !== "exploratory") {
    return promotionFailure(await existingProjectRefusal(deps, card));
  }
  if (card.status === "archived") return promotionFailure(deps.errors.cardArchived);
  const workspace = await deps.cardWorkspace(card);
  if (!workspace?.path) return promotionFailure(deps.errors.workspaceUnavailable);
  if (!workspace.hostId) {
    return promotionFailure("Workspace host is unavailable.");
  }
  const source = { path: workspace.path, hostId: workspace.hostId };
  const recovery = await deps.recoverySnapshot(card);
  if (recovery.kind !== "promote") return promotionFailure(recoveryRefusal(recovery.kind));
  const projectName = normalizePromoteName(name, card.display_name ?? card.name);
  const target = await targetProjectId(deps, projectName, source);
  if (typeof target === "object") return promotionFailure(target.error);
  const projectId = target;
  bindProject(deps, cardId, projectId);
  const handoff = await handoffProject(deps, card);
  if (!handoff.ok || !handoff.threadId) return rollbackPromotion(deps, card, source, handoff);
  completePromotion(deps, cardId, projectName);
  return { ok: true, projectId, projectName, threadId: handoff.threadId, error: null };
}

function promotionFailure(error: string) {
  return { ok: false, projectId: null, projectName: null, threadId: null, error };
}

async function existingProjectRefusal(deps: PromotionDeps, card: WorkerCard) {
  const projectName = await deps.bb.sdk.projects
    .get({ projectId: card.project_id })
    .then((project) => project.name)
    .catch(() => card.project_id);
  return `This card already lives in project "${projectName}" — nothing to promote.`;
}

function recoveryRefusal(kind: string): string {
  const refusals: Record<string, string> = {
    attached: "This card already has a reviewed checkout attached. Use that checkout to review, test, and commit.",
    "external-project":
      "This card has an evidenced external project checkout. " +
      "Review and attach that checkout instead of promoting the empty exploratory folder.",
    ambiguous: "Several registered checkouts match the worker's report. Review them in Workspace recovery and attach the right one.",
    "documents-only": "This exploratory workspace holds workflow documents only — there is no source material to turn into a project.",
  };
  return refusals[kind] ?? "Review this card in Workspace recovery before promoting it.";
}

async function targetProjectId(
  deps: PromotionDeps,
  projectName: string,
  workspace: Workspace & { hostId: string },
): Promise<string | { error: string }> {
  const projects = await deps.bb.sdk.projects.list().catch(() => []);
  const decision = findAdoptableProject(projects, projectName, workspace.path);
  if (decision.action === "conflict") {
    return { error: `A project named "${projectName}" already exists — pick another name.` };
  }
  if (decision.action === "adopt" && decision.project) return decision.project.id;
  try {
    const project = await deps.bb.sdk.projects.create({
      name: projectName,
      source: { type: "local_path", hostId: workspace.hostId, path: workspace.path },
    });
    return project.id;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not create the project." };
  }
}

function bindProject(deps: PromotionDeps, cardId: string, projectId: string): void {
  deps.db.prepare(
    "UPDATE cards SET project_id = ?, workspace_kind = 'project', workspace_path = NULL, workspace_host_id = NULL, updated_at = ? WHERE id = ?",
  ).run(projectId, deps.now(), cardId);
}

async function handoffProject(
  deps: PromotionDeps,
  card: WorkerCard,
) {
  const preset = card.kind === "build"
    ? deps.getReliablePreset(STAGE_TO_BAND[card.stage] ?? "analysis", card.id)
    : deps.getCardPreset(card.id);
  return deps.respawn(card.id, preset.id, "project-promotion", {
    previousProjectId: card.project_id,
  });
}

function rollbackPromotion(
  deps: PromotionDeps,
  card: WorkerCard,
  workspace: Workspace & { hostId: string },
  handoff: { error?: string },
) {
  const rollbackSql =
    "UPDATE cards SET project_id = ?, workspace_kind = 'exploratory', " +
    "workspace_path = ?, workspace_host_id = ?, activity = ?, last_error = ?, " +
    "updated_at = ? WHERE id = ?";
  deps.db.prepare(rollbackSql).run(
    card.project_id,
    workspace.path,
    workspace.hostId,
    card.activity,
    card.last_error,
    deps.now(),
    card.id,
  );
  publishPromotion(deps, card.id);
  return promotionFailure(
    `Could not start the project worker. The card remains exploratory; its existing worker is still active. ${handoff.error ?? "Try again."}`,
  );
}

function completePromotion(
  deps: PromotionDeps,
  cardId: string,
  projectName: string,
) {
  const comment =
    `Moved into project "${projectName}". Files stayed in place; ` +
    "a new project worker continues from the current stage. " +
    "The exploratory worker is archived in Worker history.";
  deps.logComment(cardId, comment);
  publishPromotion(deps, cardId);
}

function publishPromotion(deps: PromotionDeps, cardId: string): void {
  deps.bb.realtime.publish("card-state", { cardId });
  deps.bb.realtime.publish("board-changed", { cardId });
}

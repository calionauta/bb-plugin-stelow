import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { STAGE_TO_BAND } from "../../lib/workflow-vocabulary.mjs";
import { isArchivedCard } from "../../lib/worker-action-policy.mjs";
import type { WorkerCard } from "../workers-types.js";
import type { PresetRow } from "../presets.js";

const GATES = {
  gate: { artifact: "product-spec", receipt: "gate-approved.md" },
  "int-gate": { artifact: "interfaces", receipt: "int-gate-approved.md" },
  "plan-gate": { artifact: "tech-plan", receipt: "plan-gate-approved.md" },
  "diff-gate": { artifact: "other", receipt: "diff-gate-approved.md" },
} as const;

type Gate = keyof typeof GATES;
type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type Workspace = { path: string; hostId: string | null };
type Workflow = {
  id: string;
  name: string;
  dirHash?: string | null;
  artifacts: Array<{ kind: string }>;
};
type Board = {
  rootPath: string | null;
  workflows: Workflow[];
  error: string | null;
};

type GateDeps = {
  db: Db;
  bb: BbPluginApi;
  getCard: (cardId: string) => WorkerCard | undefined;
  cardWorkspace: (card: WorkerCard) => Promise<Workspace | null>;
  boardFromRoot: (
    bb: BbPluginApi,
    rootPath: string,
    dirHash?: string | null,
  ) => Promise<Board>;
  loadBoard: (bb: BbPluginApi, projectId: string | null) => Promise<Board>;
};

export function createGateHandlers(deps: GateDeps) {
  return {
    approveGate: ({ projectId, workflowId, gate }: {
      projectId: string | null;
      workflowId: string;
      gate: Gate;
    }) => approveGate(deps, projectId, workflowId, gate),
  };
}

async function approveGate(
  deps: GateDeps,
  projectId: string | null,
  workflowId: string,
  gate: Gate,
) {
  const board = await boardForWorkflow(deps, projectId, workflowId);
  const workflow = board.workflows.find((item) => item.id === workflowId);
  if (!board.rootPath || !workflow?.dirHash) return gateMetadataFailure();
  const ownedWorkflow: Workflow & { dirHash: string } = {
    ...workflow,
    dirHash: workflow.dirHash,
  };
  const spec = GATES[gate];
  if (gate !== "diff-gate" && !workflow.artifacts.some((item) => item.kind === spec.artifact)) {
    return artifactFailure();
  }
  const receiptPath = `.stelow/approvals/${workflow.dirHash}/${spec.receipt}`;
  const conflicted = await writeApproval(
    deps,
    board.rootPath,
    ownedWorkflow,
    gate,
    receiptPath,
  );
  if (!conflicted) {
    deps.bb.realtime.publish("board-changed", { workflowId, gate });
  }
  return { approved: true, receiptPath, error: null };
}

async function boardForWorkflow(
  deps: GateDeps,
  projectId: string | null,
  workflowId: string,
): Promise<Board> {
  const owner = deps.db
    .prepare("SELECT * FROM cards WHERE dir_hash = ?")
    .get(workflowId) as WorkerCard | undefined;
  if (!owner) return deps.loadBoard(deps.bb, projectId);
  const workspace = await deps.cardWorkspace(owner);
  if (!workspace?.path) {
    return { rootPath: null, workflows: [], error: "Workspace is unavailable for this card." };
  }
  return deps.boardFromRoot(deps.bb, workspace.path, owner.dir_hash);
}

function gateMetadataFailure() {
  return {
    approved: false,
    receiptPath: null,
    error: "Workflow directory metadata is unavailable.",
  };
}

function artifactFailure() {
  return {
    approved: false,
    receiptPath: null,
    error: "The gate artifact does not exist yet.",
  };
}

async function writeApproval(
  deps: GateDeps,
  rootPath: string,
  workflow: Workflow & { dirHash: string },
  gate: Gate,
  receiptPath: string,
): Promise<boolean> {
  const directory = joinPath(rootPath, `.stelow/approvals/${workflow.dirHash}`);
  await deps.bb.sdk.files.mkdir({ path: directory, rootPath, recursive: true });
  const approvedAt = new Date().toISOString();
  const result = await deps.bb.sdk.files.write({
    path: joinPath(rootPath, receiptPath),
    rootPath,
    expectedSha256: null,
    content: `---\napproved: true\napproved_at: ${approvedAt}\napproved_via: bb-plugin-stelow\ngate: ${gate}\nworkflow: ${workflow.name}\n---\n`,
  });
  return result.outcome === "conflict";
}

function joinPath(root: string, relative: string): string {
  return `${root.replace(/\/$/, "")}/${relative}`;
}

type AdvanceDeps = {
  getCard: (cardId: string) => WorkerCard | undefined;
  cardWorkspace: (card: WorkerCard) => Promise<Workspace | null>;
  workflowStateDir: (
    rootPath: string,
    card: WorkerCard,
  ) => Promise<string | null>;
  ensureArtifacts: (
    rootPath: string,
    stateDir: string | null,
    requireOwnedState: boolean,
  ) => Promise<string | null>;
  questionGate: (card: WorkerCard, stateDir: string | null) => Promise<string | null>;
  runHelper: (
    args: string[],
    rootPath: string,
    stateDir?: string,
  ) => Promise<{ code: number | null; stdout: string; stderr: string }>;
  getReliablePreset: (band: string, cardId: string) => PresetRow | null;
  getCardPreset: (cardId: string) => PresetRow;
  respawn: (cardId: string, presetId: string) => Promise<unknown>;
  updateCard: (cardId: string, fields: Record<string, unknown>) => void;
  publishCard: (cardId: string) => void;
  errors: { cardNotFound: string; cardArchived: string; workspaceUnavailable: string };
};

export function createCardAdvance(deps: AdvanceDeps) {
  return ({ cardId, stage }: { cardId: string; stage: string }) =>
    advanceCard(deps, cardId, stage);
}

async function advanceCard(deps: AdvanceDeps, cardId: string, stage: string) {
  const card = deps.getCard(cardId);
  const refusal = advanceRefusal(deps, card);
  if (refusal) return refusal;
  const workspace = await deps.cardWorkspace(card!);
  if (!workspace?.path) return advanceFailure(deps.errors.workspaceUnavailable);
  const stateDir = card!.dir_hash
    ? await deps.workflowStateDir(workspace.path, card!)
    : null;
  const guard = await deps.ensureArtifacts(workspace.path, stateDir, Boolean(card!.dir_hash));
  if (guard) return advanceFailure(guard);
  const questionGuard = await deps.questionGate(card!, stateDir);
  if (questionGuard) return advanceFailure(questionGuard);
  const result = await deps.runHelper(["advance", stage], workspace.path, stateDir ?? undefined);
  if (result.code !== 0) return advanceFailure(result.stderr || "stelow advance failed", result.stdout);
  await swapBandPreset(deps, card!, stage);
  deps.updateCard(cardId, { stage, status: stage === "triage" ? "draft" : "in-progress", activity: "running" });
  deps.publishCard(cardId);
  return { ok: true, stdout: result.stdout, error: null };
}

function advanceRefusal(deps: AdvanceDeps, card: WorkerCard | undefined) {
  if (!card) return advanceFailure(deps.errors.cardNotFound);
  if (isArchivedCard(card)) return advanceFailure(deps.errors.cardArchived);
  if (card.kind === "research") return advanceFailure("Research cards don't use stages — a completed index moves them to Done automatically.");
  if (card.kind === "explore") return advanceFailure("Explore cards don't use stages — a completed artifact moves them to Done automatically.");
  return null;
}

function advanceFailure(error: string, stdout = "") {
  return { ok: false, stdout, error };
}

async function swapBandPreset(
  deps: AdvanceDeps,
  card: WorkerCard,
  stage: string,
): Promise<void> {
  const band = STAGE_TO_BAND[stage];
  if (!band) return;
  const preset = deps.getReliablePreset(band, card.id);
  const currentId = card.worker_preset_id ?? deps.getCardPreset(card.id).id;
  if (preset && preset.id !== currentId) await deps.respawn(card.id, preset.id);
}

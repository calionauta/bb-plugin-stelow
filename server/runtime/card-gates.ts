import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { WorkerCard } from "../workers-types.js";

import { GATES, type Gate } from "./gate-vocabulary.js";
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

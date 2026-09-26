/**
 * The shapes the native-execution rules share. The vocabulary (which recipe,
 * which stage, which capabilities) lives in the catalog module; the rules that
 * start, route, and prepare a run each take only the fields they read, so this
 * file is the single place a shape is named.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Recipe } from "../lib/recipe-catalog.mjs";
import type { ExecutionRoute } from "../lib/execution-route.mjs";
import type { ExecutionRun } from "../lib/execution-run-ledger.mjs";
import type { STAGE_BY_ID } from "../lib/workflow-vocabulary.mjs";
import { parseWorkflowConfig } from "../lib/workflow-config.mjs";
import type { WorkerCard } from "./workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export type Workspace = { path: string; hostId: string | null };

export type CardRoute = {
  recipeId: string;
  recipe: Recipe | null;
  route: ExecutionRoute;
};

export type StartContext = {
  prompt: string;
  intent?: string;
  stage?: string;
  reviewMode?: string;
};

export type StartResult = {
  ok: boolean;
  run: ExecutionRun | null;
  error: string | null;
};

export type NativeTransport = { workspaceId: string; projectId: string; threadId: string };

export type WorkflowStage = (typeof STAGE_BY_ID)[string];

export type WorkflowConfig = ReturnType<typeof parseWorkflowConfig>;

export type WorkflowContext = WorkflowConfig & { productType: string | null };

export type PreparedStart = {
  recipe: Recipe;
  stage: WorkflowStage;
  stateDir: string | null;
  workspacePath: string;
  artifactRoot: string;
  source: string;
  sourceHash: string;
  args: Record<string, unknown>;
};

/** The run fields the adapter is built from; a run row is more than that. */
export type AdapterRun = Pick<
  ExecutionRun,
  "workspaceId" | "projectId" | "originThreadId" | "sourceText" | "argsText"
>;

export type NativeDeps = {
  db: Db;
  bb: BbPluginApi;
  randomId: (prefix: string) => string;
  cardWorkspace: (card: WorkerCard) => Promise<Workspace | null>;
  stateDir: (card: WorkerCard, rootPath: string) => Promise<string | null>;
  logComment: (cardId: string, targetId: string, body: string) => void;
};

/** A start request that did not, or did not yet, produce a run. */
export type StartFailure = { ok: false; run: null; error: string };

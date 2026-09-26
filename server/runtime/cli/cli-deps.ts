import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import type { createDecisionApi } from "../../decision-api.js";
import type { createCardUpdater } from "../card-state.js";
import type { createCardPreview } from "../card-preview.js";
import type { createExecutionAdvance } from "../../execution-advance.js";
import type { createInboxServer } from "../../inbox.js";
import type { createPresetServer } from "../../presets.js";
import type { ResearchArtifactRuntime } from "../research-artifacts.js";
import type { CritiqueGapState } from "../critique-gap-state.js";
import type { createArtifactCriteriaJudge } from "../../decisions/artifact-criteria-judge.js";
import type {
  ScoredBatchArgs,
  ScoredBatchResult,
} from "../../decisions/scored-batch-judge.js";
import type { CardCreateInput } from "../../cards-create.js";
import type { Workers } from "../../workers.js";
import type { WorkerCard } from "../../workers-types.js";
import type { CliResult, CliRunContext } from "./cli-contract.js";
import type { rpcContract } from "../../rpc-contract.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type PresetServer = ReturnType<typeof createPresetServer>;
type InboxServer = ReturnType<typeof createInboxServer>;
type CardUpdater = ReturnType<typeof createCardUpdater>;
type CardPreview = ReturnType<typeof createCardPreview>;
type DecisionApi = ReturnType<typeof createDecisionApi>;
type ExecutionAdvance = ReturnType<typeof createExecutionAdvance>;

export type CardWorkspace = { path: string; hostId: string | null };
// The CLI only needs the checkout path (the executable checkout the worker
// changed); the richer environment shape stays with preview/publication.
export type CardCheckout = { path: string };
export type GitEvidence = {
  isGit: boolean;
  gitRoot: string | null;
  branch: string | null;
  headSha: string | null;
} | null;
export type PendingAsk = Extract<
  Awaited<
    ReturnType<BbPluginApi["sdk"]["threads"]["interactions"]["list"]>
  >[number],
  { origin: { kind: "plugin" } }
>;
export type DocDepth = { path: string; label: string; failures: string[] };
export type TestCommand = { command: string; args: string[]; display: string };
export type PreviewView = z.infer<typeof rpcContract.previewState.output>;
export type PendingQuestions = Awaited<
  ReturnType<typeof rpcContract.cardDetail.output.parse>
>["pendingQuestions"];
export type ResearchIndexResolution =
  | { ok: true; content: string; absolute: string; display: string }
  | { ok: false; error: string };
export type DecisionPointRow = {
  mode: string;
  thresholds: string;
  provider: string | null;
  endpoint: string | null;
  api_key: string | null;
  model: string | null;
  preset_id: string | null;
};
export type DecisionConfigRow = {
  endpoint: string;
  api_key: string;
  model: string;
  provider: string | null;
};

/** Every `bb stelow <verb>` implementation reads the same runtime: the card
 * row, its workspace and workflow state, the worker ledger, the preset pool,
 * the judging routes, and the plugin API itself. The composition root builds
 * this object once; command families declare what they use and never reach
 * back into the root. What a family can do without a host round-trip (pure
 * `lib/` predicates, node builtins) is imported directly, not injected. */
export type CliDeps = {
  db: Db;
  bb: BbPluginApi;
  now: () => number;
  randomId: (prefix: string) => string;
  getCard: (cardId: string) => WorkerCard | undefined;
  getCardByWorkerThread: (threadId: string) => WorkerCard | undefined;
  cardWorkspace: (card: WorkerCard) => Promise<CardWorkspace | null>;
  updateCard: CardUpdater;
  logCardComment: (
    cardId: string,
    target: string,
    targetId: string,
    author: "user" | "agent",
    body: string,
  ) => string;
  recordInboxEvent: InboxServer["record"];
  recordStageEvent: (cardId: string, stage: string) => void;
  stageEvents: (cardId: string) => Array<{ stage: string; entered_at: number }>;
  projectRoot: (projectId: string | null) => Promise<string | null>;
  workflowStateDir: (
    rootPath: string,
    workflowId: string,
    dirHash: string,
  ) => Promise<string | null>;
  ensureProjectArtifacts: (
    rootPath: string,
    stateDir: string | null,
    requireOwnedState: boolean,
  ) => Promise<string | null>;
  runHelper: (
    args: string[],
    cwd: string,
    stateDir?: string,
  ) => Promise<{ code: number | null; stdout: string; stderr: string }>;
  seedWorkflow: (
    rootPath: string,
    workflowId: string,
    name: string,
    intent: string,
  ) => Promise<{ error: string | null; statePath: string | null }>;
  cardCheckout: (card: WorkerCard) => Promise<CardCheckout | null>;
  gitEvidence: (path: string) => Promise<GitEvidence>;
  runGitIn: (cwd: string, args: string[]) => Promise<{ ok: boolean; stdout: string }>;
  workingDiffFor: (workspacePath: string, cap: number) => Promise<string>;
  testCommandForCheckout: (path: string) => TestCommand | null;
  runHostTests: (
    path: string,
    command: TestCommand,
  ) => Promise<{ exitCode: number; output: string }>;
  spawnDisposable: (
    args: Parameters<BbPluginApi["sdk"]["threads"]["spawn"]>[0],
    site: string,
  ) => Promise<{ id: string }>;
  cardStageSlug: (card: WorkerCard) => Promise<string | null>;
  docDepths: (card: WorkerCard) => Promise<DocDepth[]>;
  passingReviewCovers: (
    card: WorkerCard,
    fingerprint: string | null,
  ) => Promise<boolean>;
  pendingQuestions: (threadId: string | null) => Promise<PendingQuestions>;
  pendingAsks: (threadId: string | null) => Promise<PendingAsk[] | null>;
  openExpiredQuestionIds: (cardId: string) => string[];
  askContractChecklist: (
    cardId: string,
  ) => Promise<Array<{ id: string; kind: string }> | null>;
  snapshotQuestionEvidence: (
    cardId: string,
    optionArtifacts: Array<{ artifact: { path: string } | null }>,
  ) => Promise<void>;
  strategyRounds: (
    card: Pick<WorkerCard, "research_strategies" | "research_strategy">,
  ) => Array<{ id: string; at: string; file: string }>;
  readResearchIndex: (card: WorkerCard) => Promise<ResearchIndexResolution>;
  researchArtifacts: Pick<
    ResearchArtifactRuntime,
    "researchReadiness" | "exploreArtifact"
  >;
  gapState: (card: WorkerCard) => Promise<CritiqueGapState>;
  createCard: (
    input: CardCreateInput,
  ) => Promise<{ cardId: string; threadId: string | null }>;
  releaseCardClaims: (cardId: string) => Promise<void>;
  notifyClaimWaiters: (workspacePath: string, files: string[]) => Promise<void>;
  lockBlockedSummary: (
    file: string,
    holderName: string,
    expiresAt: number,
  ) => string;
  workers: Workers;
  presets: PresetServer;
  reviewPolicy: DecisionApi["reviewPolicy"];
  decisionRoute: DecisionApi["routeConfig"];
  judgeCriteria: ReturnType<typeof createArtifactCriteriaJudge>;
  judgeScoredBatch: (args: ScoredBatchArgs) => Promise<ScoredBatchResult>;
  preview: Pick<CardPreview, "view" | "start" | "stop">;
  draftingCommand: (
    argv: string[],
    threadId?: string,
  ) => Promise<CliResult | null>;
  advanceCli: ExecutionAdvance["cli"];
  scopeCommand: (
    argv: string[],
    ctx: CliRunContext,
  ) => Promise<CliResult>;
  runInspection: (
    argv: string[],
    context: CliRunContext,
  ) => Promise<CliResult | null>;
  skillsDir: string;
};

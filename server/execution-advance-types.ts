/**
 * The shapes the advance rules share. An advance is the same four beats wherever
 * it is called from — preflight, mutate state, dispatch the route, record it —
 * so the two entry points (the card action and the CLI) are written against one
 * vocabulary rather than each carrying its own idea of "prepared".
 */
import type { ExecutionNative, ExecutionRouteInfo } from "./execution-native.js";
import type { WorkerCard } from "./workers-types.js";

export type Workspace = { path: string; hostId: string | null };
export type HelperResult = { code: number | null; stdout: string; stderr: string };
export type AdvanceCardResult = { ok: boolean; stdout: string; error: string | null };
export type CliResult = { exitCode: number; stdout?: string; stderr?: string };
export type CliContext = { threadId?: string | null; projectId?: string | null };

export type PreparedAdvance = {
  route: ExecutionRouteInfo | null;
  note: string;
  evidence: string;
};

export type PreparedOrRefusal = PreparedAdvance | { error: string };

export type SyncedScopes = { syncedCount: number | null; refusal: string | null; note: string };

export type AdvanceDeps = {
  errors: { cardNotFound: string; cardArchived: string; workspaceUnavailable: string };
  getCard: (cardId: string) => WorkerCard | undefined;
  getCardByWorkerThread: (threadId: string) => WorkerCard | undefined;
  cardWorkspace: (card: WorkerCard) => Promise<Workspace | null>;
  projectRoot: (projectId: string | null) => Promise<string | null>;
  stateDir: (card: WorkerCard, rootPath: string) => Promise<string | null>;
  ensureArtifacts: (rootPath: string, stateDir: string | null, requireOwnedState: boolean) => Promise<string | null>;
  questionGate: (card: WorkerCard, stateDir: string | null) => Promise<string | null>;
  runHelper: (args: string[], rootPath: string, stateDir?: string) => Promise<HelperResult>;
  native: ExecutionNative;
  reworkNote: (card: WorkerCard) => Promise<string>;
  updateCard: (cardId: string, fields: Record<string, unknown>) => void;
  recordStageEvent: (cardId: string, stage: string) => void;
  recordExecutionEntry: (cardId: string, evidence: string, transition: "execution-refused" | "execution-entered") => void;
  getReliablePreset: (band: string, cardId: string) => { id: string } | null;
  getCardPresetId: (cardId: string) => string;
  respawn: (cardId: string, presetId: string) => Promise<unknown>;
  scheduleRespawn: (cardId: string, presetId: string) => void;
  requestGatePreReview: (cardId: string, stage: string) => Promise<void>;
  publishCard: (cardId: string) => void;
  isArchivedCard: (card: WorkerCard) => boolean;
};

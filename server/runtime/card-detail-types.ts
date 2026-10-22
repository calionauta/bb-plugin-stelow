import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ScopeDraft, ScopeXray } from "../scope-map-reader.js";
import type { WorkerCard } from "../workers-types.js";

export type Db = ReturnType<BbPluginApi["storage"]["database"]>;
export type Attachment = { path: string; type: "localFile" | "localImage" };
export type AskOption = {
  label: string;
  description: string;
  preview: string | null;
  artifact: { path: string } | null;
};
export type OptionArtifact = { artifact: { absolutePath: string | null } | null };
export type Workspace = { path: string; hostId: string | null };
export type Staleness = {
  docRevised: boolean;
  docRemoved: boolean;
  checkoutMoved: boolean;
  commitCount: number;
  touchedPaths: string[];
};
export type Question = { id: string; options: OptionArtifact[] } & Record<string, unknown>;
export type Preset = {
  id: string;
  name: string;
  provider_id: string | null;
  model_id: string | null;
};

export type CardDetailDeps = {
  db: Db;
  bb: BbPluginApi;
  now: () => number;
  idleAttentionMs: number;
  getCard: (cardId: string) => WorkerCard | undefined;
  cardWorkspace: (card: WorkerCard) => Promise<Workspace | null>;
  syncThreadState: (cardId: string) => Promise<unknown>;
  fetchPendingQuestions: (threadId: string | null) => Promise<Question[]>;
  resolveAskOptions: (card: WorkerCard, options: AskOption[]) => Promise<AskOption[]>;
  cardAttachments: (raw: string | null) => Attachment[];
  detectMentionedFiles: (
    bb: BbPluginApi,
    sourcePath: string | null,
    prompt: string,
  ) => Promise<Array<{ path: string; display: string; absolutePath: string }>>;
  workspaceRelative: (rootPath: string, path: string) => string | null;
  parseNextStages: (
    stage: string,
    options: { intent?: string | null; reviewPolicy?: string | string[] | null },
  ) => string[];
  getReliablePreset: (band: string | string[], cardId: string) => Preset;
  strategyList: (card: WorkerCard) => string[];
  flowTimes: (card: WorkerCard) => { leadMs: number | null; cycleMs: number | null };
  verifiedHeadSha: (cardId: string) => string | null;
  workers: { history: (cardId: string) => Promise<unknown[]> };
  executionLifecycle: { detailList: (cardId: string) => unknown[] };
  stalenessForQuestions: (
    cardId: string,
    questions: Question[],
  ) => Promise<Map<string, Staleness>>;
  stateDir: (
    sourcePath: string,
    card: WorkerCard,
  ) => Promise<string | null>;
  scopeXray: (stateDir: string | null) => Promise<ScopeXray | null>;
  scopeDraft: (stateDir: string | null) => Promise<ScopeDraft | null>;
  fileTimestamp: (
    file: { modifiedAtMs?: unknown } | null,
    fallback: string,
  ) => string;
  auditReceiptNote: (path: string) => string | null;
  cardNotFound: string;
};

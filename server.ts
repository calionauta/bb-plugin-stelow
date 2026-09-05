import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join as nodeJoin, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { parseArtifactManifest, resolveArtifactPath } from "./lib/artifact-manifest.mjs";
import { insertInboxEvent, listInboxEvents, resolveActionInboxEvents } from "./lib/inbox-events.mjs";
import { classifyAskCancel, interruptionWhy } from "./lib/ask-cancel.mjs";
import { recordWorkerThread, stallCount, refreshRestartPending, healPresetStaleness } from "./lib/worker-ledger.mjs";
import { mergeLineageFile, writeMergedFile } from "./lib/workflow-lineage.mjs";
import { normalizePromoteName, findAdoptableProject } from "./lib/promote-card.mjs";
import { RESEARCH_STRATEGIES, researchStrategyById, parseStrategyList } from "./lib/research-strategies.mjs";
import { parseResearchBrief, checkBriefItems } from "./lib/research-brief.mjs";
import { resolveCardMove } from "./lib/card-move.mjs";
import { WORKFLOW_SKILLS, syncWorkflowSkills } from "./lib/workflow-skills-sync.mjs";

const pluginDir = dirname(fileURLToPath(import.meta.url));
const HELPER_SCRIPT = (() => {
  const candidates = [
    nodeJoin(pluginDir, "data", "stelow"),
    nodeJoin(pluginDir, "..", "data", "stelow"),
  ];
  for (const candidate of candidates) {
    try { if (readFileSync(candidate, "utf8").length > 0) return candidate; } catch { /* try next */ }
  }
  return candidates[0]!;
})();
const PLUGIN_SKILLS_DIR = nodeJoin(pluginDir, "skills");
const PLUGIN_ORCHESTRATOR_REF = nodeJoin(PLUGIN_SKILLS_DIR, "stelow-workflow-orchestrator", "references");

const TRANSITIONS_REF = (() => {
  const candidates = [
    nodeJoin(PLUGIN_ORCHESTRATOR_REF, "transitions.md"),
    nodeJoin(pluginDir, "references", "transitions.md"),
    nodeJoin(pluginDir, "..", "references", "transitions.md"),
  ];
  for (const candidate of candidates) {
    try { if (readFileSync(candidate, "utf8").length > 0) return candidate; } catch { /* try next */ }
  }
  return candidates[0]!;
})();
const STATE_TEMPLATE = `---\nname: <workflow-name>\nintent: <new-product|feature|bugfix|refactor|investigate|unknown>\ncurrent_stage: triage\nstatus: active\nconfig:\n  appetite: Core\n  review_mode: Auto\n  product_type: software\nstages:\n  triage: pending\n  select: pending\n  setup: pending\n  context: pending\n  shape: pending\n  critique: pending\n  gate: pending\n  scope: pending\n  interface: pending\n  int-gate: pending\n  selection: pending\n  planning: pending\n  plan-gate: pending\n  execution: pending\n  verification: pending\n  diff-gate: pending\n  audit: pending\nartifacts: []\nhistory: []\n---\n`;

// Ground-truth freshness signal, written by scripts/postbuild.mjs. The panel
// bundle and bb's plugin row are both sticky caches; the board footer renders
// this so "did the reload take effect?" is checkable instead of vibes.
const BUILD_INFO = (() => {
  const fallback = { version: "dev", builtAt: null as string | null };
  for (const candidate of [nodeJoin(pluginDir, "version.json"), nodeJoin(pluginDir, "..", "version.json"), nodeJoin(pluginDir, "..", "package.json")]) {
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { version?: unknown; builtAt?: unknown };
      if (typeof parsed.version === "string") return { version: parsed.version, builtAt: typeof parsed.builtAt === "string" ? parsed.builtAt : null };
    } catch { /* try next */ }
  }
  return fallback;
})();

// Stage bands: groups of workflow stages that share a worker preset. A card's
// worker swaps presets only at band boundaries (analysis -> planning -> execution
// -> review), so context continuity is preserved within a band.
const STAGE_BANDS: Record<string, string[]> = {
  analysis: ["triage", "select", "setup", "context", "shape"],
  planning: ["critique", "scope", "interface", "int-gate", "selection", "planning", "plan-gate"],
  execution: ["execution", "verification"],
  review: ["diff-gate", "audit"],
};
const STAGE_TO_BAND: Record<string, string> = Object.fromEntries(
  Object.entries(STAGE_BANDS).flatMap(([band, stages]) => stages.map((stage) => [stage, band])),
);

// Pi exposes every route it can delegate to (OpenRouter, OpenCode, Bifrost,
// etc.). Stelow's Pi presets intentionally offer only the configured Bifrost
// routes used by this installation, keeping the picker actionable.
const PI_BIFROST_PRESET_MODELS = [
  { model: "bifrost/harness-coding", displayName: "Harness Coding (Bifrost)" },
  { model: "bifrost/gpt-5.6-sol", displayName: "GPT-5.6 Sol (ChatGPT via Bifrost)" },
  { model: "bifrost/gpt-5.6-terra", displayName: "GPT-5.6 Terra (ChatGPT via Bifrost)" },
  { model: "bifrost/gpt-5.6-luna", displayName: "GPT-5.6 Luna (ChatGPT via Bifrost)" },
] as const;

const statusSchema = z.enum([
  "draft",
  "planning",
  "approved",
  "in-progress",
  "completed",
  "archived",
  "pending",
  "done",
  "skipped",
  "blocked",
  "escalated",
  "failed",
]);

const appetiteSchema = z.enum(["Lean", "Core", "Complete"]);
const reviewModeSchema = z.enum([
  "Auto",
  "Product Spec Gate",
  "Product Spec + Interface Gates",
  "Product Spec + Interface + Scopes",
  "Product Spec + Interface + Tech Review",
  "Product Spec + Interface + Tech Review + Code Diff",
]);
const boardWorkflowDefaultsSchema = z.object({ appetite: appetiteSchema, reviewMode: reviewModeSchema }).strict();

const taskSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: statusSchema,
  source: z.string().optional(),
  note: z.string().optional(),
});

const scopeSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string().optional(),
  status: statusSchema,
  tasks: z.array(taskSchema),
});

const artifactSchema = z.object({
  kind: z.enum(["product-spec", "interfaces", "tech-plan", "critique", "other"]),
  label: z.string(),
  path: z.string(),
  approved: z.boolean(),
});

const attachmentSchema = z.object({
  path: z.string().min(1).max(4_000),
  type: z.enum(["localFile", "localImage"]),
}).strict();

const workflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  status: statusSchema,
  stage: z.string(),
  appetite: z.string(),
  reviewMode: z.string(),
  dirHash: z.string().optional(),
  cwd: z.string().optional(),
  phases: z.array(z.object({ id: z.string(), name: z.string(), status: statusSchema })),
  scopes: z.array(scopeSchema),
  artifacts: z.array(artifactSchema),
});

const questionOptionSchema = z.object({
  label: z.string().min(1).max(60),
  description: z.string().max(500),
});

export const rpcContract = defineRpcContract({
  board: {
    input: z.object({ projectId: z.string().nullable() }).strict(),
    output: z.object({
      rootPath: z.string().nullable(),
      workflows: z.array(workflowSchema),
      error: z.string().nullable(),
      githubStatus: z.object({ ok: z.boolean(), pluginAvailable: z.boolean(), ghOk: z.boolean(), repos: z.array(z.object({ repo: z.string(), projectId: z.string().nullable() })) }),
    }),
  },
  projects: {
    input: z.object({}).strict(),
    output: z.object({ projects: z.array(z.object({ id: z.string(), name: z.string() })) }),
  },
  answerQuestion: {
    input: z.object({ cardId: z.string(), answers: z.array(z.string()) }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  listGithubCandidates: {
    input: z.object({ label: z.string().min(1).max(60) }).strict(),
    output: z.object({
      issues: z.array(z.object({
        repo: z.string(), number: z.number().int().positive(), title: z.string(), labels: z.array(z.string()), author: z.string(), url: z.string(), body: z.string(), updatedAt: z.string(), projectId: z.string().nullable(), alreadyImported: z.boolean(), cardId: z.string().nullable(), cardName: z.string().nullable(),
      })),
    }),
  },
  importGithubIssue: {
    input: z.object({ projectId: z.string().nullable().optional(), repo: z.string(), number: z.number().int().positive(), label: z.string().min(1).max(60), intent: z.enum(["new-product", "feature", "bugfix", "refactor", "investigate", "unknown"]).default("investigate") }).strict(),
    output: z.object({ ok: z.boolean(), cardId: z.string().nullable(), skipped: z.string().nullable(), error: z.string().nullable() }),
  },
  listCards: {
    input: z.object({ projectId: z.string().nullable(), kind: z.enum(["delivery", "research"]).nullable().optional() }).strict(),
    output: z.object({ cards: z.array(z.object({ id: z.string(), name: z.string(), displayName: z.string(), prompt: z.string(), intent: z.string(), projectId: z.string(), projectName: z.string(), workspaceKind: z.enum(["project", "exploratory"]), workspacePath: z.string().nullable(), kind: z.enum(["delivery", "research"]), researchStrategy: z.string().nullable(), researchStrategies: z.array(z.string()), status: statusSchema, stage: z.string(), workerThreadId: z.string().nullable(), activity: z.enum(["idle", "running", "awaiting-answer", "error"]), lastError: z.string().nullable(), needsAttention: z.boolean(), presetName: z.string().nullable(), presetProviderId: z.string().nullable(), presetModelId: z.string().nullable(), updatedAt: z.number(), stallCount: z.number(), scopeSummary: z.object({ scopesTotal: z.number(), scopesDone: z.number(), tasksTotal: z.number(), tasksDone: z.number() }) })) }),
  },
  listNotifications: {
    input: z.object({ includeArchived: z.boolean().default(false) }).strict(),
    output: z.object({ notifications: z.array(z.object({ id: z.string(), cardId: z.string(), cardName: z.string(), projectName: z.string(), cardKind: z.enum(["delivery", "research"]), kind: z.enum(["question", "error", "paused", "completed"]), summary: z.string(), occurredAt: z.number(), readAt: z.number().nullable(), resolvedAt: z.number().nullable(), archivedAt: z.number().nullable() })) }),
  },
  markNotificationRead: {
    input: z.object({ notificationId: z.string() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  markCardNotificationsRead: {
    input: z.object({ cardId: z.string(), kind: z.enum(["question", "error", "paused", "completed"]) }).strict(),
    output: z.object({ marked: z.boolean() }),
  },
  archiveNotification: {
    input: z.object({ notificationId: z.string() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  restoreNotification: {
    input: z.object({ notificationId: z.string() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  cardByWorkerThread: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({ cardId: z.string().nullable(), kind: z.enum(["delivery", "research"]).nullable() }),
  },
  getNotification: {
    input: z.object({ notificationId: z.string(), cardId: z.string() }).strict(),
    output: z.object({ notification: z.object({ id: z.string(), kind: z.enum(["question", "error", "paused", "completed"]), summary: z.string(), occurredAt: z.number() }).nullable() }),
  },
  readCardFile: {
    input: z.object({ cardId: z.string(), path: z.string().min(1).max(4_000) }).strict(),
    output: z.object({ content: z.string().nullable(), truncated: z.boolean(), error: z.string().nullable() }),
  },
  boardWorkflowDefaults: {
    input: z.object({}).strict(),
    output: boardWorkflowDefaultsSchema,
  },
  createCard: {
    input: z.object({ projectId: z.string(), environment: z.unknown(), prompt: z.string().min(1).max(20_000), attachments: z.array(attachmentSchema).max(20).default([]), intent: z.enum(["new-product", "feature", "bugfix", "refactor", "investigate", "unknown"]).default("unknown"), appetite: appetiteSchema.default("Lean"), reviewMode: reviewModeSchema.default("Auto"), presetId: z.string().nullable().optional() }).strict(),
    output: z.object({ cardId: z.string(), threadId: z.string() }),
  },
  updateCardIntent: {
    input: z.object({ cardId: z.string(), intent: z.enum(["new-product", "feature", "bugfix", "refactor", "investigate", "unknown"]) }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable(), pastTriage: z.boolean(), notified: z.boolean() }),
  },
  cardDetail: {
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({
      card: z.object({ id: z.string(), name: z.string(), displayName: z.string(), prompt: z.string(), intent: z.string(), projectId: z.string(), projectName: z.string(), workspaceKind: z.enum(["project", "exploratory"]), workspacePath: z.string().nullable(), kind: z.enum(["delivery", "research"]), researchStrategy: z.string().nullable(), researchStrategies: z.array(z.string()), status: statusSchema, stage: z.string(), workerThreadId: z.string().nullable(), activity: z.enum(["idle", "running", "awaiting-answer", "error"]), lastError: z.string().nullable(), needsAttention: z.boolean(), presetName: z.string().nullable(), presetProviderId: z.string().nullable(), presetModelId: z.string().nullable(), presetOverridden: z.boolean(), updatedAt: z.number(), stallCount: z.number(), presetId: z.string(), workerPresetId: z.string().nullable(), presetRestartPending: z.boolean() }),
      attachments: z.array(attachmentSchema.extend({ display: z.string(), relPath: z.string().nullable() })),
      mentionedFiles: z.array(z.object({ path: z.string(), display: z.string(), absolutePath: z.string(), hostId: z.string(), relPath: z.string().nullable() })),
      scopes: z.array(z.object({ id: z.string(), name: z.string(), type: z.string().optional(), status: statusSchema, blockedBy: z.array(z.string()).optional(), dependsOn: z.array(z.string()).optional(), tasks: z.array(z.object({ id: z.string(), name: z.string(), status: statusSchema, source: z.string().optional(), note: z.string().optional(), blockedBy: z.array(z.string()).optional(), dependsOn: z.array(z.string()).optional() })) })),
      comments: z.array(z.object({ id: z.string(), target: z.enum(["card", "scope", "task"]), targetId: z.string(), author: z.enum(["user", "agent"]), body: z.string(), createdAt: z.number() })),
      pendingQuestions: z.array(z.object({ id: z.string(), title: z.string(), question: z.string(), multiple: z.boolean(), options: z.array(z.object({ label: z.string(), description: z.string() })), expiresAt: z.number().nullable() })),
      expiredQuestions: z.array(z.object({ id: z.string(), question: z.string(), multiple: z.boolean(), options: z.array(z.object({ label: z.string(), description: z.string() })), expiredAt: z.number() })),
      artifacts: z.array(z.object({ stage: z.string(), kind: z.string(), path: z.string(), display: z.string(), generatedAt: z.string(), absolutePath: z.string(), hostId: z.string() })),
      workerHistory: z.array(z.object({ threadId: z.string(), presetName: z.string().nullable(), startedAt: z.number(), endedAt: z.number().nullable(), endedReason: z.string().nullable() })),
      // Environment of the worker thread: enables workspace-kind file links
      // (the official viewer with comments). Host-kind links fail for
      // exploratory workspaces, which live outside provisioned environments.
      fileEnvironmentId: z.string().nullable(),
      nextStages: z.array(z.string()),
    }),
  },
  addCardComment: {
    input: z.object({ cardId: z.string(), target: z.enum(["card", "scope", "task"]), targetId: z.string(), body: z.string().min(1).max(10_000) }).strict(),
    output: z.object({ commentId: z.string(), error: z.string().nullable() }),
  },
  cancelCard: {
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ archived: z.boolean() }),
  },
  reseedCard: {
    input: z.object({ cardId: z.string(), presetId: z.string().nullable().optional() }).strict(),
    output: z.object({ reseeded: z.boolean(), error: z.string().nullable() }),
  },
  retryWorker: {
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  restartWorker: {
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  moveCard: {
    input: z.object({ cardId: z.string(), status: z.enum(["analysis", "planning", "execution", "review", "completed", "archived", "todo", "doing", "done"]) }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  researchStrategies: {
    input: z.object({}).strict(),
    output: z.object({ strategies: z.array(z.object({ id: z.string(), label: z.string(), skill: z.string(), blurb: z.string() })) }),
  },
  createResearchCard: {
    input: z.object({ projectId: z.string(), environment: z.unknown(), prompt: z.string().min(1).max(20_000), attachments: z.array(attachmentSchema).max(20).default([]), strategy: z.string().min(1).max(60) }).strict(),
    output: z.object({ cardId: z.string(), threadId: z.string() }),
  },
  researchBrief: {
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ found: z.boolean(), briefPath: z.string().nullable(), content: z.string().nullable(), truncated: z.boolean(), opportunities: z.array(z.object({ id: z.string(), title: z.string(), checked: z.boolean(), group: z.string().nullable() })), error: z.string().nullable() }),
  },
  fanOutResearch: {
    input: z.object({ cardId: z.string(), opportunityIds: z.array(z.string().min(1).max(120)).min(1).max(20) }).strict(),
    output: z.object({ ok: z.boolean(), created: z.array(z.object({ cardId: z.string(), title: z.string() })), error: z.string().nullable() }),
  },
  runResearchStrategy: {
    input: z.object({ cardId: z.string(), strategy: z.string().min(1).max(60) }).strict(),
    output: z.object({ ok: z.boolean(), strategy: z.string().nullable(), error: z.string().nullable() }),
  },
  promoteCard: {
    input: z.object({ cardId: z.string(), name: z.string().min(1).max(120) }).strict(),
    output: z.object({ ok: z.boolean(), projectId: z.string().nullable(), projectName: z.string().nullable(), error: z.string().nullable() }),
  },
  answerExpiredQuestion: {
    input: z.object({ cardId: z.string(), questionId: z.string(), answer: z.string().min(1).max(10_000) }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  advanceCard: {
    input: z.object({ cardId: z.string(), stage: z.string().min(1).max(40) }).strict(),
    output: z.object({ ok: z.boolean(), stdout: z.string(), error: z.string().nullable() }),
  },
  approveGate: {
    input: z.object({ projectId: z.string().nullable(), workflowId: z.string(), gate: z.enum(["gate", "int-gate", "plan-gate", "diff-gate"]) }).strict(),
    output: z.object({ approved: z.boolean(), receiptPath: z.string().nullable(), error: z.string().nullable() }),
  },
  ask: {
    input: z.object({
      threadId: z.string(),
      title: z.string().min(1).max(100),
      question: z.string().min(1).max(2_000),
      multiple: z.boolean(),
      options: z.array(questionOptionSchema).min(2).max(6),
    }).strict(),
    output: z.object({ outcome: z.enum(["submitted", "cancelled"]), answers: z.array(z.string()) }),
  },
  startWorkflow: {
    input: z.object({ projectId: z.string(), prompt: z.string().min(1).max(20_000) }).strict(),
    output: z.object({ threadId: z.string() }),
  },
  advance: {
    input: z.object({ projectId: z.string().nullable(), stage: z.string().min(1).max(40) }).strict(),
    output: z.object({ stage: z.string(), stdout: z.string(), error: z.string().nullable() }),
  },
  ensureWorkflow: {
    input: z.object({ projectId: z.string().nullable(), name: z.string().min(1).max(120), intent: z.enum(["new-product", "feature", "bugfix", "refactor", "investigate"]) }).strict(),
    output: z.object({ rootPath: z.string().nullable(), statePath: z.string().nullable(), error: z.string().nullable() }),
  },
  listPresets: {
    input: z.object({}).strict(),
    output: z.object({ presets: z.array(z.object({ id: z.string(), name: z.string(), providerId: z.string(), modelId: z.string(), reasoningLevel: z.string(), permissionMode: z.string(), environmentKind: z.string(), baseBranch: z.string().nullable(), machineId: z.string().nullable(), instructions: z.string(), isDefault: z.boolean(), builtIn: z.boolean() })) }),
  },
  upsertPreset: {
    input: z.object({
      id: z.string().min(1).nullable().optional(),
      name: z.string().min(1).max(60),
      providerId: z.string().min(1).max(60),
      modelId: z.string().min(1).max(120),
      reasoningLevel: z.string().min(1).max(20),
      permissionMode: z.enum(["accept-edits", "auto", "full"]),
      environmentKind: z.enum(["project-default", "new-worktree"]).default("project-default"),
      baseBranch: z.string().nullable().optional(),
      machineId: z.string().nullable().optional(),
      instructions: z.string().max(8_000).default(""),
    }).strict(),
    output: z.object({ preset: z.object({ id: z.string(), name: z.string() }) }),
  },
  deletePreset: {
    input: z.object({ id: z.string() }).strict(),
    output: z.object({ deleted: z.boolean(), error: z.string().nullable() }),
  },
  listBandPresets: {
    input: z.object({}).strict(),
    output: z.object({ bands: z.array(z.object({ band: z.string(), presetId: z.string().nullable(), stages: z.array(z.string()) })) }),
  },
  setBandPreset: {
    input: z.object({ band: z.string(), presetId: z.string().nullable() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  assignPreset: {
    input: z.object({ cardId: z.string(), presetId: z.string().nullable() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  setDefaultPreset: {
    input: z.object({ id: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  listProviderModels: {
    input: z.object({}).strict(),
    output: z.object({
      providers: z.array(z.object({ id: z.string(), displayName: z.string(), modelsAvailable: z.boolean() })),
      models: z.array(z.object({ providerId: z.string(), model: z.string(), displayName: z.string() })),
    }),
  },
  buildInfo: {
    input: z.object({}).strict(),
    output: z.object({ version: z.string(), builtAt: z.string().nullable() }),
  },
});

type FilesApi = BbPluginApi["sdk"]["files"];
type Workflow = z.infer<typeof workflowSchema>;
type LooseRecord = Record<string, unknown>;

const GATES = {
  gate: { artifact: "product-spec", receipt: "gate-approved.md" },
  "int-gate": { artifact: "interfaces", receipt: "int-gate-approved.md" },
  "plan-gate": { artifact: "tech-plan", receipt: "plan-gate-approved.md" },
  "diff-gate": { artifact: "other", receipt: "diff-gate-approved.md" },
} as const;

function record(value: unknown): LooseRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as LooseRecord : {};
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeStatus(value: unknown): z.infer<typeof statusSchema> {
  const candidate = text(value, "pending");
  return statusSchema.safeParse(candidate).success ? candidate as z.infer<typeof statusSchema> : "pending";
}

async function projectRoot(bb: BbPluginApi, projectId: string | null): Promise<string | null> {
  if (!projectId) return null;
  try {
    const project = await bb.sdk.projects.get({ projectId });
    const source = project.sources.find((entry) => entry.isDefault) ?? project.sources[0];
    return source?.path ?? null;
  } catch {
    return null;
  }
}

// Resolve the per-workflow state dir (.stelow/<date>/<dirHash>) that owns a
// card's state.md. dirHash is stored on the card; the workflow's created date
// comes from stelow.json. Returns null if the workflow entry is missing.
async function workflowStateDir(bb: BbPluginApi, rootPath: string, dirHash: string): Promise<string | null> {
  try {
    const tracking = await readJson(bb.sdk.files, join(rootPath, "stelow.json"));
    const workflow = array(tracking?.workflows).find((raw) => text(record(raw).dirHash) === dirHash);
    if (!workflow) return null;
    const created = text(record(workflow).created).slice(0, 10);
    if (!created) return null;
    return join(rootPath, `.stelow/${created}/${dirHash}`);
  } catch {
    return null;
  }
}

function join(root: string, relative: string): string {
  return `${root.replace(/\/$/, "")}/${relative.replace(/^\//, "")}`;
}

function safeRelative(path: string): string {
  if (!path || path.startsWith("/") || path.split("/").some((part) => part === "..")) {
    throw new Error("Path must stay inside the project workspace.");
  }
  return path;
}

async function seedWorkflow(bb: BbPluginApi, rootPath: string, name: string, intent: string, appetite = "Core", reviewMode = "Auto", fresh = false): Promise<{ statePath: string | null; stateDir: string | null; dirHash: string | null; error: string | null }> {
  const transitionsPath = join(rootPath, "skills/stelow-workflow-orchestrator/references/transitions.md");
  const trackingPath = join(rootPath, "stelow.json");
  try {
    mkdirSync(join(rootPath, ".stelow/approvals"), { recursive: true });
    mkdirSync(join(rootPath, "skills/stelow-workflow-orchestrator/references"), { recursive: true });

    let dirHash: string;
    const date = new Date().toISOString().slice(0, 10);

    let trackingData: LooseRecord = {};
    try { trackingData = JSON.parse(readFileSync(trackingPath, "utf8")) as LooseRecord; } catch { /* create fresh */ }
    if (!Array.isArray(trackingData.workflows)) trackingData.workflows = [];

    let trackingOwner = "";
    try {
      const existing = await bb.sdk.files.read({ path: trackingPath });
      const parsed = JSON.parse(existing.content) as LooseRecord;
      trackingOwner = text((Array.isArray(parsed.workflows) && parsed.workflows.find((w) => text(record(w).name) === name) ? record(parsed.workflows.find((w) => text(record(w).name) === name)) : {}).name);
    } catch { /* fresh file */ }

    // Each card/workflow owns its state at .stelow/<date>/<dirHash>/state.md.
    // Reuse an existing dirHash when a workflow entry already exists for this
    // name AND its state file still lives there (same card re-seeded); otherwise
    // mint a fresh dirHash so two cards never share a state file.
    const entry = (trackingData.workflows as Array<LooseRecord>).find((workflow) => text(workflow.name) === name && text(workflow.dirHash));
    if (!fresh && entry && entry.dirHash && (await bb.sdk.files.read({ path: join(rootPath, `.stelow/${text(entry.created).slice(0, 10)}/${text(entry.dirHash)}/state.md`) }).then((f) => f.content.includes("current_stage:")).catch(() => false))) {
      dirHash = text(entry.dirHash);
    } else {
      dirHash = `pw-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
    }
    const stateDir = join(rootPath, `.stelow/${date}/${dirHash}`);
    mkdirSync(stateDir, { recursive: true });
    const statePath = join(stateDir, "state.md");
    const stateBlob = await bb.sdk.files.read({ path: statePath }).then((f) => f.content).catch(() => "");
    const stateOwner = text(stateBlob.match(/^name:\s*(\S+)/m)?.[1]);
    if (!stateBlob.includes("current_stage:") || stateOwner !== name) {
      const body = STATE_TEMPLATE.replace("<workflow-name>", name).replace("<new-product|feature|bugfix|refactor|investigate|unknown>", intent);
      writeFileSync(statePath, body.replace("appetite: Core", `appetite: ${appetite}`).replace("review_mode: Auto", `review_mode: ${reviewMode}`), "utf8");
    }

    if (!existsSync(transitionsPath)) {
      writeFileSync(transitionsPath, readFileSync(TRANSITIONS_REF, "utf8"), "utf8");
    }

    const existingIndex = (trackingData.workflows as Array<LooseRecord>).findIndex((workflow) => workflow.name === name);
    if (existingIndex === -1) {
      (trackingData.workflows as unknown[]).push({ name, description: "", status: "in-progress", cwd: rootPath, dirHash, created: new Date().toISOString(), updated: new Date().toISOString(), stage: { current_stage: "triage", previous_stage: null, transitioned_at: new Date().toISOString(), history: [{ stage: "triage", entered_at: new Date().toISOString() }] }, phases: [], config: { appetite, review_mode: reviewMode } });
      writeFileSync(trackingPath, JSON.stringify(trackingData, null, 2), "utf8");
    } else if (fresh) {
      const workflows = trackingData.workflows as Array<LooseRecord>;
      workflows[existingIndex] = { ...workflows[existingIndex], cwd: rootPath, dirHash, created: new Date().toISOString(), updated: new Date().toISOString(), status: "in-progress", stage: { current_stage: "triage", previous_stage: null, transitioned_at: new Date().toISOString(), history: [{ stage: "triage", entered_at: new Date().toISOString() }] }, config: { appetite, review_mode: reviewMode } };
      writeFileSync(trackingPath, JSON.stringify(trackingData, null, 2), "utf8");
    }
    return { statePath, stateDir, dirHash, error: null };
  } catch (error) {
    return { statePath: null, stateDir: null, dirHash: null, error: error instanceof Error ? error.message : "Unable to seed workflow." };
  }
}

function workerEnvironment(source: { path: string; hostId: string }, params: { environmentKind: string; machineId: string | null }, forceWorkspaceHost = false) {
  // Card workflow state is stored in the declared workspace. The default preset
  // must therefore run there as well; BB's generic project-default may point at
  // a managed worktree, which silently splits state from execution.
  if (forceWorkspaceHost || params.environmentKind === "project-default") {
    return { type: "host" as const, hostId: forceWorkspaceHost ? source.hostId : (params.machineId ?? source.hostId), workspace: { type: "unmanaged" as const, path: source.path } };
  }
  return { type: "project-default" as const };
}

function cardAttachments(raw: string | null): Array<z.infer<typeof attachmentSchema>> {
  try { return z.array(attachmentSchema).parse(JSON.parse(raw ?? "[]")); } catch { return []; }
}

function workspaceRelative(rootPath: string, path: string): string | null {
  const value = isAbsolute(path) ? relative(rootPath, path) : path;
  try { return safeRelative(value); } catch { return null; }
}

async function detectMentionedFiles(bb: BbPluginApi, rootPath: string | null, text: string): Promise<Array<{ path: string; display: string; absolutePath: string }>> {
  if (!rootPath) return [];
  const candidates = new Set<string>();
  // Match file-ish tokens: path/to/file.ext (no spaces, may include -_./)
  for (const match of text.matchAll(/\b(?:(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:md|markdown|txt|json|yaml|yml|toml|ts|tsx|js|jsx|py|go|rs|sh|css|html|env))(?:\b|(?=[\s,.;:)]))/g)) {
    const token = match[0]!.replace(/[.,;:)]+$/, "");
    if (token.length >= 3 && token.length <= 120) candidates.add(token);
  }
  const found: Array<{ path: string; display: string; absolutePath: string }> = [];
  for (const candidate of candidates) {
    try {
      await bb.sdk.files.read({ path: join(rootPath, candidate) });
      found.push({ path: candidate, display: candidate, absolutePath: join(rootPath, candidate) });
    } catch { /* not found in workspace root */ }
  }
  if (found.length === 0) {
    // Fall back: check the raw basename anywhere under the workspace.
    for (const candidate of candidates) {
      const basename = candidate.split("/").pop()!;
      if (!basename) continue;
      const listed = await bb.sdk.files.list({ path: rootPath, query: basename }).catch(() => null);
      const hit = (listed?.files ?? []).find((entry) => entry.path.endsWith(basename));
      if (hit) found.push({ path: hit.path, display: hit.path, absolutePath: hit.path });
    }
  }
  return found.slice(0, 6);
}

function parseNextStages(rootPath: string | null, currentStage: string): string[] {
  if (!rootPath) return [];
  const transitionsPath = join(rootPath, "skills/stelow-workflow-orchestrator/references/transitions.md");
  if (!existsSync(transitionsPath)) return [];
  let content: string;
  try { content = readFileSync(transitionsPath, "utf8"); } catch { return []; }
  // NOTE: do not use a `(?=^### |\Z)`-style regex here — `\Z` is an
  // end-of-string anchor in Python but a literal "Z" in JavaScript, which
  // silently broke parsing of the last stage block (`audit`). Splitting on
  // headers avoids the dialect trap and any regex injection via stage names.
  const sections = content.split(/^### /m);
  const section = sections.find((entry) => entry === currentStage || entry.startsWith(`${currentStage}\n`) || entry.startsWith(`${currentStage} `));
  if (!section) return [];
  const stages = new Set<string>();
  for (const raw of section.split("\n")) {
    const line = raw.trim();
    for (const key of ["next", "accept", "reject", "rework"] as const) {
      const match = line.match(new RegExp(`^${key}:\\s*(.*)$`));
      if (!match) continue;
      // Trailing "(...)" segments are human comments ("(none — stays at
      // triage)", "shape (shape rework — same stage)"), not stages. Without
      // stripping, a comment either leaks words (comma split keeps them) or
      // hides a real target (the whole token contains "(" and is dropped).
      const value = match[1].split("(")[0];
      for (const token of value.split(",")) {
        const stage = token.replace(/[\[\]\s"']/g, "");
        if (stage && /^[a-z][a-z0-9-]*$/.test(stage)) stages.add(stage);
      }
    }
  }
  return Array.from(stages);
}

function loadCardScopes(rootPath: string | null, name: string): Awaited<ReturnType<typeof rpcContract.cardDetail.output.parse>>["scopes"] {
  if (!rootPath) return [];
  const tracking = join(rootPath, "stelow.json");
  if (!existsSync(tracking)) return [];
  let trackingData: LooseRecord;
  try { trackingData = JSON.parse(readFileSync(tracking, "utf8")) as LooseRecord; } catch { return []; }
  const workflows = array(trackingData.workflows);
  const match = workflows.find((entry) => text(record(entry).name) === name) as LooseRecord | undefined;
  if (!match) return [];
  return workflowScopes(match);
}

async function ensureProjectArtifacts(bb: BbPluginApi, rootPath: string, stateDir?: string | null): Promise<string | null> {
  const tracking = join(rootPath, "stelow.json");
  const transitions = join(rootPath, "skills/stelow-workflow-orchestrator/references/transitions.md");
  const state = stateDir ? join(stateDir, "state.md") : join(rootPath, "state.md");
  if (!existsSync(transitions)) {
    mkdirSync(dirname(transitions), { recursive: true });
    writeFileSync(transitions, readFileSync(TRANSITIONS_REF, "utf8"), "utf8");
  }
  if (!existsSync(state) || !(await bb.sdk.files.read({ path: state }).then((file) => file.content.includes("current_stage:")).catch(() => false))) {
    return "state.md is missing for the Stelow workflow. Reseed the workflow.";
  }
  if (!existsSync(tracking)) {
    return "stelow.json is missing for the Stelow workflow. Reseed the workflow.";
  }
  return null;
}

function runHelper(args: string[], cwd: string, stateDir?: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveRun) => {
    const env: Record<string, string> = { ...(process.env as Record<string, string>), STELOW_TRANSITIONS: nodeJoin(cwd, "skills/stelow-workflow-orchestrator/references/transitions.md") };
    if (stateDir) {
      env.STELOW_STATEDIR = stateDir;
      env.STELOW_STATE = nodeJoin(stateDir, "state.md");
    } else {
      // Legacy fallback: single root state.md.
      env.STELOW_STATE = nodeJoin(cwd, "state.md");
    }
    const child = spawn("bash", [HELPER_SCRIPT, ...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => resolveRun({ code: null, stdout, stderr: error.message }));
    child.on("close", (code) => resolveRun({ code, stdout, stderr }));
  });
}

async function readJson(files: FilesApi, path: string): Promise<LooseRecord | null> {
  try {
    const file = await files.read({ path });
    return record(JSON.parse(file.content));
  } catch {
    return null;
  }
}

function workflowScopes(raw: LooseRecord): Workflow["scopes"] {
  return array(raw.scopes).map((entry, index) => {
    const scope = record(entry);
    return {
      id: text(scope.id, `scope-${index + 1}`),
      name: text(scope.name, text(scope.title, `Scope ${index + 1}`)),
      ...(typeof scope.type === "string" ? { type: scope.type } : {}),
      status: normalizeStatus(scope.status),
      ...(Array.isArray(scope.blockedBy) ? { blockedBy: (scope.blockedBy as unknown[]).map((entry) => typeof entry === "string" ? entry : String(entry)) } : {}),
      ...(Array.isArray(scope.depends_on) ? { dependsOn: (scope.depends_on as unknown[]).map((entry) => typeof entry === "string" ? entry : String(entry)) } : {}),
      tasks: array(scope.tasks).map((item, taskIndex) => {
        const task = record(item);
        const strArray = (value: unknown): string[] | undefined => Array.isArray(value) ? value.map((entry) => typeof entry === "string" ? entry : String(entry)) : undefined;
        return {
          id: text(task.id, `task-${taskIndex + 1}`),
          name: text(task.name, text(task.title, `Task ${taskIndex + 1}`)),
          status: normalizeStatus(task.status),
          ...(typeof task.source === "string" ? { source: task.source } : {}),
          ...(typeof task.note === "string" ? { note: task.note } : {}),
          ...(strArray(task.blockedBy) ?? strArray(task.blocked_by) ? { blockedBy: strArray(task.blockedBy) ?? strArray(task.blocked_by) } : {}),
          ...(strArray(task.dependsOn) ?? strArray(task.depends_on) ? { dependsOn: strArray(task.dependsOn) ?? strArray(task.depends_on) } : {}),
        };
      }),
    };
  });
}

async function findArtifacts(files: FilesApi, root: string, workflow: LooseRecord): Promise<Workflow["artifacts"]> {
  const created = text(workflow.created).slice(0, 10);
  const dirHash = text(workflow.dirHash);
  if (!created || !dirHash) return [];
  const workflowRoot = join(root, `.stelow/${created}/${dirHash}`);
  let paths: string[] = [];
  try {
    const result = await files.listPaths({ path: workflowRoot, includeFiles: true, includeDirectories: false });
    paths = array(record(result).paths).map((entry) => typeof entry === "string" ? entry : text(record(entry).path)).filter(Boolean);
  } catch {
    return [];
  }
  const receipts = new Set<string>();
  try {
    const receiptResult = await files.listPaths({ path: join(root, `.stelow/approvals/${dirHash}`), includeFiles: true, includeDirectories: false });
    for (const entry of array(record(receiptResult).paths)) receipts.add(typeof entry === "string" ? entry.split("/").pop()! : text(record(entry).path).split("/").pop()!);
  } catch { /* no approvals yet */ }

  return paths
    .filter((path) => path.endsWith(".md"))
    .map((path) => {
      const relative = path.startsWith(root) ? path.slice(root.length + 1) : `.stelow/${created}/${dirHash}/${path.replace(/^\//, "")}`;
      const filename = relative.split("/").pop() ?? relative;
      const kind: Workflow["artifacts"][number]["kind"] = filename.startsWith("spec-product") ? "product-spec"
        : filename.startsWith("interfaces") ? "interfaces"
        : filename.startsWith("spec-tech") ? "tech-plan"
        : filename.includes("critique") ? "critique" : "other";
      const receipt = kind === "product-spec" ? GATES.gate.receipt
        : kind === "interfaces" ? GATES["int-gate"].receipt
        : kind === "tech-plan" ? GATES["plan-gate"].receipt : "";
      return { kind, label: filename, path: relative, approved: receipt ? receipts.has(receipt) : false };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

async function loadBoard(bb: BbPluginApi, projectId: string | null) {
  const rootPath = await projectRoot(bb, projectId);
  if (!rootPath) return { rootPath: null, workflows: [], error: projectId ? "Project workspace path is unavailable." : "Select a bb project to view its Stelow board." };
  return boardFromRoot(bb, rootPath);
}

// Board scoped to an explicit workspace root (project source, or a single
// exploratory card dir). onlyDirHash restricts the listing to one workflow —
// used when a card worker asks for status: its project's source root holds no
// stelow.json (each exploratory card owns its own file), so resolving by
// project alone yields a misleading "not found".
async function boardFromRoot(bb: BbPluginApi, rootPath: string, onlyDirHash?: string | null) {
  const trackingPath = join(rootPath, "stelow.json");
  const tracking = await readJson(bb.sdk.files, trackingPath);
  if (!tracking) return { rootPath, workflows: [], error: `No stelow.json found (looked in ${trackingPath}). Start a Stelow workflow first — card workers: your file lives in your own state dir, not the project root.` };
  const entries = array(tracking.workflows).filter((value) => !onlyDirHash || text(record(value).dirHash) === onlyDirHash);
  if (onlyDirHash && entries.length === 0) return { rootPath, workflows: [], error: `No workflow ${onlyDirHash} in ${trackingPath}. The card may have been reseeded — read the state dir from your spawn prompt.` };

  const workflows: Workflow[] = [];
  for (const [index, value] of entries.entries()) {
    const raw = record(value);
    const config = record(raw.config);
    const stage = record(raw.stage);
    const phases = array(raw.phases).map((entry, phaseIndex) => {
      const phase = record(entry);
      return {
        id: text(phase.id, `phase-${phaseIndex + 1}`),
        name: text(phase.name, text(phase.id, `Phase ${phaseIndex + 1}`)),
        status: normalizeStatus(phase.status),
      };
    });
    // Each workflow owns its own state.md (per-card); read it for the real
    // stage instead of a single project-level stateStage.
    let workflowStage = "";
    const dirHash = text(raw.dirHash);
    if (dirHash) {
      const created = text(raw.created).slice(0, 10);
      if (created) {
        try {
          const stateBlob = await bb.sdk.files.read({ path: join(rootPath, `.stelow/${created}/${dirHash}/state.md`) });
          workflowStage = text(stateBlob.content.match(/current_stage:\s*(\S+)/)?.[1]);
        } catch { /* no per-workflow state yet */ }
      }
    }
    workflows.push({
      id: text(raw.dirHash, text(raw.name, `workflow-${index + 1}`)),
      name: text(raw.name, `Workflow ${index + 1}`),
      description: text(raw.description),
      status: normalizeStatus(raw.status),
      stage: workflowStage || text(stage.current_stage, phases.find((phase) => phase.status === "in-progress")?.name ?? "Not started"),
      appetite: text(config.appetite, "Core"),
      reviewMode: text(config.review_mode, "Auto"),
      ...(typeof raw.dirHash === "string" ? { dirHash: raw.dirHash } : {}),
      ...(typeof raw.cwd === "string" ? { cwd: raw.cwd } : {}),
      phases,
      scopes: workflowScopes(raw),
      artifacts: await findArtifacts(bb.sdk.files, rootPath, raw),
    });
  }
  return { rootPath, workflows, error: null };
}

export default async function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      intent TEXT NOT NULL,
      status TEXT NOT NULL,
      stage TEXT NOT NULL,
      activity TEXT NOT NULL,
      worker_thread_id TEXT,
      worker_preset_id TEXT,
      dir_hash TEXT,
      attachments TEXT NOT NULL DEFAULT '[]',
      last_error TEXT,
      last_assistant_text TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      target TEXT NOT NULL,
      target_id TEXT NOT NULL,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_comments_card ON comments(card_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      reasoning_level TEXT NOT NULL,
      permission_mode TEXT NOT NULL CHECK (permission_mode IN ('accept-edits','auto','full')),
      environment_kind TEXT NOT NULL DEFAULT 'project-default' CHECK (environment_kind IN ('project-default','new-worktree')),
      base_branch TEXT,
      machine_id TEXT,
      instructions TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      built_in INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS card_presets (
      card_id TEXT PRIMARY KEY,
      preset_id TEXT NOT NULL,
      assigned_at INTEGER NOT NULL,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
      FOREIGN KEY (preset_id) REFERENCES presets(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS expired_questions (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      question TEXT NOT NULL,
      multiple INTEGER NOT NULL DEFAULT 0,
      options TEXT NOT NULL,
      expired_at INTEGER NOT NULL,
      answered INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    )`,
  ]);

  const cardColumns = db.prepare("PRAGMA table_info(cards)").all() as Array<{ name: string }>;
  // markCardSeen (viewing clears attention) was deliberately removed: viewing
  // is not resolving, and the columns sat permanently NULL. Drop them where
  // they exist; the attention checks below read presence, not timestamps.
  // Fail-soft like the skills sync: leftover columns are harmless (nothing
  // references them), but a failed plugin load is not.
  for (const column of ["last_seen_completed_at", "last_seen_error_at", "last_seen_question_at"]) {
    if (cardColumns.some((entry) => entry.name === column)) {
      try {
        db.exec(`ALTER TABLE cards DROP COLUMN ${column}`);
      } catch (error) {
        bb.log.warn(`stelow: could not drop ${column} (harmless): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  if (!cardColumns.some((column) => column.name === "display_name")) {
    db.exec("ALTER TABLE cards ADD COLUMN display_name TEXT");
  }
  if (!cardColumns.some((column) => column.name === "last_idle_at")) {
    db.exec("ALTER TABLE cards ADD COLUMN last_idle_at INTEGER");
  }
  if (!cardColumns.some((column) => column.name === "dir_hash")) {
    db.exec("ALTER TABLE cards ADD COLUMN dir_hash TEXT");
  }
  if (!cardColumns.some((column) => column.name === "worker_preset_id")) {
    db.exec("ALTER TABLE cards ADD COLUMN worker_preset_id TEXT");
  }
  if (!cardColumns.some((column) => column.name === "preset_restart_pending")) {
    db.exec("ALTER TABLE cards ADD COLUMN preset_restart_pending INTEGER NOT NULL DEFAULT 0");
  }
  if (!cardColumns.some((column) => column.name === "attachments")) {
    db.exec("ALTER TABLE cards ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]'");
  }
  if (!cardColumns.some((column) => column.name === "workspace_kind")) {
    db.exec("ALTER TABLE cards ADD COLUMN workspace_kind TEXT NOT NULL DEFAULT 'project'");
  }
  if (!cardColumns.some((column) => column.name === "workspace_path")) {
    db.exec("ALTER TABLE cards ADD COLUMN workspace_path TEXT");
  }
  if (!cardColumns.some((column) => column.name === "workspace_host_id")) {
    db.exec("ALTER TABLE cards ADD COLUMN workspace_host_id TEXT");
  }
  if (!cardColumns.some((column) => column.name === "kind")) {
    db.exec("ALTER TABLE cards ADD COLUMN kind TEXT NOT NULL DEFAULT 'delivery'");
  }
  if (!cardColumns.some((column) => column.name === "research_strategy")) {
    db.exec("ALTER TABLE cards ADD COLUMN research_strategy TEXT");
  }
  if (!cardColumns.some((column) => column.name === "research_strategies")) {
    db.exec("ALTER TABLE cards ADD COLUMN research_strategies TEXT");
  }
  // stage_presets may not be applied by bb.storage.migrate on existing DBs,
  // so ensure it idempotently here as well.
  db.exec(`CREATE TABLE IF NOT EXISTS stage_presets (
    band TEXT PRIMARY KEY CHECK (band IN ('analysis','planning','execution','review')),
    preset_id TEXT NOT NULL,
    assigned_at INTEGER NOT NULL,
    FOREIGN KEY (preset_id) REFERENCES presets(id) ON DELETE CASCADE
  )`);
  // This table is deliberately created outside the historical migration array:
  // older local installations have different recorded migration lengths.
  db.exec(`CREATE TABLE IF NOT EXISTS inbox_events (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('question','error','paused','completed')),
    summary TEXT NOT NULL,
    dedupe_key TEXT NOT NULL UNIQUE,
    occurred_at INTEGER NOT NULL,
    read_at INTEGER,
    archived_at INTEGER,
    resolved_at INTEGER,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_inbox_events_visible ON inbox_events(archived_at, occurred_at DESC);`);
  const inboxColumns = db.prepare("PRAGMA table_info(inbox_events)").all() as Array<{ name: string }>;
  if (!inboxColumns.some((column) => column.name === "resolved_at")) db.exec("ALTER TABLE inbox_events ADD COLUMN resolved_at INTEGER");

  // card_threads is the worker ledger: one row per worker thread a card has
  // ever had (initial spawn, band-swap / manual restarts, reseeds). Old rows
  // stay as history; the open row (ended_at NULL) is the current worker.
  // Threads themselves are archived+hidden on replacement, so the list UI
  // never pollutes — this table is the auditable memory of it.
  db.exec(`CREATE TABLE IF NOT EXISTS card_threads (
    thread_id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    preset_id TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    ended_reason TEXT,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_card_threads_card ON card_threads(card_id, started_at DESC);`);

  // github_imports tracks which tagged GitHub issues have been pulled into
  // cards. Created outside the historical migration array (the recorded
  // _bb_migrations has a legacy-unknown sentinel at id 6), matching the
  // stage_presets / inbox_events pattern.
  db.exec(`CREATE TABLE IF NOT EXISTS github_imports (
    issue_key TEXT PRIMARY KEY,
    repo TEXT NOT NULL,
    number INTEGER NOT NULL,
    label TEXT NOT NULL,
    card_id TEXT,
    imported_at INTEGER NOT NULL,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_github_imports_label ON github_imports(label);`);

  const presetColumns = db.prepare("PRAGMA table_info(presets)").all() as Array<{ name: string }>;
  if (!presetColumns.some((column) => column.name === "environment_kind")) {
    db.exec("ALTER TABLE presets ADD COLUMN environment_kind TEXT NOT NULL DEFAULT 'project-default'");
  }
  if (!presetColumns.some((column) => column.name === "base_branch")) {
    db.exec("ALTER TABLE presets ADD COLUMN base_branch TEXT");
  }
  if (!presetColumns.some((column) => column.name === "machine_id")) {
    db.exec("ALTER TABLE presets ADD COLUMN machine_id TEXT");
  }

  // v0.1.5's preset form sent an empty string instead of null for a new
  // preset. SQLite accepts that as a primary key, but React treats it as
  // falsey and can no longer distinguish editing it from creating a new one.
  // Give any affected row a real id and preserve its card/phase assignments.
  const legacyBlankPreset = db.prepare("SELECT * FROM presets WHERE id = ''").get() as PresetRow | undefined;
  if (legacyBlankPreset) {
    const replacementId = `preset_${Math.random().toString(36).slice(2, 10)}`;
    const temporaryName = `__stelow_migrating_${Date.now()}__`;
    db.transaction(() => {
      // Free the unique name before copying the legacy row under its new id.
      db.prepare("UPDATE presets SET name = ? WHERE id = ''").run(temporaryName);
      db.prepare("INSERT INTO presets (id, name, provider_id, model_id, reasoning_level, permission_mode, environment_kind, base_branch, machine_id, instructions, is_default, built_in, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
        replacementId, legacyBlankPreset.name, legacyBlankPreset.provider_id, legacyBlankPreset.model_id, legacyBlankPreset.reasoning_level, legacyBlankPreset.permission_mode, legacyBlankPreset.environment_kind, legacyBlankPreset.base_branch, legacyBlankPreset.machine_id, legacyBlankPreset.instructions, legacyBlankPreset.is_default, legacyBlankPreset.built_in, legacyBlankPreset.created_at, legacyBlankPreset.updated_at,
      );
      db.prepare("UPDATE card_presets SET preset_id = ? WHERE preset_id = ''").run(replacementId);
      db.prepare("UPDATE stage_presets SET preset_id = ? WHERE preset_id = ''").run(replacementId);
      db.prepare("DELETE FROM presets WHERE id = ''").run();
    })();
  }

  const defaultPresetId = "preset_default";
  const existingDefault = db.prepare("SELECT * FROM presets WHERE id = ?").get(defaultPresetId) as PresetRow | undefined;
  if (existingDefault) {
    // Migrate the built-in default preset: codex is not installed on this host;
    // the pi provider routes to Bifrost harness-coding.
    if (existingDefault.provider_id === "codex") {
      db.prepare("UPDATE presets SET provider_id = ?, model_id = ?, permission_mode = ?, updated_at = ? WHERE id = ?").run("pi", "bifrost/harness-coding", "full", now(), defaultPresetId);
    } else if (existingDefault.permission_mode !== "full" && existingDefault.provider_id === "pi") {
      // pi only supports full permission mode.
      db.prepare("UPDATE presets SET permission_mode = ?, updated_at = ? WHERE id = ?").run("full", now(), defaultPresetId);
    }
  } else {
    db.prepare("INSERT INTO presets (id, name, provider_id, model_id, reasoning_level, permission_mode, environment_kind, instructions, is_default, built_in, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      defaultPresetId, "Default", "pi", "bifrost/harness-coding", "medium", "full", "project-default", "", 1, 1, now(), now(),
    );
  }
  // Drop non-built-in presets that reference codex (unusable without the Codex CLI).
  db.prepare("DELETE FROM presets WHERE built_in = 0 AND provider_id = 'codex'").run();

  function now(): number { return Date.now(); }
  function randomId(prefix: string): string { return `${prefix}_${Math.random().toString(36).slice(2, 10)}`; }

  // Thin typed wrapper over the builtin `github` plugin's RPC. The github
  // plugin owns its auth/sync/cache; Stelow only reads tagged issues and
  // (optionally) clears the tag after import. Requires the github plugin to be
  // running (bb plugin list shows it); if absent, calls reject and we surface
  // that as a clear error rather than a silent no-op.
  const g = {
    status: () =>
      bb.sdk.plugins.callRpc<{ ghOk: boolean; ghState: string; repos: Array<{ repo: string; projectId: string | null }>; lastSyncedAt: string | null }>({
        pluginId: "github",
        method: "status",
        input: null,
        outputSchema: z.any(),
      }),
    listItems: (input: { kind?: "issue" | "pr"; state?: "open" | "closed"; repo?: string }) =>
      bb.sdk.plugins.callRpc<{ items: Array<{ repo: string; number: number; kind: string; title: string; state: string; author: string; labels: string[]; url: string; body: string; updatedAt: string }> }>({
        pluginId: "github",
        method: "listItems",
        input: { state: "open", ...input },
        outputSchema: z.any(),
      }),
    getIssue: (input: { repo: string; number: number }) =>
      bb.sdk.plugins.callRpc<{ issue: { repo: string; number: number; title: string; state: string; author: string; body: string; labels: string[]; url: string; updatedAt: string; comments: Array<{ author: string; body: string; createdAt: string }> } }>({
        pluginId: "github",
        method: "getIssue",
        input,
        outputSchema: z.any(),
      }),
    setLabels: (input: { repo: string; number: number; labels: string[] }) =>
      bb.sdk.plugins.callRpc<{ ok: boolean; labels: string[] }>({
        pluginId: "github",
        method: "setLabels",
        input,
        outputSchema: z.any(),
      }),
  };

  // A curated issue reference for the card prompt, so the worker reads the
  // issue without re-fetching GitHub. Body + comments give the triage context.
  function githubIssuePrompt(issue: { repo: string; number: number; title: string; author: string; body: string; url: string; labels: string[] }, comments: Array<{ author: string; body: string; createdAt: string }> = []): string {
    const lines = [
      `GitHub issue ${issue.repo}#${issue.number}: ${issue.title}`,
      `Author: ${issue.author}`,
      `Labels: ${issue.labels.join(", ") || "none"}`,
      `URL: ${issue.url}`,
      "",
      issue.body.trim() ? `Description:\n${issue.body.trim()}` : "(no description)",
    ];
    if (comments.length > 0) {
      lines.push("", "Comments:");
      for (const comment of comments) lines.push(`- ${comment.author}: ${comment.body.trim()}`);
    }
    return lines.join("\n");
  }

  // Availability + auth of the builtin `github` plugin. Distinguishes the three
  // cases the UI cares about: plugin not installed (callRpc rejects), installed
  // but not authenticated (ghOk false), or ready. Never throws.
  async function githubStatusResolved() {
    try {
      const status = await g.status();
      return { ok: true, pluginAvailable: true, ghOk: Boolean(status.ghOk), repos: status.repos ?? [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const pluginMissing = /plugin.*(not.*found|missing|unavailable)|github.*not/i.test(message);
      return { ok: pluginMissing, pluginAvailable: false, ghOk: false, repos: [] };
    }
  }

  // Shared card-creation path for both the UI "start work" handler and the
  // GitHub import. A Personal-project request gets an isolated persistent
  // exploratory workspace; project cards keep using their declared source.
  //
  // kind "research" runs a stelow-product-* strategy instead of the delivery
  // workflow: no stages, no gates, no advance. The worker writes brief.md
  // (exact shape below) into its own state dir; the user marks Done and
  // fans opportunities out into delivery cards from the plugin UI.
  function researchWorkerPrompt({ displayName, prompt, strategyLabel, strategySkill, stateDirText, workspaceRoot, instructions, flavor, previousThreadId }: { displayName: string; prompt: string; strategyLabel: string; strategySkill: string; stateDirText: string; workspaceRoot: string; instructions: string; flavor: "initial" | "restart" | "reseed" | "append"; previousThreadId: string | null }): string {
    const flavorLine = flavor === "initial"
      ? "This is a fresh research task."
      : flavor === "append"
        ? "A previous strategy round already wrote to brief.md. Load the playbook below and APPEND a new ### section for it — never rewrite, delete, or re-check existing items."
        : flavor === "restart"
          ? "You are being restarted mid-research with a fresh worker. Re-read your brief.md and CONTINUE the research — do not start over unless the brief is empty."
          : "The host re-seeded your state dir: start the research over with a fresh brief.md.";
    return `You are running a Stelow research task inside the bb-plugin-stelow panel. Your work owns its own state dir (${stateDirText}) inside the workspace (${workspaceRoot}). ${flavorLine}${previousThreadId ? ` Previous worker thread: ${previousThreadId} (archived). If the brief is thin, its turn history may hold missing context; retrieve it with \`bb thread output ${previousThreadId}\`.` : ""}

Step 1 — load the strategy playbook: the ${strategyLabel} method (${strategySkill}) comes from the stelow repo via the agent skills hub (\`npx skills add calionauta/stelow\`). Use \`bb skill list\` to confirm it, then follow that playbook — not the stelow-workflow-* delivery skills, which do not apply here.

Step 2 — research the request below inside this workspace. You may read code, docs, and the web; you MUST NOT write product code or open pull requests. Research only.

Step 3 — write your findings to <state-dir>/brief.md (create it) in EXACTLY this shape (headings verbatim, opportunities as checkboxes — the plugin parses them deterministically for fan-out):

    # Research brief: ${displayName}
    Strategy: ${strategyLabel}
    ## Findings
    <what you learned, concise>
    ## Opportunities
    ### ${strategyLabel} — <today's YYYY-MM-DD date>
    - [ ] <opportunity title> — <one-line why it matters>

Unchecked boxes mean "available for fan-out". NEVER check a box yourself — the plugin checks the ones the user turns into work cards. If you run another strategy later, APPEND a new ### section under ## Opportunities; never rewrite existing items.

Step 4 — register the brief as an artifact so it renders on the card: append EXACTLY this block to <state-dir>/state.md (create the artifacts: section if missing; path is relative to the workspace root ${workspaceRoot}):

    artifacts:
      - stage: research
        kind: document
        path: <brief.md path relative to ${workspaceRoot}>
        label: Research brief

CRITICAL — User input contract:
ANY time you need user input, you MUST call the structured form, NEVER just write text like "waiting for your choice":

    bb stelow ask --thread <this_thread_id> \\
      --question "<a single clear question>" \\
      --option "<label 1>" --option "<label 2>" [--multiple]

On timeout ("No response after Ns"), STOP and wait — the question stays answerable on the card. Never re-ask the same question. There are no stages and no gates here: NEVER run \`bb stelow advance\`. When the brief is complete with ranked opportunities, STOP and end your turn — the user reviews the brief, marks the card Done, and fans opportunities out into delivery cards. Stop early when the user archives the card.

${instructions ? `Preset instructions:\n${instructions}\n` : ""}Request:
${prompt}`;
  }

  async function createCardInternal({ projectId, environment, prompt, attachments, intent, appetite, reviewMode, presetId, kind, strategy }: { projectId: string; environment?: unknown; prompt: string; attachments: Array<{ path: string; type: "localFile" | "localImage" }>; intent: string; appetite: string; reviewMode: string; presetId?: string | null; kind?: "delivery" | "research"; strategy?: string | null }): Promise<{ cardId: string; threadId: string }> {
    const project = await bb.sdk.projects.get({ projectId }).catch(() => null);
    // The composer submits the Personal project id for “Don't work in a
    // project”. Some SDK project reads omit its `kind`, so accept its stable
    // id as well as the documented kind marker.
    const isExploratory = projectId === "proj_personal" || project?.kind === "personal";
    const source = project?.sources.find((entry) => entry.isDefault) ?? project?.sources[0];
    if (!isExploratory && !source?.path) throw new Error("Project workspace path is unavailable.");
    const cardId = randomId("card");
    const environmentRecord = environment && typeof environment === "object" ? environment as Record<string, unknown> : {};
    const requestedHostId = typeof environmentRecord.hostId === "string" ? environmentRecord.hostId : null;
    const hosts = await bb.sdk.hosts.list();
    // The plugin's synchronous filesystem operations run on this host. BB's
    // public host contract does not identify it, so only accept the sole host.
    if (isExploratory && hosts.length !== 1) {
      throw new Error("Exploratory work currently requires a single local BB host.");
    }
    const localHostId = hosts[0]?.id ?? null;
    if (isExploratory && requestedHostId && requestedHostId !== localHostId) {
      throw new Error("Exploratory work currently requires the local host.");
    }
    const exploratoryHostId = localHostId;
    const rootPath = isExploratory
      ? nodeJoin(process.env.HOME ?? "/tmp", ".bb", "stelow", "exploratory", cardId)
      : source?.path;
    let workspaceProjectId = projectId;
    let workspaceSource: { path: string; hostId: string } | undefined = source ? { path: source.path, hostId: source.hostId } : undefined;
    if (isExploratory && rootPath && exploratoryHostId) {
      mkdirSync(rootPath, { recursive: true });
      const existing = (await bb.sdk.projects.list()).find((entry) => entry.name === "Stelow exploratory work" && entry.sources.some((candidate) => candidate.hostId === exploratoryHostId && candidate.path === nodeJoin(process.env.HOME ?? "/tmp", ".bb", "stelow", "exploratory")));
      const exploratoryProject = existing ?? await bb.sdk.projects.create({ name: "Stelow exploratory work", source: { type: "local_path", hostId: exploratoryHostId, path: nodeJoin(process.env.HOME ?? "/tmp", ".bb", "stelow", "exploratory") } });
      workspaceProjectId = exploratoryProject.id;
      workspaceSource = { path: rootPath, hostId: exploratoryHostId };
    }
    if (!rootPath || !workspaceSource) throw new Error("A workspace path is unavailable for this work.");
    const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "stelow";
    const displayName = prompt.replace(/\s+/g, " ").trim().split(/\s+/).slice(0, 8).join(" ").slice(0, 60) || slug;
    const isResearch = kind === "research";
    const researchStrategy = isResearch ? researchStrategyById(strategy ?? "") : null;
    if (isResearch && !researchStrategy) {
      throw new Error(`Unknown research strategy "${strategy ?? ""}". Pick one of: ${RESEARCH_STRATEGIES.map((entry) => entry.id).join(", ")}.`);
    }
    const initialIntent = isResearch ? "investigate" : "unknown";
    const seed = await seedWorkflow(bb, rootPath, slug, initialIntent, appetite, reviewMode);
    if (seed.error) throw new Error(seed.error);
    const preset = presetId ? (getPresetById(presetId) ?? getDefaultPreset()) : getDefaultPreset();
    const analysisRow = db.prepare("SELECT preset_id FROM stage_presets WHERE band = 'analysis'").get() as { preset_id: string } | undefined;
    const spawnPreset = analysisRow ? (getPresetById(analysisRow.preset_id) ?? preset) : preset;
    const params = presetAttachmentParams(spawnPreset);
    const workerAttachments = attachments.map((attachment) => ({ type: attachment.type, path: attachment.path }));
    // BB requires Personal-project threads to retain a `personal` workspace.
    // Exploratory work therefore uses one Stelow-owned project with a local source.
    const workerProjectId = workspaceProjectId;
    const researchPrompt = isResearch && researchStrategy ? researchWorkerPrompt({
      displayName,
      prompt,
      strategyLabel: researchStrategy.label,
      strategySkill: researchStrategy.skill,
      stateDirText: text(seed.stateDir ?? "<project>/.stelow/<date>/<dirHash>"),
      workspaceRoot: rootPath,
      instructions: params.instructions,
      flavor: "initial",
      previousThreadId: null,
    }) : null;
    const thread = await bb.sdk.threads.spawn({
      projectId: workerProjectId,
      environment: workerEnvironment(workspaceSource, params, isExploratory),
      visibility: "hidden",
      title: `Stelow: ${displayName}`,
      providerId: params.providerId,
      model: params.modelId,
      reasoningLevel: params.reasoningLevel as "low" | "medium" | "high" | "xhigh" | "max" | "none" | "ultra" | "ultracode",
      permissionMode: params.permissionMode as "accept-edits" | "auto" | "full",
      executionInputSources: { providerId: "explicit", model: "explicit", reasoningLevel: "explicit", permissionMode: "explicit" },
      input: [{ type: "text", mentions: [], text: researchPrompt ?? `You are running a Stelow workflow inside the bb-plugin-stelow panel. Your workflow owns its own state dir (${text(seed.stateDir ?? "<project>/.stelow/<date>/<dirHash>")}) — its state.md holds name, intent, current_stage, status.

Step 1 — classify intent first: this work item starts as intent=\`unknown\` (no intent picker exists at creation, so every card starts here). Read the request, pick the fitting intent (new-product, feature, bugfix, refactor, investigate) and write it to state.md immediately so the card updates in real time. Ask one concise question via the form below only when genuinely ambiguous. Do NOT load phase skills or do product work before intent is settled. Appetite=\`${appetite}\` and review mode=\`${reviewMode}\` are already recorded in state.md — use them, never re-ask.

Order of work, always: (1) triage — settle intent and record it in state.md; (2) load the workflow skills; (3) advance stages and do the work. If a \`bb stelow\` command fails, read its stderr once and continue the workflow — do NOT spend the turn debugging the CLI; report the exact error and move on.

Load the workflow skills first (stelow-workflow-entry, stelow-workflow-router, stelow-workflow-* via \`bb skill list\`). Use \`bb stelow advance <stage>\` to change stages (do NOT hand-edit current_stage). Preserve every gate (product, interface, tech plan, diff).

CRITICAL — User input contract:
ANY time you need user input, you MUST call the structured form, NEVER just write text like "waiting for your choice":

    bb stelow ask --thread <this_thread_id> \\
      --question "<a single clear question>" \\
      --option "<label 1>" --option "<label 2>" [--option "<label 3>" ...] [--multiple]

Before asking, summarize what you read so the user can answer with context. Do not skip triage; do not start shaping before triage is settled. Each ask blocks until answered; the card moves to "Gate pending" automatically. On timeout ("No response after Ns"), STOP and wait — the question stays answerable on the card and the answer arrives as a message. Never re-ask the same question. Interface-pick discipline: check review_mode in state.md first. Auto and Product Spec Gate mean LLM decides (pick your hybrid recommendation yourself, save selected-interface.md, advance; never park waiting for a human pick). Only Product Spec plus Interface Gates and above wait for a human choice. Gate-tool fallback: if visual_review is unavailable in this host, do NOT park in chat waiting. In Auto, write the approval receipt yourself (.stelow/approvals/{dirHash}/{file}.approved.md) and advance; in gated modes, open a structured ask instead. Stop when the user archives the card or the workflow reaches \`audit\`.

${params.instructions ? `Preset instructions:\n${params.instructions}\n` : ""}Request:
${prompt}` }, ...workerAttachments],
    });
    const ts = now();
    db.prepare("INSERT INTO cards (id, project_id, name, display_name, prompt, intent, status, stage, activity, worker_thread_id, worker_preset_id, dir_hash, attachments, workspace_kind, workspace_path, workspace_host_id, kind, research_strategy, research_strategies, last_error, last_assistant_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(cardId, workspaceProjectId, slug, displayName, prompt, initialIntent, isResearch ? "pending" : "draft", isResearch ? "research" : "triage", "running", thread.id, spawnPreset.id, seed.dirHash, JSON.stringify(attachments), isExploratory ? "exploratory" : "project", isExploratory ? rootPath : null, isExploratory ? workspaceSource.hostId : null, isResearch ? "research" : "delivery", researchStrategy?.id ?? null, isResearch && researchStrategy ? JSON.stringify([researchStrategy.id]) : null, null, null, ts, ts);
    // NOTE: no card_presets row here on purpose. An override row means "the
    // user explicitly pinned this card", and writing the spawn default as one
    // would mislabel every fresh card as overridden (and trip staleness).
    recordWorkerThread(db, cardId, thread.id, spawnPreset.id, "initial");
    if (seed.dirHash) void recordWorkflowLineage(rootPath, seed.dirHash, thread.id, spawnPreset.id, "initial");
    // Delivery remembers the user's planning depth / review mode for the next
    // card. Research carries fixed Lean/Auto internals that must never
    // clobber those delivery defaults.
    if (!isResearch) await bb.storage.kv.set("board-workflow-defaults", { appetite, reviewMode });
    bb.realtime.publish("card-state", { cardId });
    return { cardId, threadId: thread.id };
  }

  type CardRow = { id: string; project_id: string; name: string; display_name: string | null; prompt: string; intent: string; status: string; stage: string; activity: string; worker_thread_id: string | null; worker_preset_id: string | null; preset_restart_pending: number | null; dir_hash: string | null; attachments: string; workspace_kind: "project" | "exploratory"; workspace_path: string | null; workspace_host_id: string | null; kind: "delivery" | "research"; research_strategy: string | null; research_strategies: string | null; last_error: string | null; last_assistant_text: string | null; last_idle_at: number | null; created_at: number; updated_at: number };
  type CommentRow = { id: string; card_id: string; target: string; target_id: string; author: string; body: string; created_at: number };
  type InboxEventRow = { id: string; card_id: string; kind: "question" | "error" | "paused" | "completed"; summary: string; occurred_at: number; read_at: number | null; archived_at: number | null; resolved_at: number | null };
  type PresetRow = {
    id: string; name: string; provider_id: string; model_id: string; reasoning_level: string;
    permission_mode: string; environment_kind: string; base_branch: string | null; machine_id: string | null;
    instructions: string; is_default: number; built_in: number; created_at: number; updated_at: number;
  };

  function getDefaultPreset(): PresetRow {
    const row = db.prepare("SELECT * FROM presets WHERE is_default = 1 ORDER BY created_at ASC LIMIT 1").get() as PresetRow | undefined;
    if (row) return row;
    const fallback = db.prepare("SELECT * FROM presets ORDER BY created_at ASC LIMIT 1").get() as PresetRow | undefined;
    if (fallback) return fallback;
    db.prepare("INSERT INTO presets (id, name, provider_id, model_id, reasoning_level, permission_mode, environment_kind, instructions, is_default, built_in, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      "preset_default", "Default", "pi", "bifrost/harness-coding", "medium", "full", "project-default", "", 1, 1, now(), now(),
    );
    return db.prepare("SELECT * FROM presets WHERE id = ?").get("preset_default") as PresetRow;
  }

  function getPresetById(id: string): PresetRow | null {
    const row = db.prepare("SELECT * FROM presets WHERE id = ?").get(id) as PresetRow | undefined;
    return row ?? null;
  }

  function getPresetForCard(cardId: string): PresetRow {
    const row = db.prepare("SELECT preset_id FROM card_presets WHERE card_id = ?").get(cardId) as { preset_id: string } | undefined;
    if (!row) return getDefaultPreset();
    const preset = getPresetById(row.preset_id);
    return preset ?? getDefaultPreset();
  }

  // Resolve the worker preset for a stage band. An explicit per-card override
  // (set in the card's Agent preset section, e.g. to escape a quota error)
  // wins over the band policy: explicit + later beats phase default. Without
  // an override, a configured band preset applies, else the card/board default.
  function getPresetForBand(band: string, cardId: string): PresetRow {
    const override = db.prepare("SELECT preset_id FROM card_presets WHERE card_id = ?").get(cardId) as { preset_id: string } | undefined;
    if (override) {
      const pinned = getPresetById(override.preset_id);
      if (pinned) return pinned;
    }
    const row = db.prepare("SELECT preset_id FROM stage_presets WHERE band = ?").get(band) as { preset_id: string } | undefined;
    if (!row) return getPresetForCard(cardId);
    const preset = getPresetById(row.preset_id);
    return preset ?? getPresetForCard(cardId);
  }

  function presetAttachmentParams(preset: PresetRow): { providerId: string; modelId: string; reasoningLevel: string; permissionMode: string; environmentKind: string; baseBranch: string | null; machineId: string | null; instructions: string } {
    return {
      providerId: preset.provider_id,
      modelId: preset.model_id,
      reasoningLevel: preset.reasoning_level,
      permissionMode: preset.permission_mode,
      environmentKind: preset.environment_kind,
      baseBranch: preset.base_branch,
      machineId: preset.machine_id,
      instructions: preset.instructions,
    };
  }

  // Respawn a card's worker with a new preset at a band boundary. Kept on the
  // same per-workflow state dir (dir_hash) so the new worker re-reads the
  // already-advanced state.md and continues from the current stage — no context
  // is re-created or reset. The old worker is archived/stopped by this helper.
  async function respawnWorkerForBand(cardId: string, presetId: string, endedReason = "band-swap", opts?: { strategyId?: string; flavor?: "restart" | "append" }): Promise<{ ok: boolean; error?: string; threadId?: string }> {
    const row = getCard(cardId);
    if (!row) return { ok: false, error: ERR_CARD_NOT_FOUND };
    const preset = getPresetById(presetId);
    if (!preset) return { ok: false, error: ERR_PRESET_NOT_FOUND };
    const params = presetAttachmentParams(preset);
    const workspace = await cardWorkspace(row);
    const projectPath = workspace?.path ?? "";
    const source = workspace?.hostId ? { path: workspace.path, hostId: workspace.hostId } : null;
    // Resolve the real per-workflow state dir (stelow.json -> created date), so
    // the respawned worker is told the correct path — never a guessed date.
    let stateDir: string | null = null;
    if (row.dir_hash && projectPath) {
      stateDir = await workflowStateDir(bb, projectPath, row.dir_hash).catch(() => null);
    }
    const stateHint = stateDir ?? (row.dir_hash ? ".stelow/<date>/" + row.dir_hash : "<project>/.stelow/<date>/<dirHash>");
    // Research cards restart with the strategy prompt, never the delivery
    // stage machine. The run strategy defaults to the latest round; a new
    // round passes its own. A research card without a known strategy cannot
    // restart honestly — refuse with the fix instead of spawning a confused
    // worker.
    const history = strategyList(row);
    const runStrategyId = row.kind === "research" ? (opts?.strategyId ?? history[history.length - 1] ?? row.research_strategy ?? "") : null;
    const researchStrategy = row.kind === "research" ? researchStrategyById(runStrategyId ?? "") : null;
    if (row.kind === "research" && !researchStrategy) return { ok: false, error: "This research has no known strategy. Archive it and start a new one." };
    const researchRestart = researchStrategy ? researchWorkerPrompt({
      displayName: row.display_name ?? row.name,
      prompt: row.prompt,
      strategyLabel: researchStrategy.label,
      strategySkill: researchStrategy.skill,
      stateDirText: text(stateHint),
      workspaceRoot: projectPath || "<workspace>",
      instructions: params.instructions,
      flavor: opts?.flavor ?? "restart",
      previousThreadId: row.worker_thread_id,
    }) : null;
    try {
      const newThread = await bb.sdk.threads.spawn({
        projectId: row.project_id,
        environment: source ? workerEnvironment(source, params, row.workspace_kind === "exploratory") : { type: "project-default" },
        visibility: "hidden",
        title: `Stelow: ${row.display_name ?? row.name}`,
        providerId: params.providerId,
        model: params.modelId,
        reasoningLevel: params.reasoningLevel as "low" | "medium" | "high" | "xhigh" | "max" | "none" | "ultra" | "ultracode",
        permissionMode: params.permissionMode as "accept-edits" | "auto" | "full",
        executionInputSources: { providerId: "explicit", model: "explicit", reasoningLevel: "explicit", permissionMode: "explicit" },
        prompt: researchRestart ?? `You are running a Stelow workflow inside the bb-plugin-stelow panel. The host re-seeded your per-workflow state, transitions.md, and stelow.json. Your workflow owns its own state dir (${text(stateHint)}) — its state.md holds name, intent, current_stage, status.${stateDir ? "" : " Resolve the exact path from stelow.json; its state.md holds name, intent, current_stage, status."} The Stelow workflow skills (stelow-workflow-entry, stelow-workflow-router, stelow-workflow-*) are provided by this plugin — start by loading them (they live under the plugin's skills directory; \`bb skill list\` shows them). The product strategy playbooks (stelow-product-*) come from the stelow repo via the agent skills hub (\`npx skills add calionauta/stelow\`). Use \`bb stelow advance <stage>\` to change stages (do NOT hand-edit current_stage). Preserve every gate (product, interface, tech plan, diff).

Intent is currently \`${row.intent}\` in state.md. ${row.intent === "unknown" ? "It is still unknown, so your FIRST job is triage: classify it (new-product, feature, bugfix, refactor, or investigate), write it to state.md immediately, and only then continue — ask via the form below only if genuinely ambiguous." : "Use it — do NOT ask the user to pick or confirm intent again."} Order of work, always: (1) settle intent; (2) load the workflow skills; (3) continue from the current stage. If a \`bb stelow\` command fails, read its stderr once and continue — do NOT spend the turn debugging the CLI; report the exact error and move on.

You are being restarted mid-workflow at a stage boundary so a new preset can take over for this phase. Read your state.md and transitions.md, and CONTINUE the workflow from the current stage. Do not restart from triage; do not re-confirm what is already settled in state.md. Pick up exactly where the workflow left off.${row.worker_thread_id ? ` Previous worker thread: ${row.worker_thread_id} (archived, same project). If state.md is thin — e.g. the previous worker stalled silently — its turn history may hold the missing context; retrieve it with \`bb thread output ${row.worker_thread_id}\`.` : ""}

CRITICAL — User input contract:
ANY time you need user input, you MUST call the structured form:

    bb stelow ask --thread <this_thread_id> \\\\
      --question "<a single clear question>" \\\\
      --option "<label 1>" --option "<label 2>" [--option "<label 3>" ...] [--multiple]

Before asking a question, first summarize what you read (files, plan, codebase) so the user can answer with context. Each bb stelow ask call blocks until the user submits; the card moves to the "Gate pending" column automatically. Never re-ask the same question. Interface-pick discipline: check review_mode in state.md first. Auto and Product Spec Gate mean LLM decides (pick your hybrid recommendation yourself, save selected-interface.md, advance; never park waiting for a human pick). Only Product Spec plus Interface Gates and above wait for a human choice. Gate-tool fallback: if visual_review is unavailable in this host, do NOT park in chat waiting. In Auto, write the approval receipt yourself (.stelow/approvals/{dirHash}/{file}.approved.md) and advance; in gated modes, open a structured ask instead. Stop when the user archives the card or the workflow reaches \`audit\`.

${params.instructions ? `Preset instructions:\n${params.instructions}\n` : ""}Request:\n${row.prompt}`,
      });
      // The new worker is live — only now retire the old one (archive+stop), so a
      // spawn failure never leaves the card with no worker. If the old worker is
      // the one that just called advance, it has already returned its CLI output.
      if (row.worker_thread_id) {
        try { await bb.sdk.threads.archive({ threadId: row.worker_thread_id }); } catch { /* ignore */ }
        try { await bb.sdk.threads.stop({ threadId: row.worker_thread_id }); } catch { /* ignore */ }
      }
      const ts = now();
      updateCard(cardId, { worker_thread_id: newThread.id, worker_preset_id: preset.id, preset_restart_pending: 0, activity: "running", last_error: null, updated_at: ts });
      recordWorkerThread(db, cardId, newThread.id, preset.id, endedReason);
      if (row.dir_hash) void recordWorkflowLineage(projectPath, row.dir_hash, newThread.id, preset.id, endedReason);
      // Official inline mention of the archived predecessor (not just copied
      // text): renders as a chip the user can open, and the worker can expand
      // it natively for context state.md doesn't carry. Best-effort — the
      // prompt text already references the thread id.
      if (row.worker_thread_id) {
        try {
          const tag = "@previous-worker";
          const mentionText = `Continuity link — ${tag} is the archived worker this thread replaces. Consult it if state.md is thin.`;
          const start = mentionText.indexOf(tag);
          await bb.sdk.threads.send({ threadId: newThread.id, mode: "auto", input: [{ type: "text", text: mentionText, mentions: [{ start, end: start + tag.length, resource: { kind: "thread", label: `Stelow: ${row.display_name ?? row.name} (previous)`, threadId: row.worker_thread_id, projectId: row.project_id } }] }] });
        } catch { /* mention nicety; prompt reference suffices */ }
      }
      return { ok: true, threadId: newThread.id };
    } catch (error) {
      // Spawn failed — surface it instead of leaving a silent zombie card.
      const msg = error instanceof Error ? error.message : "Respawn failed.";
      updateCard(cardId, { activity: "error", last_error: msg });
      return { ok: false, error: msg };
    }
  }

  async function cardWorkspace(card: CardRow): Promise<{ path: string; hostId: string | null } | null> {
    if (card.workspace_kind === "exploratory") {
      return card.workspace_path ? { path: card.workspace_path, hostId: card.workspace_host_id } : null;
    }
    const project = await bb.sdk.projects.get({ projectId: card.project_id }).catch(() => null);
    const source = project?.sources.find((entry) => entry.isDefault) ?? project?.sources[0];
    return source?.path ? { path: source.path, hostId: source.hostId } : null;
  }

  // Resolve the research brief file for a card: always the card's own state
  // dir (never the project root, so many research cards can share one
  // project without colliding). Every refusal names its exit.
  async function readResearchBrief(card: CardRow): Promise<{ ok: false; error: string } | { ok: true; content: string; absolute: string; display: string }> {
    const workspace = await cardWorkspace(card);
    if (!workspace?.path) return { ok: false, error: ERR_WORKSPACE_UNAVAILABLE };
    if (!card.dir_hash) return { ok: false, error: "No workflow state for this research yet." };
    const stateDir = await workflowStateDir(bb, workspace.path, card.dir_hash).catch(() => null);
    if (!stateDir) return { ok: false, error: "No workflow state for this research yet." };
    const absolute = join(stateDir, "brief.md");
    const content = await bb.sdk.files.read({ path: absolute }).then((file) => file.content).catch(() => null);
    if (content === null) return { ok: false, error: "No brief.md yet — the research is still running." };
    return { ok: true, content, absolute, display: workspaceRelative(workspace.path, absolute) ?? "brief.md" };
  }

  // Research cards have no stages: sync only worker activity and attention.
  // A freshly-spawned research worker moves To-Do (pending) to Doing
  // (in-progress) on its first active poll — work visibly began. Done is
  // always a human drag after reviewing the brief, never automatic.
  async function syncResearchThreadState(card: CardRow): Promise<void> {
    try {
      const thread = await bb.sdk.threads.get({ threadId: card.worker_thread_id! });
      const status = thread.status as string;
      try {
        const threadBorn = (thread as { createdAt?: number }).createdAt;
        healPresetStaleness(db, card.id, threadBorn, card.preset_restart_pending);
      } catch { /* staleness stays best-effort */ }
      const lastOutput = (await bb.sdk.threads.output({ threadId: card.worker_thread_id! }).catch(() => null))?.output ?? null;
      if (status === "active" || status === "starting") {
        const pending = await fetchPendingQuestions(card.worker_thread_id);
        if (pending.length > 0) {
          updateCard(card.id, { activity: "awaiting-answer", last_assistant_text: lastOutput, status: "awaiting-answer" });
        } else {
          resolveInboxEvents(card.id, now(), ["question"]);
          const updates: Record<string, unknown> = { activity: "running" as const, last_assistant_text: lastOutput };
          if (card.status === "pending") updates.status = "in-progress";
          updateCard(card.id, updates);
        }
      } else if (status === "idle" || status === "stopping") {
        const expiredPending = db.prepare("SELECT id FROM expired_questions WHERE card_id = ? AND answered = 0").get(card.id) as { id: string } | undefined;
        if (expiredPending) {
          updateCard(card.id, { activity: "awaiting-answer", last_assistant_text: lastOutput });
        } else {
          const idleAt = (card.activity !== "idle" || !card.last_idle_at) ? now() : card.last_idle_at;
          updateCard(card.id, { activity: "idle", last_assistant_text: lastOutput, last_idle_at: idleAt });
          const current = getCard(card.id);
          if (current && current.status !== "archived" && current.status !== "completed" && idleAt && now() - idleAt >= IDLE_ATTENTION_MS) {
            recordInboxEvent(current, "paused", "Idle with unfinished research — retry continues in place, restart begins fresh.", `paused:${card.id}:${idleAt}`, idleAt);
          }
        }
        if (lastOutput && lastOutput !== card.last_assistant_text) {
          logCardComment(card.id, "card", card.id, "agent", lastOutput);
        }
      } else if (status === "failed" || status === "error") {
        updateCard(card.id, { activity: "error" });
      }
    } catch (error) {
      updateCard(card.id, { activity: "error", last_error: error instanceof Error ? error.message : "Unable to read worker thread." });
    }
  }
  // Mirror the card_threads ledger into the workflow's own stelow.json
  // (upstream "Worker Lineage" contract): survives plugin database loss and
  // is readable by any host and by the worker itself. Best-effort — a failed
  // lineage write must never break a spawn, reseed, or restart.
  async function recordWorkflowLineage(rootPath: string, dirHash: string, threadId: string, presetId: string | null, endedReason: string): Promise<void> {
    try {
      const trackingPath = join(rootPath, "stelow.json");
      await writeMergedFile(bb.sdk.files, trackingPath, rootPath, (existing) => mergeLineageFile(existing, dirHash, { threadId, presetId, endedReason }));
    } catch { /* audit-only */ }
  }

  function getCard(cardId: string): CardRow | undefined {
    return db.prepare("SELECT * FROM cards WHERE id = ?").get(cardId) as CardRow | undefined;
  }

  // Shared refusal copy: identical wording everywhere so the same failure
  // reads the same on every surface, fixed in one place.
  const ERR_CARD_NOT_FOUND = "Card not found.";
  const ERR_CARD_ARCHIVED = "This card is archived.";
  const ERR_WORKSPACE_UNAVAILABLE = "Workspace is unavailable.";
  const ERR_PRESET_NOT_FOUND = "Preset not found.";

  // Single writer for card conversation rows (agent trail, user notes,
  // worker transitions). Returns the comment id for callers that reference it.
  function logCardComment(cardId: string, target: string, targetId: string, author: "user" | "agent", body: string): string {
    const commentId = randomId("cmt");
    db.prepare("INSERT INTO comments (id, card_id, target, target_id, author, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(commentId, cardId, target, targetId, author, body, now());
    return commentId;
  }

  // Ordered strategy history for a research card (first = primary).
  function strategyList(row: Pick<CardRow, "research_strategies" | "research_strategy">): string[] {
    return parseStrategyList(row.research_strategies, row.research_strategy);
  }

  function getCardByWorkerThread(threadId: string): CardRow | undefined {
    return db.prepare("SELECT * FROM cards WHERE worker_thread_id = ?").get(threadId) as CardRow | undefined;
  }
  function updateCard(cardId: string, fields: Partial<Omit<CardRow, "id" | "project_id" | "intent" | "prompt" | "name" | "created_at">>): void {
    // Hot-reload race: bb closes the plugin DB while syncThreadState callbacks
    // are still in flight; writing then crashes the whole server process.
    if (!(db as unknown as { open?: boolean }).open) return;
    const previous = getCard(cardId);
    const next = { updated_at: now(), ...fields };
    const keys = Object.keys(next);
    if (keys.length === 0) return;
    db.prepare(`UPDATE cards SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE id = @id`).run({ id: cardId, ...next });
    const current = getCard(cardId);
    if (previous && current) {
      if (current.status === "archived" || current.status === "completed") resolveInboxEvents(cardId, current.updated_at);
      else if (current.activity === "running") resolveInboxEvents(cardId, current.updated_at, ["error", "paused"]);
      if (previous.status !== "completed" && current.status === "completed") recordInboxEvent(current, "completed", "Work completed. Review the final outcome.", `completed:${cardId}:${current.updated_at}`, current.updated_at);
      if (previous.activity !== "error" && current.activity === "error") recordInboxEvent(current, "error", current.last_error || "Worker failed and needs attention.", `error:${cardId}:${current.updated_at}`, current.updated_at);
      if (previous.activity !== "awaiting-answer" && current.activity === "awaiting-answer") recordInboxEvent(current, "question", "The agent is waiting for your answer to continue.", `question:${cardId}:${current.updated_at}`, current.updated_at);
    }
    bb.realtime.publish("card-state", { cardId });
  }

  function recordInboxEvent(card: CardRow, kind: InboxEventRow["kind"], summary: string, dedupeKey: string, occurredAt: number): void {
    if (insertInboxEvent(db, { id: randomId("evt"), cardId: card.id, kind, summary, dedupeKey, occurredAt })) {
      bb.realtime.publish("inbox-changed", { cardId: card.id });
    }
  }

  // Resolution is per-kind, never blanket: a worker moving again clears
  // failure/pause signals, but a question stays until it is answered.
  function resolveInboxEvents(cardId: string, resolvedAt: number, kinds: Array<"question" | "error" | "paused"> = ["question", "error", "paused"]): void {
    if (resolveActionInboxEvents(db, cardId, resolvedAt, kinds) > 0) bb.realtime.publish("inbox-changed", { cardId });
  }

  async function fetchPendingQuestions(threadId: string | null): Promise<Awaited<ReturnType<typeof rpcContract.cardDetail.output.parse>>["pendingQuestions"]> {
    if (!threadId) return [];
    try {
      const list = await bb.sdk.threads.interactions.list({ threadId });
      return list
        .filter((entry): entry is Extract<typeof entry, { origin: { kind: "plugin" } }> => entry.origin?.kind === "plugin" && entry.status === "pending")
        .map((entry) => {
          const data = record(entry.payload?.data);
          const options = array(data.options).map((option) => ({ label: text(record(option).label, ""), description: text(record(option).description, "") }));
          return {
            id: entry.id,
            title: text(entry.payload?.title, "Question"),
            question: text(data.question, ""),
            multiple: Boolean(data.multiple),
            options,
            expiresAt: typeof entry.expiresAt === "number" ? entry.expiresAt : null,
          };
        });
    } catch { return []; }
  }

  const INTENT_VALUES = ["new-product", "feature", "bugfix", "refactor", "investigate"] as const;

  async function syncThreadState(cardId: string): Promise<void> {
    const card = getCard(cardId);
    if (!card?.worker_thread_id) return;
    if (card.kind === "research") {
      await syncResearchThreadState(card);
      return;
    }
    try {
      // Resolve this card's own per-workflow state file (not a shared root state.md).
      const workspace = await cardWorkspace(card);
      const projectPath = workspace?.path ?? null;
      const stateBlob = await (async () => {
        if (!projectPath) return null;
        if (card.dir_hash) {
          const stateDir = await workflowStateDir(bb, projectPath, card.dir_hash);
          if (stateDir) {
            return await bb.sdk.files.read({ path: join(stateDir, "state.md") }).then((f) => f.content).catch(() => null);
          }
        }
        return await bb.sdk.files.read({ path: join(projectPath, "state.md") }).then((f) => f.content).catch(() => null);
      })();

      // Sync intent from state.md if the agent recorded a decision during triage.
      if (card.intent === "unknown" && stateBlob) {
        const stateName = text(stateBlob.match(/^name:\s*(\S+)/m)?.[1]);
        const stateIntent = text(stateBlob.match(/^intent:\s*(\S+)/m)?.[1]);
        // Only adopt the intent if this state.md belongs to this card.
        if (stateName === card.name && stateIntent && (INTENT_VALUES as readonly string[]).includes(stateIntent)) {
          const ts = now();
          db.prepare("UPDATE cards SET intent = ?, updated_at = ? WHERE id = ?").run(stateIntent, ts, cardId);
        }
      }
      const thread = await bb.sdk.threads.get({ threadId: card.worker_thread_id });
      const status = thread.status as string;
      // Self-heal stale preset flags: a thread spawned BEFORE the current
      // override was assigned provably predates it (covers legacy rows where
      // worker_preset_id claims the override but the thread is ancestral).
      // Never clears here — only spawn paths clear, so a flagged card keeps
      // offering Restart until it actually happens.
      try {
        const threadBorn = (thread as { createdAt?: number }).createdAt;
        healPresetStaleness(db, cardId, threadBorn, card.preset_restart_pending);
      } catch { /* staleness stays best-effort; id comparison below still applies */ }
      const lastOutput = (await bb.sdk.threads.output({ threadId: card.worker_thread_id }).catch(() => null))?.output ?? null;
      // Stage source of truth is state.md (the agent advances it via `bb stelow
      // advance`); the DB `stage` is only written by the manual advanceCard RPC.
      let currentStage = card.stage;
      if (stateBlob) {
        currentStage = text(stateBlob.match(/current_stage:\s*(\S+)/m)?.[1]) || card.stage;
      }
      if (status === "active" || status === "starting") {
        const pending = await fetchPendingQuestions(card.worker_thread_id);
        if (pending.length > 0) {
          updateCard(cardId, { activity: "awaiting-answer", last_assistant_text: lastOutput, status: "awaiting-answer" });
        } else {
          // The worker moved on with nothing pending: any question event still
          // open for this card is stale (answered elsewhere or superseded).
          resolveInboxEvents(cardId, now(), ["question"]);
          // Keep freshly-created cards in the Triage column (draft) while the
          // workflow is still at the triage stage, even though the thread is
          // already active. Only move to Running (in-progress) once the agent
          // has advanced past triage (current_stage != triage) or resumed from
          // a gate (status was awaiting-answer).
          const stillTriaging = currentStage === "triage" && card.status === "draft";
          const nextStatus = stillTriaging ? "draft" : card.status === "draft" ? "in-progress" : card.status;
          const updates: Record<string, unknown> = { activity: "running" as const, last_assistant_text: lastOutput, status: nextStatus };
          if (currentStage !== card.stage) updates.stage = currentStage;
          updateCard(cardId, updates);
        }
      } else if (status === "idle" || status === "stopping") {
        const expiredPending = db.prepare("SELECT id FROM expired_questions WHERE card_id = ? AND answered = 0").get(cardId) as { id: string } | undefined;
        const transitioningIntoIdle = card.activity !== "idle";
        if (expiredPending) {
          // The worker stopped (likely a timed-out ask) but a question is
          // still unanswered. Keep the question surfaced via activity, but the
          // card stays in its real stage column (no Gate-pending column) —
          // the attention flag from listCards/cardDetail signals it. Answering
          // on the card resumes the thread.
          updateCard(cardId, { activity: "awaiting-answer", last_assistant_text: lastOutput });
        } else if (currentStage === "audit") {
          // `audit` is the workflow's terminal stage. Reaching it is not a
          // request for a human review: in Lean + Auto (and after any explicit
          // gates in other modes) the worker finishes its audit and idles.
          // Leaving the card in-progress would place it in Review and then
          // falsely raise "Paused — resume it" after the idle grace period.
          updateCard(cardId, { status: "completed", activity: "idle", last_assistant_text: lastOutput, last_idle_at: now(), last_error: null, stage: currentStage });
        } else {
          // Backfill last_idle_at on the first poll that observes an already-idle
          // card missing it (legacy cards idled before the column existed), so
          // it starts its own idle-stuck clock instead of falling through.
          // Suspicious idle: the worker just stopped (running -> idle) yet
          // produced no new output, no question, and no stage progress. That
          // is a manual stop or a stall — never a routine between-turn rest,
          // which always leaves fresh output behind. Skip the grace period so
          // the card signals paused immediately instead of saying "nothing
          // needs you" for 90s. Guarded to cards that have worked before, so
          // a brand-new worker still gets its grace.
          // A failed output read is "unknown", not "no progress": never backdate
          // on lastOutput == null or a flaky read would false-positive.
          const noProgress = transitioningIntoIdle
            && card.last_assistant_text != null
            && lastOutput != null
            && lastOutput === card.last_assistant_text;
          const backfillIdle = transitioningIntoIdle || !card.last_idle_at;
          const idleAt = noProgress ? now() - IDLE_ATTENTION_MS : backfillIdle ? now() : card.last_idle_at;
          if (noProgress) {
            // Once per idle period (transition edge only): leave a trail so
            // repeated silent stops are visible in Conversation, not just as
            // identical paused banners.
            logCardComment(cardId, "card", cardId, "agent", "Worker stopped with no new output — treated as paused. If this repeats, inspect the thread before retrying: a silent stop usually means the worker is waiting on input it never asked for.");
          }
          updateCard(cardId, { activity: "idle", last_assistant_text: lastOutput, last_idle_at: idleAt });
          // The Inbox must be driven by lifecycle transitions, never by a UI
          // read. The scheduled sync revisits idle cards after the grace
          // period, producing exactly one durable event per idle period.
          const current = getCard(cardId);
          if (current && current.status !== "archived" && current.status !== "completed" && idleAt && now() - idleAt >= IDLE_ATTENTION_MS) {
            recordInboxEvent(current, "paused", "Idle with unfinished work — retry continues in place, restart begins fresh.", `paused:${cardId}:${idleAt}`, idleAt);
          }
        }
        if (lastOutput && lastOutput !== card.last_assistant_text) {
          logCardComment(cardId, "card", cardId, "agent", lastOutput);
        }
      } else if (status === "failed" || status === "error") {
        // Mark the failure without touching last_error: a specific cause
        // already recorded (e.g. from the thread.failed event) must survive,
        // and a content-free generic message next to the Failed pill reads
        // as duplication, so none is ever written here.
        updateCard(cardId, { activity: "error" });
      }
    } catch (error) {
      updateCard(cardId, { activity: "error", last_error: error instanceof Error ? error.message : "Unable to read worker thread." });
    }
  }

  bb.events.on("thread.idle", ({ thread }) => {
    const row = db.prepare("SELECT id FROM cards WHERE worker_thread_id = ?").get(thread.id) as { id: string } | undefined;
    if (row) void syncThreadState(row.id);
  });
  bb.events.on("thread.active", ({ thread }) => {
    const row = db.prepare("SELECT id FROM cards WHERE worker_thread_id = ?").get(thread.id) as { id: string } | undefined;
    if (row) void syncThreadState(row.id);
  });
  bb.events.on("thread.failed", ({ thread, error }) => {
    const row = db.prepare("SELECT id FROM cards WHERE worker_thread_id = ?").get(thread.id) as { id: string } | undefined;
    if (!row) return;
    // Only a specific cause is worth storing. A null/empty event error means
    // "failed for unknown reasons" — the activity pill already says Failed,
    // so writing a generic sentence would duplicate it on every surface.
    if (error) updateCard(row.id, { activity: "error", last_error: error });
    else updateCard(row.id, { activity: "error" });
  });
  // Reconcile card states with their worker threads after reloads (events only fire on transitions).
  const liveCards = db.prepare("SELECT id FROM cards WHERE worker_thread_id IS NOT NULL AND status != 'archived'").all() as Array<{ id: string }>;
  for (const row of liveCards) void syncThreadState(row.id);

  // Deterministic sweep (bb 0.40 removed system/thread/interrupted from the
  // plugin event API): periodically reconcile live cards so interrupts,
  // missed transitions and stale states self-heal without event delivery.
  const RECONCILE_MS = 45_000;
  // An idle card needs attention only after it has sat idle continuously for
  // this long (two reconcile cycles). A worker that just finished a turn is
  // idle for a few seconds before being resumed — not an attention item.
  const IDLE_ATTENTION_MS = 90_000;
  const reconcileTimer = setInterval(() => {
    if (!(db as unknown as { open?: boolean }).open) return;
    try {
      const rows = db.prepare("SELECT id FROM cards WHERE worker_thread_id IS NOT NULL AND status != 'archived'").all() as Array<{ id: string }>;
      for (const row of rows) void syncThreadState(row.id);
    } catch { /* db closed during reload; next tick retries */ }
  }, RECONCILE_MS);
  bb.onDispose(async () => clearInterval(reconcileTimer));

  // Workflow mechanics are private to workers created by the Work panel.
  // Manifest skills are static registrations in BB, so configure() is the
  // boundary that keeps them out of every other thread/session.
  bb.agents.configure((context) => ({
    tools: [],
    skills: context.thread.title?.startsWith("Stelow: ") ? [...WORKFLOW_SKILLS] : [],
  }));

  // Auto-sync the vendored Stelow workflow skills from the calionauta/stelow
  // repo. Runs every 6h; fail-soft (network issues just log, never break the
  // plugin). Product playbooks are NOT vendored — workers consume them from the
  // agent skills hub (npx skills add calionauta/stelow).
  const SKILLS_SYNC_CRON = process.env.STELOW_SKILLS_SYNC_CRON ?? "33 */6 * * *";
  bb.background.schedule("stelow-skills-sync", SKILLS_SYNC_CRON, async () => {
    try {
      await syncWorkflowSkills(PLUGIN_SKILLS_DIR, { log: (m) => bb.log.info(m) });
    } catch (e) {
      bb.log.warn(`stelow-skills-sync failed (fail-soft): ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  // NOTE: a previous revision stopped every live worker thread here. Removed:
  // dispose fires on every hot-reload (dev + build:reload), so it massacred
  // in-flight work with a "Stopped manually" on each update. Workers now
  // survive reloads; boot reconcile re-syncs their state, and a truly dead
  // plugin surfaces as an honest worker error on the next bb stelow call.

  bb.rpc.register(rpcContract, {
    board: async ({ projectId }) => {
      const board = await loadBoard(bb, projectId);
      const githubStatus = await githubStatusResolved().catch(() => ({ ok: false, pluginAvailable: false, ghOk: false, repos: [] }));
      return { ...board, githubStatus };
    },
    projects: async () => {
      const list = await bb.sdk.projects.list();
      return { projects: list.map((project) => ({ id: project.id, name: project.name })) };
    },
    async boardWorkflowDefaults() {
      const stored = await bb.storage.kv.get<unknown>("board-workflow-defaults");
      const parsed = boardWorkflowDefaultsSchema.safeParse(stored);
      return parsed.success ? parsed.data : { appetite: "Lean" as const, reviewMode: "Auto" as const };
    },

    async approveGate({ projectId, workflowId, gate }) {
      // Resolve via the owning card first: the project-root board has no
      // stelow.json for exploratory work, so board-only lookup fails there.
      // dir_hash is unique per card, hence a reliable key for both modes.
      const owner = db.prepare("SELECT * FROM cards WHERE dir_hash = ?").get(workflowId) as CardRow | undefined;
      const board = owner
        ? await (async () => {
          const workspace = await cardWorkspace(owner);
          if (!workspace?.path) return { rootPath: null as string | null, workflows: [] as Workflow[], error: "Workspace is unavailable for this card." };
          return boardFromRoot(bb, workspace.path, owner.dir_hash);
        })()
        : await loadBoard(bb, projectId);
      const workflow = board.workflows.find((item) => item.id === workflowId);
      if (!board.rootPath || !workflow?.dirHash) return { approved: false, receiptPath: null, error: "Workflow directory metadata is unavailable." };
      const spec = GATES[gate];
      if (gate !== "diff-gate" && !workflow.artifacts.some((artifact) => artifact.kind === spec.artifact)) {
        return { approved: false, receiptPath: null, error: "The gate artifact does not exist yet." };
      }
      const receiptPath = `.stelow/approvals/${workflow.dirHash}/${spec.receipt}`;
      const absolute = join(board.rootPath, receiptPath);
      await bb.sdk.files.mkdir({ path: join(board.rootPath, `.stelow/approvals/${workflow.dirHash}`), rootPath: board.rootPath, recursive: true });
      const now = new Date().toISOString();
      const result = await bb.sdk.files.write({
        path: absolute,
        rootPath: board.rootPath,
        expectedSha256: null,
        content: `---\napproved: true\napproved_at: ${now}\napproved_via: bb-plugin-stelow\ngate: ${gate}\nworkflow: ${workflow.name}\n---\n`,
      });
      if (result.outcome === "conflict") return { approved: true, receiptPath, error: null };
      bb.realtime.publish("board-changed", { workflowId, gate });
      return { approved: true, receiptPath, error: null };
    },

    async ask({ threadId, title, question, multiple, options }) {
      const result = await bb.ui.requestInput({ threadId, rendererId: "stelow-question", title, payload: { question, multiple, options } });
      if (result.outcome === "cancelled") return { outcome: "cancelled" as const, answers: [] };
      const value = record(result.value);
      return { outcome: "submitted" as const, answers: array(value.answers).filter((answer): answer is string => typeof answer === "string") };
    },

    async answerQuestion({ cardId, answers }) {
      const card = getCard(cardId);
      if (!card?.worker_thread_id) return { ok: false as const, error: "This card has no worker thread." };
      try {
        const list = await bb.sdk.threads.interactions.list({ threadId: card.worker_thread_id });
        const pending = list.find((entry) => entry.origin?.kind === "plugin" && entry.status === "pending");
        if (!pending) return { ok: false as const, error: "No open question awaits an answer on this card." };
        await bb.sdk.threads.interactions.respond({ threadId: card.worker_thread_id, interactionId: pending.id, value: { answers } });
        // A structured interaction resumes the waiting command but not a new
        // agent turn. Send an explicit continuation so the worker proceeds.
        await bb.sdk.threads.send({ threadId: card.worker_thread_id, mode: "auto", input: [{ type: "text", text: `The user answered: ${answers.join(", ")}. Continue the workflow now: persist the decision, advance the appropriate stage with bb stelow advance, and keep working.`, mentions: [] }] });
        updateCard(cardId, { activity: "running", status: "in-progress" });
        resolveInboxEvents(cardId, now(), ["question"]);
        return { ok: true as const, error: null };
      } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : "Unable to answer the question." };
      }
    },

    async startWorkflow({ projectId, prompt }) {
      const thread = await bb.sdk.threads.spawn({
        projectId,
        environment: { type: "project-default" },
        title: `Stelow: ${prompt.slice(0, 70)}`,
        prompt: `Use the stelow workflow to shape and execute this request. The Stelow workflow skills (stelow-workflow-entry, stelow-workflow-router, stelow-workflow-*) are provided by bb-plugin-stelow — load them first. The product strategy playbooks (stelow-product-*) come from the stelow repo via the agent skills hub (\`npx skills add calionauta/stelow\`). Use \`bb stelow advance <stage>\` to change stages; do NOT hand-write stage transitions. Preserve every gate (product, interface, tech plan, diff).\n\nRequest:\n${prompt}`,
      });
      return { threadId: thread.id };
    },

    async ensureWorkflow({ projectId, name, intent }) {
      const rootPath = await projectRoot(bb, projectId);
      if (!rootPath) return { rootPath: null, statePath: null, error: "Project workspace path is unavailable." };
      const result = await seedWorkflow(bb, rootPath, name, intent);
      if (result.error) return { rootPath, statePath: null, error: result.error };
      bb.realtime.publish("board-changed", { reason: "seeded" });
      return { rootPath, statePath: result.statePath, error: null };
    },

    async listGithubCandidates({ label }) {
      // Safely reject when the github plugin is not available so the UI can
      // show a real reason instead of an empty list. The wrapper's rejection
      // message carries the pluginId/method for the user.
      const items = await g.listItems({ kind: "issue", state: "open" }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "GitHub plugin unavailable";
        throw new Error(`GitHub import unavailable: ${message}`);
      });
      // Resolve each issue to the bb project that owns its repo (GitHub plugin
      // maps repo -> projectId from git remotes), so the UI needs no project
      // picker. Unmapped repos fall back to the caller's active project.
      const status = await githubStatusResolved().catch(() => ({ repos: [] as Array<{ repo: string; projectId: string | null }> }));
      const repoToProject = new Map(status.repos.map((entry) => [entry.repo, entry.projectId]));
      const issues = items.items
        .filter((item) => item.labels.includes(label))
        .sort((a, b) => Number(b.number) - Number(a.number));
      return {
        issues: issues.map((issue) => {
          const key = `${issue.repo}#${issue.number}`;
          const link = db.prepare("SELECT card_id, imported_at FROM github_imports WHERE issue_key = ?").get(key) as { card_id: string | null; imported_at: number } | undefined;
          const card = link?.card_id ? (getCard(link.card_id) ?? null) : null;
          return {
            repo: issue.repo,
            number: issue.number,
            title: issue.title,
            labels: issue.labels,
            author: issue.author,
            url: issue.url,
            body: issue.body,
            updatedAt: issue.updatedAt,
            projectId: repoToProject.get(issue.repo) ?? null,
            alreadyImported: Boolean(link),
            cardId: card?.id ?? null,
            cardName: card ? (card.display_name ?? card.name) : null,
          };
        }),
      };
    },

    async importGithubIssue({ projectId, repo, number: numberValue, label, intent }) {
      const key = `${repo}#${numberValue}`;
      const existing = db.prepare("SELECT card_id, imported_at FROM github_imports WHERE issue_key = ?").get(key) as { card_id: string | null; imported_at: number } | undefined;
      if (existing?.card_id) {
        const card = getCard(existing.card_id);
        if (card) return { ok: true, cardId: card.id, skipped: "already-imported", error: null };
      }
      // Resolve the owning project from the repo (fall back to the caller's
      // active project) when the caller didn't pass one explicitly.
      let resolvedProjectId = projectId;
      if (!resolvedProjectId) {
        const status = await githubStatusResolved().catch(() => ({ repos: [] as Array<{ repo: string; projectId: string | null }> }));
        const match = status.repos.find((entry) => entry.repo === repo);
        resolvedProjectId = match?.projectId ?? null;
      }
      if (!resolvedProjectId) throw new Error(`Cannot determine the bb project for repo ${repo}; open it as a project in bb first.`);
      // Pull live detail (body + comments) to seed the card prompt.
      const { issue } = await g.getIssue({ repo, number: numberValue }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "GitHub plugin unavailable";
        throw new Error(`GitHub import unavailable: ${message}`);
      });
      const prompt = githubIssuePrompt(issue, issue.comments);
      const card = await createCardInternal({ projectId: resolvedProjectId, prompt, attachments: [], intent, appetite: "Lean", reviewMode: "Auto" });
      const cardId = card.cardId;
      const ts = now();
      db.prepare("INSERT OR REPLACE INTO github_imports (issue_key, repo, number, label, card_id, imported_at) VALUES (?, ?, ?, ?, ?, ?)").run(key, repo, numberValue, label, cardId, ts);
      // Clear the stelow tag after import so the loop is pull-once: the issue is
      // now tracked by its card, and re-importing would just find the card.
      // Best-effort: a failure to clear the label is not fatal to the import.
      await g.setLabels({ repo, number: numberValue, labels: issue.labels.filter((item) => item !== label) }).catch(() => {});
      bb.realtime.publish("card-state", { cardId });
      return { ok: true, cardId, skipped: null, error: null };
    },

    async listCards({ projectId, kind }) {
      const stmt = projectId && kind
        ? db.prepare("SELECT * FROM cards WHERE project_id = ? AND kind = ? ORDER BY updated_at DESC")
        : projectId
          ? db.prepare("SELECT * FROM cards WHERE project_id = ? ORDER BY updated_at DESC")
          : kind
            ? db.prepare("SELECT * FROM cards WHERE kind = ? ORDER BY updated_at DESC")
            : db.prepare("SELECT * FROM cards ORDER BY updated_at DESC");
      const rows = (projectId && kind ? stmt.all(projectId, kind) : projectId ? stmt.all(projectId) : kind ? stmt.all(kind) : stmt.all()) as CardRow[];
      const projectsList = await bb.sdk.projects.list();
      const projectMap = new Map(projectsList.map((project) => [project.id, project.name]));
      // Scope summaries share one workspace read per root: many cards can sit
      // in the same project, and stelow.json parsing is pure local IO.
      const scopeCache = new Map<string, { scopesTotal: number; scopesDone: number; tasksTotal: number; tasksDone: number }>();
      const emptySummary = { scopesTotal: 0, scopesDone: 0, tasksTotal: 0, tasksDone: 0 };
      async function scopeSummary(row: CardRow): Promise<typeof emptySummary> {
        try {
          const workspace = await cardWorkspace(row);
          if (!workspace?.path) return emptySummary;
          const cached = scopeCache.get(workspace.path);
          if (cached) return cached;
          const done = (status: string): boolean => ["done", "completed"].includes(status);
          const scopes = loadCardScopes(workspace.path, row.name);
          const summary = {
            scopesTotal: scopes.length,
            scopesDone: scopes.filter((scope) => done(scope.status)).length,
            tasksTotal: scopes.reduce((total, scope) => total + scope.tasks.length, 0),
            tasksDone: scopes.reduce((total, scope) => total + scope.tasks.filter((task) => done(task.status)).length, 0),
          };
          scopeCache.set(workspace.path, summary);
          return summary;
        } catch {
          return emptySummary;
        }
      }
      const enriched = await Promise.all(rows.map(async (row) => {
        let activity = row.activity as "idle" | "running" | "awaiting-answer" | "error";        if (activity !== "error" && row.worker_thread_id) {
          // A pending stelow ask interaction must surface regardless of whether
          // the thread currently reports running or idle: an ask parks the card
          // until answered, and idle (vs "waiting") is indistinguishable from a
          // prompt otherwise. Promote to awaiting-answer so the question shows.
          const pending = await fetchPendingQuestions(row.worker_thread_id);
          if (pending.length > 0) activity = "awaiting-answer";
        }
        // Unified attention signal: ONE flag answering "does this card need a
        // human right now?", plus the reason (kind) that decides the primary
        // action (answer / inspect / retake). A terminal completion is not a
        // request for human action; idle-stuck, question and error are.
        const termStatus = ["completed", "archived", "blocked"].includes(normalizeStatus(row.status));
        // Idle-stuck uses last_idle_at when present (set on transition into
        // idle). For cards that were already idle before that column existed
        // (legacy), fall back to updated_at as the idle-onset proxy so they
        // still surface as needing attention instead of staying invisible.
        const idleAt = (row.last_idle_at && row.last_idle_at > 0) ? row.last_idle_at : row.updated_at;
        const idleStuck = activity === "idle"
          && row.worker_thread_id !== null
          && !termStatus
          && now() - idleAt >= IDLE_ATTENTION_MS;
        const questionPending = activity === "awaiting-answer";
        const errorPending = Boolean(row.last_error) || activity === "error";
        const attentionKind = (idleStuck ? "idle" : questionPending ? "question" : errorPending ? "error" : null) as "question" | "error" | "idle" | null;
        const needsAttention = attentionKind !== null;
        const preset = getPresetForBand(STAGE_TO_BAND[row.stage] ?? "analysis", row.id);
        return {
          id: row.id,
          name: row.name,
          displayName: row.display_name ?? row.name,
          prompt: row.prompt,
          intent: row.intent,
          projectId: row.project_id,
          projectName: row.workspace_kind === "exploratory" ? "Exploratory work" : (projectMap.get(row.project_id) ?? row.project_id),
          workspaceKind: row.workspace_kind,
          workspacePath: row.workspace_path,
          kind: (row.kind === "research" ? "research" : "delivery") as "delivery" | "research",
          researchStrategy: row.research_strategy,
          researchStrategies: strategyList(row),
          status: normalizeStatus(row.status),
          stage: row.stage,
          workerThreadId: row.worker_thread_id,
          activity,
          lastError: row.last_error,
          needsAttention,
          presetName: preset.name,
          presetProviderId: preset.provider_id,
          presetModelId: preset.model_id,
          updatedAt: row.updated_at,
          stallCount: stallCount(db, row.id),
          scopeSummary: await scopeSummary(row),
        };
      }));
      return { cards: enriched };
    },

    async listNotifications({ includeArchived }) {
      const rows = listInboxEvents(db, includeArchived) as Array<InboxEventRow & { display_name: string | null; name: string; project_id: string; card_kind: string | null; resolved_at: number | null }>;
      const projects = await bb.sdk.projects.list();
      const projectNames = new Map(projects.map((project) => [project.id, project.name]));
      return {
        notifications: rows.map((row) => ({ id: row.id, cardId: row.card_id, cardName: row.display_name ?? row.name, projectName: projectNames.get(row.project_id) ?? row.project_id, cardKind: row.card_kind === "research" ? "research" as const : "delivery" as const, kind: row.kind, summary: row.summary, occurredAt: row.occurred_at, readAt: row.read_at, resolvedAt: row.resolved_at ?? null, archivedAt: row.archived_at })),
      };
    },

    async markNotificationRead({ notificationId }) {
      const result = db.prepare("UPDATE inbox_events SET read_at = ? WHERE id = ? AND read_at IS NULL").run(now(), notificationId);
      if (result.changes > 0) bb.realtime.publish("inbox-changed", { notificationId });
      return { ok: result.changes > 0 };
    },

    async markCardNotificationsRead({ cardId, kind }) {
      // Viewing marks informational state seen (read), never resolved.
      // Only completions use this today: opening a Done card clears its
      // "new" badge while the entry stays in Recent updates. Action kinds
      // (question/error/paused) keep counting until resolved, no matter
      // how often the card is opened.
      if (kind !== "completed") return { marked: false };
      const result = db.prepare("UPDATE inbox_events SET read_at = ? WHERE card_id = ? AND kind = 'completed' AND read_at IS NULL AND archived_at IS NULL").run(now(), cardId);
      if (result.changes > 0) bb.realtime.publish("inbox-changed", { cardId });
      return { marked: result.changes > 0 };
    },

    async archiveNotification({ notificationId }) {
      const result = db.prepare("UPDATE inbox_events SET archived_at = ? WHERE id = ? AND archived_at IS NULL").run(now(), notificationId);
      if (result.changes > 0) bb.realtime.publish("inbox-changed", { notificationId });
      return { ok: result.changes > 0 };
    },

    async restoreNotification({ notificationId }) {
      const result = db.prepare("UPDATE inbox_events SET archived_at = NULL WHERE id = ? AND archived_at IS NOT NULL").run(notificationId);
      if (result.changes > 0) bb.realtime.publish("inbox-changed", { notificationId });
      return { ok: result.changes > 0 };
    },

    async cardByWorkerThread({ threadId }) {
      const row = getCardByWorkerThread(threadId);
      if (!row || row.status === "archived") return { cardId: null, kind: null };
      return { cardId: row.id, kind: row.kind === "research" ? "research" as const : "delivery" as const };
    },

    async getNotification({ notificationId, cardId }) {
      const row = db.prepare("SELECT id, kind, summary, occurred_at FROM inbox_events WHERE id = ? AND card_id = ?").get(notificationId, cardId) as { id: string; kind: InboxEventRow["kind"]; summary: string; occurred_at: number } | undefined;
      return { notification: row ? { id: row.id, kind: row.kind, summary: row.summary, occurredAt: row.occurred_at } : null };
    },

    async readCardFile({ cardId, path }) {
      // Read-only artifact viewer backing: resolve strictly inside the card
      // workspace (never absolute escapes), cap output, refuse binaries.
      const card = getCard(cardId);
      if (!card) return { content: null, truncated: false, error: ERR_CARD_NOT_FOUND };
      const workspace = await cardWorkspace(card);
      if (!workspace?.path) return { content: null, truncated: false, error: ERR_WORKSPACE_UNAVAILABLE };
      const full = resolveArtifactPath(workspace.path, path)
        ?? (isAbsolute(path) && !path.split(/[\\/]+/).some((segment) => segment === "..") && relative(workspace.path, resolve(path)).split(/[\\/]+/)[0] !== ".." ? resolve(path) : null);
      if (!full) return { content: null, truncated: false, error: "Path escapes the workspace." };
      try {
        const file = await bb.sdk.files.read({ path: full });
        const text = typeof file.content === "string" ? file.content : null;
        if (text === null || text.includes("\0")) return { content: null, truncated: false, error: "Not a readable text file." };
        const LIMIT = 200_000;
        return { content: text.slice(0, LIMIT), truncated: text.length > LIMIT, error: null };
      } catch {
        return { content: null, truncated: false, error: "Could not read the file." };
      }
    },

    async createCard({ projectId, environment, prompt, attachments, intent, appetite, reviewMode, presetId }) {
      return createCardInternal({ projectId, environment, prompt, attachments, intent, appetite, reviewMode, presetId });
    },

    async cardDetail({ cardId }) {
      const initial = getCard(cardId);
      if (!initial) throw new Error(ERR_CARD_NOT_FOUND);
      // Reconcile with the live thread before reading: a worker stopped from
      // outside (or a missed transition) would otherwise render stale until
      // the next reconcile sweep.
      if (initial.worker_thread_id) await syncThreadState(cardId).catch(() => undefined);
      const card = getCard(cardId);
      if (!card) throw new Error(ERR_CARD_NOT_FOUND);
      const comments = db.prepare("SELECT * FROM comments WHERE card_id = ? ORDER BY created_at ASC").all(cardId) as CommentRow[];
      const pending = await fetchPendingQuestions(card.worker_thread_id);
      const expiredRows = db.prepare("SELECT * FROM expired_questions WHERE card_id = ? AND answered = 0 ORDER BY expired_at DESC").all(cardId) as Array<{ id: string; question: string; multiple: number; options: string; expired_at: number }>;
      const expiredQuestions = expiredRows.map((row) => ({ id: row.id, question: row.question, multiple: Boolean(row.multiple), options: JSON.parse(row.options) as Array<{ label: string; description: string }>, expiredAt: row.expired_at }));
      let projectName = card.project_id;
      const workspace = await cardWorkspace(card);
      let sourcePath: string | null = workspace?.path ?? null;
      let sourceHostId: string | null = workspace?.hostId ?? null;
      if (card.workspace_kind === "project") {
        try { projectName = (await bb.sdk.projects.get({ projectId: card.project_id })).name; } catch { /* project removed; keep card viewable */ }
      }
      const mentionedFiles = (await detectMentionedFiles(bb, sourcePath, card.prompt)).flatMap((file) => sourceHostId ? [{ ...file, hostId: sourceHostId, relPath: sourcePath ? workspaceRelative(sourcePath, file.absolutePath) ?? (isAbsolute(file.path) ? null : file.path) : null }] : []);
      const attachments = cardAttachments(card.attachments).map((attachment) => {
        const absolute = sourcePath ? (isAbsolute(attachment.path) ? attachment.path : join(sourcePath, attachment.path)) : attachment.path;
        return {
          ...attachment,
          display: workspaceRelative(sourcePath ?? "", attachment.path) ?? basename(attachment.path),
          relPath: sourcePath ? workspaceRelative(sourcePath, absolute) : null,
        };
      });
      // Environment backing the worker thread's worktree. Workspace-kind file
      // links resolve against it (verified via thread-open); host-kind links
      // cannot resolve exploratory paths, which sit outside environments.
      const fileEnvironmentId = card.worker_thread_id
        ? await bb.sdk.threads.get({ threadId: card.worker_thread_id }).then((thread) => {
          const environmentId = (thread as { environmentId?: unknown }).environmentId;
          return typeof environmentId === "string" && environmentId ? environmentId : null;
        }).catch(() => null)
        : null;
      const nextStages = parseNextStages(sourcePath, card.stage);
      const scopes = loadCardScopes(sourcePath, card.name);
      const preset = getPresetForBand(STAGE_TO_BAND[card.stage] ?? "analysis", card.id);
      // The helper owns the typed artifact manifest. Its stage is the durable
      // producer attribution rendered beside the workflow timeline.
      const artifacts = await (async () => {
        if (!sourcePath) return [];
        const stateBlob = await (async () => {
          if (card.dir_hash) {
            const stateDir = await workflowStateDir(bb, sourcePath, card.dir_hash);
            if (stateDir) return await bb.sdk.files.read({ path: join(stateDir, "state.md") }).then((f) => f.content).catch(() => null);
          }
          return await bb.sdk.files.read({ path: join(sourcePath, "state.md") }).then((f) => f.content).catch(() => null);
        })();
        if (!stateBlob) return [];
        const list: Array<{ stage: string; kind: string; path: string; display: string; generatedAt: string; absolutePath: string; hostId: string }> = [];
        for (const fields of parseArtifactManifest(stateBlob)) {
          const stage = fields.stage;
          const relPath = fields.path;
          if (!stage || !relPath) continue;
          // Artifact manifests are agent-produced input. Resolve only a strict
          // project-relative path; absolute paths and traversal are rejected.
          const full = resolveArtifactPath(sourcePath, relPath);
          if (!full) continue;
          const exists = await bb.sdk.files.read({ path: full }).then(() => true).catch(() => false);
          if (exists && sourceHostId) list.push({ stage, kind: fields.kind ?? "document", path: relPath, display: fields.label ?? basename(full), generatedAt: fields.generated_at ?? "", absolutePath: full, hostId: sourceHostId });
        }
        return list;
      })();
      // Surface pending stelow ask interactions regardless of the stored activity:
      // an ask parks the card awaiting an answer even when the thread is idle.
      const effectiveActivity = (card.activity === "error" ? "error" : pending.length > 0 ? "awaiting-answer" : card.activity as "idle" | "running" | "awaiting-answer" | "error");
      const termStatus = ["completed", "archived", "blocked"].includes(normalizeStatus(card.status));
      const idleAt = (card.last_idle_at && card.last_idle_at > 0) ? card.last_idle_at : card.updated_at;
      const idleStuck = effectiveActivity === "idle"
        && card.worker_thread_id !== null
        && !termStatus
        && now() - idleAt >= IDLE_ATTENTION_MS;
      const attentionKind = (idleStuck ? "idle"
        : effectiveActivity === "awaiting-answer" ? "question"
        : Boolean(card.last_error) || effectiveActivity === "error" ? "error"
        : null) as "question" | "error" | "idle" | null;
      const pendingFirst = pending[0] ?? null;
      // Worker ledger, newest first. The open row (endedAt null) is the live
      // worker; older rows are archived threads replaced along the way.
      const workerHistory = (db.prepare("SELECT card_threads.thread_id, card_threads.preset_id, presets.name AS preset_name, card_threads.started_at, card_threads.ended_at, card_threads.ended_reason FROM card_threads LEFT JOIN presets ON presets.id = card_threads.preset_id WHERE card_threads.card_id = ? ORDER BY card_threads.started_at DESC LIMIT 6").all(cardId) as Array<{ thread_id: string; preset_id: string | null; preset_name: string | null; started_at: number; ended_at: number | null; ended_reason: string | null }>).map((row) => ({ threadId: row.thread_id, presetName: row.preset_name, startedAt: row.started_at, endedAt: row.ended_at, endedReason: row.ended_reason }));
      return {
        card: { id: card.id, name: card.name, displayName: card.display_name ?? card.name, prompt: card.prompt, intent: card.intent, projectId: card.project_id, projectName: card.workspace_kind === "exploratory" ? "Exploratory work" : projectName, workspaceKind: card.workspace_kind, workspacePath: card.workspace_path, kind: (card.kind === "research" ? "research" : "delivery") as "delivery" | "research", researchStrategy: card.research_strategy, researchStrategies: strategyList(card), status: normalizeStatus(card.status), stage: card.stage, workerThreadId: card.worker_thread_id, activity: effectiveActivity, lastError: card.last_error, needsAttention: attentionKind !== null, presetName: preset.name, presetProviderId: preset.provider_id, presetModelId: preset.model_id, presetOverridden: (db.prepare("SELECT preset_id FROM card_presets WHERE card_id = ?").get(cardId) as { preset_id: string } | undefined)?.preset_id != null, updatedAt: card.updated_at, stallCount: stallCount(db, cardId), presetId: preset.id, workerPresetId: card.worker_preset_id, presetRestartPending: (card.preset_restart_pending ?? 0) === 1 },
        attachments,
        mentionedFiles,
        scopes,
        comments: comments.map(({ id, target, target_id, author, body, created_at }) => ({ id, target: target as "card" | "scope" | "task", targetId: target_id, author: author as "user" | "agent", body, createdAt: created_at })),
        pendingQuestions: pending,
        expiredQuestions,
        artifacts,
        workerHistory,
        fileEnvironmentId,
        nextStages,
      };
    },

    async updateCardIntent({ cardId, intent }) {
      const card = getCard(cardId);
      if (!card) return { ok: false, error: ERR_CARD_NOT_FOUND, pastTriage: false, notified: false };
      if (card.kind === "research") return { ok: false, error: "Research cards don't use intent — the strategy defines the work.", pastTriage: false, notified: false };
      const previousIntent = card.intent;
      const pastTriage = card.stage !== "triage";
      const ts = now();
      db.prepare("UPDATE cards SET intent = ?, updated_at = ? WHERE id = ?").run(intent, ts, cardId);
      // Keep state.md intent in sync so the agent sees the corrected intent.
      try {
        const workspace = await cardWorkspace(card);
        if (workspace?.path) {
          const stateDir = card.dir_hash ? await workflowStateDir(bb, workspace.path, card.dir_hash) : null;
          const statePath = stateDir ? join(stateDir, "state.md") : join(workspace.path, "state.md");
          const existing = await bb.sdk.files.read({ path: statePath }).catch(() => null);
          if (existing) {
            await bb.sdk.files.write({ path: statePath, content: existing.content.replace(/^intent:.*$/m, `intent: ${intent}`) });
          }
        }
      } catch { /* state.md sync is best-effort */ }
      // Past triage the label change alone leaves the worker behind: appetite and
      // the stage path were chosen under the old intent and are not recomputed.
      // Notify the worker directly (same mechanism as user comments) so it learns
      // about the correction instead of discovering a silently edited state.md.
      let notified = false;
      if (pastTriage && intent !== previousIntent && card.worker_thread_id) {
        try {
          await bb.sdk.threads.send({ threadId: card.worker_thread_id, mode: "auto", input: [{ type: "text", text: `The user corrected this work item's intent from "${previousIntent}" to "${intent}". The card label and state.md are updated. Appetite and the stage path chosen under the old intent are unchanged — keep working from the current stage (${card.stage}) unless the new intent clearly invalidates completed work, in which case ask the user via the question form instead of silently switching tracks.`, mentions: [] }] });
          updateCard(cardId, { activity: "running" });
          notified = true;
        } catch { /* worker unreachable — caller surfaces the fallback */ }
      }
      bb.realtime.publish("card-state", { cardId });
      return { ok: true, error: null, pastTriage, notified };
    },

    async addCardComment({ cardId, target, targetId, body }) {
      const card = getCard(cardId);
      if (!card) return { commentId: "", error: ERR_CARD_NOT_FOUND };
      const commentId = logCardComment(cardId, target, targetId, "user", body);
      if (target === "card" && card.worker_thread_id) {
        try {
          await bb.sdk.threads.send({ threadId: card.worker_thread_id, mode: "auto", input: [{ type: "text", text: `User comment on card "${card.name}":\n\n${body}`, mentions: [] }] });
          updateCard(cardId, { activity: "running" });
        } catch (error) {
          return { commentId, error: error instanceof Error ? error.message : "Failed to route comment to worker thread." };
        }
      }
      bb.realtime.publish("card-state", { cardId });
      return { commentId, error: null };
    },

    async cancelCard({ cardId }) {
      const card = getCard(cardId);
      if (!card) return { archived: false };
      if (card.worker_thread_id) {
        try { await bb.sdk.threads.archive({ threadId: card.worker_thread_id }); } catch { /* ignore */ }
        try { await bb.sdk.threads.stop({ threadId: card.worker_thread_id }); } catch { /* ignore */ }
      }
      updateCard(cardId, { status: "archived", activity: "idle" });
      return { archived: true };
    },

    async retryWorker({ cardId }) {
      // First-line recovery for stuck workers (error OR idle with nothing
      // pending): the plugin SDK exposes no thread-retry, but delivering a
      // message starts a new turn — exactly what typing into the thread does.
      // Non-destructive: same worker, same state dir. Reseed stays available
      // for cases where the worker itself is broken.
      const card = getCard(cardId);
      if (!card?.worker_thread_id) return { ok: false, error: "This card has no worker thread." };
      if (card.status === "archived") return { ok: false, error: ERR_CARD_ARCHIVED };
      // Research workers never advance stages: a delivery-flavored nudge
      // would instruct them to run a machine that does not exist here.
      const nudge = card.kind === "research"
        ? `Continue the Stelow research now. Re-read your brief.md first, then keep researching with the strategy playbook. If a question is already pending on the card, do NOT re-ask it — the answer arrives here on its own. But if you genuinely need NEW input from the user that was never asked, ask it now via bb stelow ask; silence is not progress. NEVER run \`bb stelow advance\` — research has no stages. When the brief is complete with ranked opportunities, STOP and end your turn. If a \`bb stelow\` command fails, read its stderr once and continue — do NOT spend the turn debugging the CLI; report the exact error and move on.`
        : `Continue the Stelow workflow now from the current stage. Re-read your state.md and transitions.md first, then keep working. If a question is already pending on the card, do NOT re-ask it — the answer arrives here on its own. But if the current stage genuinely needs NEW input from the user that was never asked, ask it now via bb stelow ask; silence is not progress. Interface-pick discipline: check review_mode in state.md first. Auto and Product Spec Gate mean LLM decides (pick your hybrid recommendation yourself, save selected-interface.md, advance; never park waiting for a human pick). Only Product Spec plus Interface Gates and above wait for a human choice. Gate-tool fallback: if visual_review is unavailable here, do not park in chat waiting. Auto approves and advances itself; gated modes use a structured ask. If a bb stelow command fails, read its stderr once and continue — do not spend the turn debugging the CLI.`;
      try {
        await bb.sdk.threads.send({ threadId: card.worker_thread_id, mode: "auto", input: [{ type: "text", text: nudge, mentions: [] }] });
        updateCard(cardId, { activity: "running", last_error: null });
        bb.realtime.publish("card-state", { cardId });
        return { ok: true, error: null };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Could not reach the worker thread." };
      }
    },

    async restartWorker({ cardId }) {
      // Applies a pending preset change (or escapes a broken worker) by
      // spawning a FRESH worker on the same state dir that CONTINUES from the
      // current stage — unlike reseed (restarts triage) and retry (same
      // thread, same model: provider/model are fixed at spawn and can never
      // change on a live thread). Uses the override-aware effective preset.
      const card = getCard(cardId);
      if (!card) return { ok: false, error: ERR_CARD_NOT_FOUND };
      if (card.status === "archived") return { ok: false, error: ERR_CARD_ARCHIVED };
      const effective = getPresetForBand(STAGE_TO_BAND[card.stage] ?? "analysis", cardId);
      const previousThreadId = card.worker_thread_id;
      const result = await respawnWorkerForBand(cardId, effective.id, "restart");
      if (result.ok) {
        // Trail: which preset took over and where the previous worker's
        // history lives, so the switch is auditable from the card.
        const presetName = getPresetById(effective.id)?.name ?? effective.id;
        const continueText = card.kind === "research" ? "continuing the research" : `continuing from the ${card.stage} stage`;
        logCardComment(cardId, "card", cardId, "agent", previousThreadId ? `Worker restarted on preset "${presetName}", ${continueText}. Previous worker thread: ${previousThreadId} (archived).` : `Worker started on preset "${presetName}", ${continueText}.`);
        bb.realtime.publish("card-state", { cardId });
      }
      return { ok: result.ok, error: result.error ?? null };
    },

    async reseedCard({ cardId, presetId }) {
      const card = getCard(cardId);
      if (!card) return { reseeded: false, error: ERR_CARD_NOT_FOUND };
      const workspace = await cardWorkspace(card);
      const source = workspace?.hostId && workspace.path ? { path: workspace.path, hostId: workspace.hostId } : null;
      if (!source) return { reseeded: false, error: `${ERR_WORKSPACE_UNAVAILABLE} Archive this card to remove it.` };
      // Re-seed into a fresh per-workflow dir so the card gets a clean state file.
      const seed = await seedWorkflow(bb, source.path, card.name, card.intent, "Core", "Auto", true);
      if (seed.error) return { reseeded: false, error: seed.error };
      if (seed.dirHash) {
        db.prepare("UPDATE cards SET dir_hash = ?, updated_at = ? WHERE id = ?").run(seed.dirHash, now(), cardId);
      }
      let preset: PresetRow;
      if (presetId) {
        const found = getPresetById(presetId);
        if (!found) return { reseeded: false, error: ERR_PRESET_NOT_FOUND };
        preset = found;
        db.prepare("INSERT OR REPLACE INTO card_presets (card_id, preset_id, assigned_at) VALUES (?, ?, ?)").run(cardId, preset.id, now());
      } else {
        preset = getPresetForCard(cardId);
      }
      const previousThreadId = card.worker_thread_id;
      const params = presetAttachmentParams(preset);
      const researchStrategy = card.kind === "research" ? researchStrategyById(card.research_strategy ?? "") : null;
      if (card.kind === "research" && !researchStrategy) return { reseeded: false, error: "This research has no known strategy. Archive it and start a new one." };
      const researchReseed = researchStrategy ? researchWorkerPrompt({
        displayName: card.display_name ?? card.name,
        prompt: card.prompt,
        strategyLabel: researchStrategy.label,
        strategySkill: researchStrategy.skill,
        stateDirText: text(seed.stateDir ?? "<project>/.stelow/<date>/<dirHash>"),
        workspaceRoot: source.path,
        instructions: params.instructions,
        flavor: "reseed",
        previousThreadId,
      }) : null;
      const newThread = await bb.sdk.threads.spawn({
        projectId: card.project_id,
        environment: workerEnvironment(source, params, card.workspace_kind === "exploratory"),
        visibility: "hidden",
        title: `Stelow: ${card.display_name ?? card.name}`,
        providerId: params.providerId,
        model: params.modelId,
        reasoningLevel: params.reasoningLevel as "low" | "medium" | "high" | "xhigh" | "max" | "none" | "ultra" | "ultracode",
        permissionMode: params.permissionMode as "accept-edits" | "auto" | "full",
        executionInputSources: { providerId: "explicit", model: "explicit", reasoningLevel: "explicit", permissionMode: "explicit" },
        input: [{ type: "text", mentions: [], text: researchReseed ?? `You are running a Stelow workflow inside the bb-plugin-stelow panel. The host re-seeded your per-workflow state, transitions.md, and stelow.json. Your workflow owns its own state dir (${text(seed.stateDir ?? "<project>/.stelow/<date>/<dirHash>")}) — its state.md holds name, intent, current_stage, status. The Stelow workflow skills (stelow-workflow-entry, stelow-workflow-router, stelow-workflow-*) are provided by this plugin — start by loading them (they live under the plugin's skills directory; \`bb skill list\` shows them). The product strategy playbooks (stelow-product-*) come from the stelow repo via the agent skills hub (\`npx skills add calionauta/stelow\`). Use \`bb stelow advance <stage>\` to change stages (do NOT hand-edit current_stage). Preserve every gate (product, interface, tech plan, diff).

Intent is currently \`${card.intent}\` in the re-seeded state.md. ${card.intent === "unknown" ? "It is still unknown, so your FIRST job is triage: classify it (new-product, feature, bugfix, refactor, or investigate), write it to state.md immediately, and only then continue — ask via the form below only if genuinely ambiguous." : "Use it — do NOT ask the user to pick or confirm intent again."} Order of work, always: (1) settle intent; (2) load the workflow skills; (3) advance stages and do the work. If a \`bb stelow\` command fails, read its stderr once and continue — do NOT spend the turn debugging the CLI; report the exact error and move on.

CRITICAL — User input contract:
ANY time you need user input, you MUST call the structured form:

    bb stelow ask --thread <this_thread_id> \\
      --question "<a single clear question>" \\
      --option "<label 1>" --option "<label 2>" [--option "<label 3>" ...] [--multiple]

Before asking a question, first summarize what you read (files, plan, codebase) so the user can answer with context — never dump a raw file list as the only content of a question. Do not skip the triage stage. Each bb stelow ask call blocks until the user submits; the card moves to the "Gate pending" column automatically. If an ask returns "No response after Ns" (timeout), STOP and wait: do NOT proceed with the workflow. The question stays pending on the card and remains answerable; when the user answers it on the card, the answer is delivered to you as a message and you continue from there. Never re-ask the same question — wait for the card answer. Interface-pick discipline: check review_mode in state.md first. Auto and Product Spec Gate mean LLM decides (pick your hybrid recommendation yourself, save selected-interface.md, advance; never park waiting for a human pick). Only Product Spec plus Interface Gates and above wait for a human choice. Gate-tool fallback: if visual_review is unavailable in this host, do NOT park in chat waiting. In Auto, write the approval receipt yourself (.stelow/approvals/{dirHash}/{file}.approved.md) and advance; in gated modes, open a structured ask instead. Stop when the user archives the card or the workflow reaches \`audit\`.

${params.instructions ? `Preset instructions:\n${params.instructions}\n` : ""}Request:
${card.prompt}` }, ...cardAttachments(card.attachments)],
      });
      if (previousThreadId) {
        try { await bb.sdk.threads.archive({ threadId: previousThreadId }); } catch { /* ignore */ }
        try { await bb.sdk.threads.stop({ threadId: previousThreadId }); } catch { /* ignore */ }
      }
      updateCard(cardId, { stage: card.kind === "research" ? "research" : "triage", status: card.kind === "research" ? "pending" : card.status, activity: "running", last_error: null, worker_thread_id: newThread.id, worker_preset_id: preset.id, preset_restart_pending: 0, last_assistant_text: null });
      recordWorkerThread(db, cardId, newThread.id, preset.id, "reseed");
      if (seed.dirHash) void recordWorkflowLineage(source.path, seed.dirHash, newThread.id, preset.id, "reseed");
      return { reseeded: true, error: null };
    },

    async moveCard({ cardId, status }) {
      const card = getCard(cardId);
      if (!card) return { ok: false, error: ERR_CARD_NOT_FOUND };
      // Track routing lives in lib/card-move (unit-tested): research moves
      // statuses, delivery moves phases + terminals, each side refuses the
      // other's columns with the valid exit named.
      const decision = resolveCardMove(card.kind, status);
      if (!decision.ok) return { ok: false, error: decision.error };
      if (decision.move.type === "status") {
        updateCard(cardId, { status: decision.move.status as "pending" | "in-progress" | "completed" | "archived" });
        return { ok: true, error: null };
      }
      // A phase move sets the card's stage to that phase's entry stage
      // (stage drives the column). Terminals already returned above.
      const BAND_ENTRY_STAGE: Record<string, string> = { analysis: "triage", planning: "critique", execution: "execution", review: "diff-gate" };
      const entry = BAND_ENTRY_STAGE[decision.move.phase];
      if (!entry) return { ok: false, error: "Unknown phase." };
      updateCard(cardId, { stage: entry, status: entry === "triage" ? "draft" : "in-progress" });
      return { ok: true, error: null };
    },

    async promoteCard({ cardId, name }) {
      // Turns exploratory scratch into a real BB project. Files never move
      // and the worker keeps running: the new project's source IS the card's
      // workspace path, so cardWorkspace resolves the identical state.md
      // before and after. Only exploratory cards qualify — project cards
      // already have a project, so the UI hides this option for them and the
      // server refuses with that exit named.
      const card = getCard(cardId);
      if (!card) return { ok: false, projectId: null, projectName: null, error: ERR_CARD_NOT_FOUND };
      if (card.workspace_kind !== "exploratory") {
        const projectName = await bb.sdk.projects.get({ projectId: card.project_id }).then((p) => p.name).catch(() => card.project_id);
        return { ok: false, projectId: null, projectName: null, error: `This work already lives in project "${projectName}" — nothing to promote.` };
      }
      if (card.status === "archived") return { ok: false, projectId: null, projectName: null, error: ERR_CARD_ARCHIVED };
      const workspace = await cardWorkspace(card);
      if (!workspace?.path) return { ok: false, projectId: null, projectName: null, error: ERR_WORKSPACE_UNAVAILABLE };
      if (!workspace.hostId) return { ok: false, projectId: null, projectName: null, error: "Workspace host is unavailable." };
      const projectName = normalizePromoteName(name, card.display_name ?? card.name);
      const projects = await bb.sdk.projects.list().catch(() => []);
      const decision = findAdoptableProject(projects, projectName, workspace.path);
      if (decision.action === "conflict") {
        return { ok: false, projectId: null, projectName: null, error: `A project named "${projectName}" already exists — pick another name.` };
      }
      let projectId: string;
      try {
        projectId = decision.action === "adopt" && decision.project
          ? decision.project.id
          : (await bb.sdk.projects.create({ name: projectName, source: { type: "local_path", hostId: workspace.hostId, path: workspace.path } })).id;
      } catch (error) {
        return { ok: false, projectId: null, projectName: null, error: error instanceof Error ? error.message : "Could not create the project." };
      }
      // project_id is deliberately outside updateCard's contract (it excludes
      // ownership moves), so this writes it explicitly. Nulling the
      // exploratory path/host flips future cardWorkspace resolution to the
      // new project's source — the same directory.
      db.prepare("UPDATE cards SET project_id = ?, workspace_kind = 'project', workspace_path = NULL, workspace_host_id = NULL, updated_at = ? WHERE id = ?").run(projectId, now(), cardId);
      logCardComment(cardId, "card", cardId, "agent", `Turned into project "${projectName}". Files stayed in place; the worker continues from the current stage.`);
      bb.realtime.publish("card-state", { cardId });
      bb.realtime.publish("board-changed", { cardId });
      return { ok: true, projectId, projectName, error: null };
    },

    async researchStrategies() {
      return { strategies: RESEARCH_STRATEGIES };
    },

    async createResearchCard({ projectId, environment, prompt, attachments, strategy }) {
      const picked = researchStrategyById(strategy);
      if (!picked) {
        throw new Error(`Unknown research strategy "${strategy}". Pick one of: ${RESEARCH_STRATEGIES.map((entry) => entry.id).join(", ")}.`);
      }
      return createCardInternal({ projectId, environment, prompt, attachments, intent: "investigate", appetite: "Lean", reviewMode: "Auto", kind: "research", strategy: picked.id });
    },

    // Resolve the research brief file for a card. Shared by researchBrief
    // (read) and fanOutResearch (read + flip). Returns the error instead of
    // throwing so every refusal names its exit.
    async researchBrief({ cardId }) {
      const card = getCard(cardId);
      if (!card) return { found: false, briefPath: null, content: null, truncated: false, opportunities: [], error: ERR_CARD_NOT_FOUND };
      if (card.kind !== "research") return { found: false, briefPath: null, content: null, truncated: false, opportunities: [], error: "Only research cards have a brief. Delivery cards track scopes instead." };
      const resolved = await readResearchBrief(card);
      if (!resolved.ok) return { found: false, briefPath: null, content: null, truncated: false, opportunities: [], error: resolved.error };
      const parsed = parseResearchBrief(resolved.content);
      if (!parsed.found) return { found: false, briefPath: resolved.display, content: null, truncated: false, opportunities: [], error: "No ## Opportunities section in the brief yet — the research is still running." };
      const LIMIT = 100_000;
      return {
        found: true,
        briefPath: resolved.display,
        content: resolved.content.slice(0, LIMIT),
        truncated: resolved.content.length > LIMIT,
        opportunities: parsed.opportunities.map(({ id, title, checked, group }) => ({ id, title, checked, group })),
        error: null,
      };
    },

    async fanOutResearch({ cardId, opportunityIds }) {
      const card = getCard(cardId);
      if (!card) return { ok: false, created: [], error: ERR_CARD_NOT_FOUND };
      if (card.kind !== "research") return { ok: false, created: [], error: "Only research cards fan out. Delivery cards already are work." };
      if (card.status === "archived") return { ok: false, created: [], error: ERR_CARD_ARCHIVED };
      const resolved = await readResearchBrief(card);
      if (!resolved.ok) return { ok: false, created: [], error: resolved.error };
      const parsed = parseResearchBrief(resolved.content);
      if (!parsed.found) return { ok: false, created: [], error: "No ## Opportunities section in the brief yet — the research is still running." };
      const wanted = new Set(opportunityIds);
      const matched = parsed.opportunities.filter((item) => wanted.has(item.id) && !item.checked);
      if (matched.length === 0) return { ok: false, created: [], error: "None of the selected opportunities are still available — reopen the brief; they may already have been fanned out." };
      const strategyLabel = researchStrategyById(card.research_strategy ?? "")?.label ?? "research";
      // Exploratory research fans out into fresh exploratory work cards (each
      // owns its isolated workspace) instead of piling every card's state
      // into the shared container directory. Project research stays in its
      // project.
      const targetProjectId = card.workspace_kind === "exploratory" ? "proj_personal" : card.project_id;
      const created: Array<{ cardId: string; title: string }> = [];
      for (const item of matched) {
        try {
          const work = await createCardInternal({
            projectId: targetProjectId,
            prompt: `Spawned from research "${card.display_name ?? card.name}" (${strategyLabel}).\n\nOpportunity: ${item.title}\n\nResearch context: full brief at ${resolved.absolute} — read its ## Findings before triage. Treat the opportunity above as the request; classify intent first, then work it through the normal delivery workflow.`,
            attachments: [],
            intent: "unknown",
            appetite: "Lean",
            reviewMode: "Auto",
            kind: "delivery",
          });
          const workCard = getCard(work.cardId);
          created.push({ cardId: work.cardId, title: workCard?.display_name ?? workCard?.name ?? item.title });
        } catch (error) {
          return { ok: false, created, error: error instanceof Error ? error.message : "Could not spawn a work card." };
        }
      }
      // Flip exactly the spawned boxes so a retry never double-spawns. Only
      // exact parser lines flip; a worker edit in between stays intact.
      const flipped = checkBriefItems(resolved.content, matched.map((item) => item.id));
      if (flipped.checked.length > 0) {
        try {
          await bb.sdk.files.write({ path: resolved.absolute, content: flipped.updated });
        } catch { /* boxes stay unchecked; the comment below still trails */ }
      }
      logCardComment(cardId, "card", cardId, "agent", `Fanned out ${created.length} ${created.length === 1 ? "opportunity" : "opportunities"} into work: ${created.map((entry) => entry.title).join("; ")}.`);
      bb.realtime.publish("card-state", { cardId });
      bb.realtime.publish("board-changed", { cardId });
      return { ok: true, created, error: null };
    },

    async runResearchStrategy({ cardId, strategy }) {
      // Composite research: run another strategy round on the same card.
      // Spawns a fresh worker on the new playbook that APPENDS a new ###
      // section to the brief — existing items are never rewritten. The
      // previous worker retires only after the new one is live (same safe
      // order as every respawn).
      const card = getCard(cardId);
      if (!card) return { ok: false, strategy: null, error: ERR_CARD_NOT_FOUND };
      if (card.kind !== "research") return { ok: false, strategy: null, error: "Only research cards run strategies. Delivery cards advance stages instead." };
      if (card.status === "archived") return { ok: false, strategy: null, error: ERR_CARD_ARCHIVED };
      const picked = researchStrategyById(strategy);
      if (!picked) {
        return { ok: false, strategy: null, error: `Unknown research strategy "${strategy}". Pick one of: ${RESEARCH_STRATEGIES.map((entry) => entry.id).join(", ")}.` };
      }
      const effective = getPresetForBand(STAGE_TO_BAND[card.stage] ?? "analysis", cardId);
      const result = await respawnWorkerForBand(cardId, effective.id, "strategy-add", { strategyId: picked.id, flavor: "append" });
      if (!result.ok) return { ok: false, strategy: null, error: result.error ?? "Could not start the strategy round." };
      const history = [...strategyList(card), picked.id];
      db.prepare("UPDATE cards SET research_strategies = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(history), now(), cardId);
      const presetName = getPresetById(effective.id)?.name ?? effective.id;
      logCardComment(cardId, "card", cardId, "agent", `Started a ${picked.label} round on preset "${presetName}" — appending to the brief. Previous worker archived.`);
      bb.realtime.publish("card-state", { cardId });
      return { ok: true, strategy: picked.id, error: null };
    },

    async answerExpiredQuestion({ cardId, questionId, answer }) {
      const card = getCard(cardId);
      const question = card ? db.prepare("SELECT * FROM expired_questions WHERE id = ? AND card_id = ? AND answered = 0").get(questionId, cardId) as { thread_id: string; question: string; multiple: number; options: string } | undefined : undefined;
      if (!card || !question) return { ok: false, error: "Question not found or already answered." };
      logCardComment(cardId, "card", cardId, "user", `Answer to an earlier question that timed out:\n\nQ: ${question.question}\nA: ${answer}`);
      db.prepare("UPDATE expired_questions SET answered = 1 WHERE id = ?").run(questionId);
      // The question is answered — leave Gate pending. The threads.send below
      // resumes the worker (thread.active → syncThreadState → running); if the
      // thread fails to resume, idle is honest and the comment still records it.
      updateCard(cardId, { activity: "running", status: "in-progress" });
      resolveInboxEvents(cardId, now(), ["question"]);
      bb.realtime.publish("card-state", { cardId });
      // Deliver the answer to the worker thread so the agent picks it up and continues.
      try {
        await bb.sdk.threads.send({ threadId: question.thread_id, mode: "auto", input: [{ type: "text", text: `Answer to the question that timed out — continue the workflow now.\n\nQ: ${question.question}\nA: ${answer}`, mentions: [] }] });
      } catch (error) {
        // Thread may be stopped; the comment still records the answer.
      }
      return { ok: true, error: null };
    },

    async advanceCard({ cardId, stage }) {
      const card = getCard(cardId);
      if (!card) return { ok: false, stdout: "", error: ERR_CARD_NOT_FOUND };
      if (card.kind === "research") return { ok: false, stdout: "", error: "Research cards don't use stages — drag to Done when the brief is complete." };
      const workspace = await cardWorkspace(card);
      if (!workspace?.path) return { ok: false, stdout: "", error: ERR_WORKSPACE_UNAVAILABLE };
      const stateDir = card.dir_hash ? await workflowStateDir(bb, workspace.path, card.dir_hash) : null;
      const source = { path: workspace.path, hostId: workspace.hostId };
      const guard = await ensureProjectArtifacts(bb, source.path, stateDir);
      if (guard) return { ok: false, stdout: "", error: guard };
      const result = await runHelper(["advance", stage], source.path, stateDir ?? undefined);
      if (result.code !== 0) return { ok: false, stdout: result.stdout, error: result.stderr || "stelow advance failed" };
      // Band-preset swap, mirroring the CLI advance path: if the phase of the
      // stage just advanced to defines a preset different from this worker's,
      // respawn with the phase preset on the same state dir.
      const band = STAGE_TO_BAND[stage];
      const bandPreset = band ? getPresetForBand(band, card.id) : null;
      const currentPresetId = card.worker_preset_id ?? getPresetForCard(card.id).id;
      if (band && bandPreset && bandPreset.id !== currentPresetId) {
        await respawnWorkerForBand(card.id, bandPreset.id);
      }
      // Sync status so the board column follows the new stage: past triage a
      // card becomes in-progress (leaves the Triage/draft column); a resumed
      // gate card returns to in-progress too.
      const nextStatus = stage === "triage" ? "draft" : stage === "audit" ? "completed" : "in-progress";
      updateCard(cardId, { stage, status: nextStatus, activity: "running" });
      bb.realtime.publish("card-state", { cardId });
      return { ok: true, stdout: result.stdout, error: null };
    },

    async advance({ projectId, stage }) {
      const rootPath = await projectRoot(bb, projectId);
      if (!rootPath) return { stage: "", stdout: "", error: "Project workspace path is unavailable." };
      const guard = await ensureProjectArtifacts(bb, rootPath);
      if (guard) return { stage, stdout: "", error: guard };
      const result = await runHelper(["advance", stage], rootPath);
      if (result.code !== 0) return { stage, stdout: result.stdout, error: result.stderr || "stelow advance failed" };
      bb.realtime.publish("board-changed", { stage });
      return { stage, stdout: result.stdout, error: null };
    },

    async listPresets() {
      // Per-card override rows (card-override-*) are implementation detail of
      // a single card's custom provider/model choice — not reusable presets.
      // Hide them so neither the board manager nor the card dialog is polluted.
      const rows = db.prepare("SELECT * FROM presets WHERE id NOT LIKE 'card-override-%' ORDER BY is_default DESC, name COLLATE NOCASE ASC").all() as PresetRow[];
      return {
        presets: rows.map((row) => ({
          id: row.id,
          name: row.name,
          providerId: row.provider_id,
          modelId: row.model_id,
          reasoningLevel: row.reasoning_level,
          permissionMode: row.permission_mode,
          environmentKind: row.environment_kind,
          baseBranch: row.base_branch,
          machineId: row.machine_id,
          instructions: row.instructions,
          isDefault: row.is_default === 1,
          builtIn: row.built_in === 1,
        })),
      };
    },

    async upsertPreset({ id, name, providerId, modelId, reasoningLevel, permissionMode, environmentKind, baseBranch, machineId, instructions }) {
      const trimmed = name.trim();
      if (!trimmed) return { preset: { id: "", name: "" } };
      const effectiveId = id ?? `preset_${Math.random().toString(36).slice(2, 10)}`;
      const collision = db.prepare("SELECT id FROM presets WHERE LOWER(name) = LOWER(?) AND id != ?").get(trimmed, effectiveId) as { id: string } | undefined;
      if (collision) throw new Error(`A preset named "${trimmed}" already exists.`);
      const existing = db.prepare("SELECT id, built_in FROM presets WHERE id = ?").get(effectiveId) as { id: string; built_in: number } | undefined;
      if (existing?.built_in === 1 && (!id || id !== effectiveId)) {
        throw new Error("Built-in presets cannot be renamed or duplicated; create a new one instead.");
      }
      const ts = now();
      if (existing) {
        db.prepare("UPDATE presets SET name = ?, provider_id = ?, model_id = ?, reasoning_level = ?, permission_mode = ?, environment_kind = ?, base_branch = ?, machine_id = ?, instructions = ?, updated_at = ? WHERE id = ?").run(
          trimmed, providerId, modelId, reasoningLevel, permissionMode, environmentKind, baseBranch ?? null, machineId ?? null, instructions, ts, effectiveId,
        );
      } else {
        db.prepare("INSERT INTO presets (id, name, provider_id, model_id, reasoning_level, permission_mode, environment_kind, base_branch, machine_id, instructions, is_default, built_in, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)").run(
          effectiveId, trimmed, providerId, modelId, reasoningLevel, permissionMode, environmentKind, baseBranch ?? null, machineId ?? null, instructions, ts, ts,
        );
      }
      return { preset: { id: effectiveId, name: trimmed } };
    },

    async deletePreset({ id }) {
      const row = db.prepare("SELECT built_in FROM presets WHERE id = ?").get(id) as { built_in: number } | undefined;
      if (!row) return { deleted: false, error: ERR_PRESET_NOT_FOUND };
      if (row.built_in === 1) return { deleted: false, error: "Built-in presets cannot be deleted." };
      const inUse = db.prepare("SELECT COUNT(*) AS count FROM card_presets WHERE preset_id = ?").get(id) as { count: number };
      if (inUse.count > 0) return { deleted: false, error: `Preset is assigned to ${inUse.count} card(s). Unassign first.` };
      db.prepare("DELETE FROM presets WHERE id = ?").run(id);
      return { deleted: true, error: null };
    },

    async listBandPresets() {
      const rows = db.prepare("SELECT band, preset_id FROM stage_presets").all() as Array<{ band: string; preset_id: string }>;
      const map: Record<string, string> = {};
      for (const row of rows) map[row.band] = row.preset_id;
      return { bands: Object.keys(STAGE_BANDS).map((band) => ({ band, presetId: map[band] ?? null, stages: STAGE_BANDS[band] })) };
    },

    async setBandPreset({ band, presetId }) {
      if (!STAGE_BANDS[band]) return { ok: false, error: `Unknown band: ${band}` };
      if (presetId) {
        if (!getPresetById(presetId)) return { ok: false, error: ERR_PRESET_NOT_FOUND };
        db.prepare("INSERT OR REPLACE INTO stage_presets (band, preset_id, assigned_at) VALUES (?, ?, ?)").run(band, presetId, now());
      } else {
        db.prepare("DELETE FROM stage_presets WHERE band = ?").run(band);
      }
      return { ok: true, error: null };
    },

    async assignPreset({ cardId, presetId }) {
      const card = getCard(cardId);
      if (!card) return { ok: false, error: ERR_CARD_NOT_FOUND };
      if (presetId === null) {
        db.prepare("DELETE FROM card_presets WHERE card_id = ?").run(cardId);
        // Drop this card's private override row (if any) so custom choices
        // don't accumulate dead rows; it is unreferenced after the reset.
        db.prepare("DELETE FROM presets WHERE id = ?").run(`card-override-${cardId}`);
      } else {
        const preset = getPresetById(presetId);
        if (!preset) return { ok: false, error: ERR_PRESET_NOT_FOUND };
        db.prepare("INSERT OR REPLACE INTO card_presets (card_id, preset_id, assigned_at) VALUES (?, ?, ?)").run(cardId, presetId, now());
        // A live worker predating the new preset will never pick it up
        // (provider/model are fixed at spawn): flag it so the card offers
        // Restart instead of a Resume that changes nothing.
        refreshRestartPending(db, cardId, card.worker_thread_id, card.worker_preset_id, presetId);
      }
      bb.realtime.publish("card-state", { cardId });
      return { ok: true, error: null };
    },

    async setDefaultPreset({ id }) {
      const preset = getPresetById(id);
      if (!preset) return { ok: false, error: ERR_PRESET_NOT_FOUND };
      db.prepare("UPDATE presets SET is_default = 0").run();
      db.prepare("UPDATE presets SET is_default = 1 WHERE id = ?").run(id);
      bb.realtime.publish("board-changed", { presetId: id });
      return { ok: true, error: null };
    },

    async listProviderModels() {
      const providers = await bb.sdk.providers.list().catch(() => []);
      const models: Array<{ providerId: string; model: string; displayName: string }> = [];
      const availability = new Map<string, boolean>();
      for (const provider of providers) {
        const result = await bb.sdk.providers.models({ providerId: provider.id }).catch(() => null);
        availability.set(provider.id, result !== null);
        if (provider.id === "pi") {
          const catalog = new Map((result?.models ?? []).map((model) => [model.model, model.displayName]));
          for (const model of PI_BIFROST_PRESET_MODELS) {
            models.push({ providerId: "pi", model: model.model, displayName: catalog.get(model.model) ?? model.displayName });
          }
          continue;
        }
        for (const model of result?.models ?? []) {
          models.push({ providerId: provider.id, model: model.model, displayName: model.displayName });
        }
      }
      return { providers: providers.map((provider) => ({ id: provider.id, displayName: provider.displayName, modelsAvailable: availability.get(provider.id) ?? false })), models };
    },

    async buildInfo() {
      return { version: BUILD_INFO.version, builtAt: BUILD_INFO.builtAt };
    },
  });

  bb.cli.register({
    name: "stelow",
    summary: "Inspect and interact with Stelow workflows",
    commands: [
      { name: "status", summary: "Show Stelow workflows", usage: "bb stelow status [--project <proj_id>] [--json]" },
      { name: "ask", summary: "Ask a blocking structured question", usage: "bb stelow ask --thread <thr_id> --question <text> [--multiple] --option <label>..." },
      { name: "seed", summary: "Seed state.md, transitions.md, stelow.json", usage: "bb stelow seed --project <proj_id> --name <name> --intent <new-product|feature|bugfix|refactor|investigate>" },
      { name: "advance", summary: "Advance to the next Stelow stage", usage: "bb stelow advance [--project <proj_id>] <stage>" },
      { name: "preset", summary: "Manage agent presets", usage: "bb stelow preset list|add|remove|assign" },
    ],
    async run(argv, ctx) {
      if (argv[0] === "status") {
        const projectFlag = argv.indexOf("--project");
        const projectId = projectFlag >= 0 ? argv[projectFlag + 1] : ctx.projectId;
        // A card worker's project source root holds no stelow.json (each
        // exploratory card owns its own file), so resolve the owning card
        // first — same pattern as the advance command.
        const cliCard = ctx.threadId ? getCardByWorkerThread(ctx.threadId) : undefined;
        if (cliCard) {
          const workspace = await cardWorkspace(cliCard);
          if (!workspace?.path) return { exitCode: 1, stderr: "Workspace path is unavailable for this card." };
          const board = await boardFromRoot(bb, workspace.path, cliCard.dir_hash);
          if (argv.includes("--json")) return { exitCode: 0, stdout: JSON.stringify(board, null, 2) };
          if (board.error) return { exitCode: 1, stderr: board.error };
          return { exitCode: 0, stdout: board.workflows.map((workflow) => `${workflow.name}\t${workflow.status}\t${workflow.stage}`).join("\n") };
        }
        const board = await loadBoard(bb, projectId ?? null);
        if (argv.includes("--json")) return { exitCode: 0, stdout: JSON.stringify(board, null, 2) };
        if (board.error) return { exitCode: 1, stderr: board.error };
        return { exitCode: 0, stdout: board.workflows.map((workflow) => `${workflow.name}\t${workflow.status}\t${workflow.stage}`).join("\n") };
      }
      if (argv[0] === "ask") {
        const flag = (name: string) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
        const threadId = flag("--thread") ?? ctx.threadId;
        const question = flag("--question");
        const labels = argv.flatMap((arg, index) => arg === "--option" && argv[index + 1] ? [argv[index + 1]!] : []);
        if (!threadId || !question || labels.length < 2) return { exitCode: 2, stderr: "Usage: bb stelow ask --thread <thr_id> --question <text> [--multiple] --option <label>..." };
        // Signal the pending question via activity (drives the attention flag);
        // the card stays in its real stage column.
        const cardRow = db.prepare("SELECT id FROM cards WHERE worker_thread_id = ?").get(threadId) as { id: string } | undefined;
        if (cardRow) updateCard(cardRow.id, { activity: "awaiting-answer" });
        let result: Awaited<ReturnType<typeof bb.ui.requestInput>>;
        let requestFailed = false;
        const askedAt = Date.now();
        const options = labels.map((label) => ({ label, description: "" }));
        try {
          result = await bb.ui.requestInput({ threadId, rendererId: "stelow-question", title: "Stelow question", timeoutMs: Number(process.env.STELOW_ASK_TIMEOUT_MS ?? 60 * 60 * 1000), payload: { question, multiple: argv.includes("--multiple"), options } }, { signal: ctx.signal });
        } catch {
          // The request itself blew up mid-flight (e.g. dispose tore down the
          // call): same bucket as a transient cancel — never lose the question.
          requestFailed = true;
          result = { outcome: "cancelled", reason: "request-aborted" };
        } finally {
          if (cardRow) updateCard(cardRow.id, { activity: "running", status: "in-progress" });
        }        // Cancellation without an answer falls into two buckets. Transient
        // infrastructure reasons (timeout, plugin reload/restart, aborted
        // request) mean the user simply never answered: persist the question
        // exactly like a timeout so it stays answerable on the card and the
        // worker stops to wait. Explicit end states (user dismissed, thread
        // stopped/deleted) are returned as-is for the worker to interpret.
        const cancelReason = result.outcome === "cancelled" ? result.reason : null;
        const transientCancel = requestFailed || classifyAskCancel(result.outcome, cancelReason) === "persist";
        if (transientCancel) {
          // The user never answered within the window. Keep the card in
          // "Gate pending" (awaiting-answer) so it is obvious a decision is
          // still outstanding, and tell the agent to STOP and wait rather
          // than guessing. The answer, when it arrives via the card, is
          // delivered as a comment that resumes the thread.
          // The persist itself is guarded: a reload landing exactly here
          // closes the DB under us, and then honesty beats optimism — tell
          // the worker to re-ask ONCE next turn instead of waiting on a
          // question that was never recorded.
          let persisted = false;
          if (cardRow) {
            try {
              db.prepare("INSERT OR REPLACE INTO expired_questions (id, card_id, thread_id, question, multiple, options, expired_at, answered) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(randomId("qexp"), cardRow.id, threadId, question, argv.includes("--multiple") ? 1 : 0, JSON.stringify(options), askedAt + Number(process.env.STELOW_ASK_TIMEOUT_MS ?? 60 * 60 * 1000), 0);
              updateCard(cardRow.id, { activity: "awaiting-answer" });
              bb.realtime.publish("card-state", { cardId: cardRow.id });
              persisted = true;
            } catch { persisted = false; }
          }
          const elapsed = Math.round((Date.now() - askedAt) / 1e3);
          if (!persisted) {
            return { exitCode: 1, stdout: `The question could not be recorded (interrupted storage). STOP and wait: do NOT proceed with the workflow. On your next turn, if no pending question exists on the card, ask it ONCE more via bb stelow ask.` };
          }
          const why = interruptionWhy(cancelReason, requestFailed, elapsed);
          return { exitCode: 1, stdout: `${why} STOP and wait: do NOT proceed with the workflow. The question is still pending on the card (Gate pending) and remains answerable. When the user answers it on the card, the answer is delivered here as a message and you may continue. If you are re-asked about this same question later, do not re-ask the user again — wait for the card answer.` };
        }
        return { exitCode: result.outcome === "submitted" ? 0 : 1, stdout: JSON.stringify(result) };
      }
      if (argv[0] === "seed") {
        const flag = (name: string) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
        const projectId = flag("--project") ?? ctx.projectId;
        const name = flag("--name");
        const intent = flag("--intent");
        if (!projectId || !name || !intent) return { exitCode: 2, stderr: "Usage: bb stelow seed --project <proj_id> --name <name> --intent <intent>" };
        const rootPath = await projectRoot(bb, projectId);
        if (!rootPath) return { exitCode: 1, stderr: "Project workspace path is unavailable." };
        const result = await seedWorkflow(bb, rootPath, name, intent);
        return result.error ? { exitCode: 1, stderr: result.error } : { exitCode: 0, stdout: result.statePath ?? "" };
      }
      if (argv[0] === "advance") {
        const args = argv.slice(1);
        const flag = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
        const projectId = flag("--project") ?? ctx.projectId;
        const stage = flag("--stage") ?? args.find((arg) => !arg.startsWith("--") && arg !== projectId);
        if (!projectId || !stage) return { exitCode: 2, stderr: "Usage: bb stelow advance [--project <proj_id>] [--stage <stage>] <stage>" };
        // The agent runs this from within its worker thread; resolve the owning
        // card first so Personal/exploratory work uses its own workspace.
        const cliCard = ctx.threadId ? getCardByWorkerThread(ctx.threadId) : undefined;
        const workspace = cliCard ? await cardWorkspace(cliCard) : null;
        const rootPath = workspace?.path ?? await projectRoot(bb, projectId);
        if (!rootPath) return { exitCode: 1, stderr: "Workspace path is unavailable." };
        const stateDir = cliCard?.dir_hash ? await workflowStateDir(bb, rootPath, cliCard.dir_hash) : null;
        const guard = await ensureProjectArtifacts(bb, rootPath, stateDir);
        if (guard) return { exitCode: 1, stderr: guard };
        const result = await runHelper(["advance", stage], rootPath, stateDir ?? undefined);
        if (result.code !== 0) return { exitCode: 1, stderr: result.stderr || "advance failed", stdout: result.stdout };
        if (cliCard) updateCard(cliCard.id, { stage, status: stage === "audit" ? "completed" : "in-progress", activity: "running", last_error: null });
        // Band-preset swap: if the band of the stage just advanced to defines a
        // preset different from the one this worker was spawned with, respawn the
        // worker with that band preset on the same state dir. Deferred (setTimeout)
        // so the current handle returns its output before the worker is replaced.
        if (cliCard) {
          const band = STAGE_TO_BAND[stage];
          if (band) {
            const bandPreset = getPresetForBand(band, cliCard.id);
            const currentPresetId = cliCard.worker_preset_id ?? getPresetForCard(cliCard.id).id;
            if (bandPreset.id !== currentPresetId) {
              const targetId = cliCard.id;
              setTimeout(() => { respawnWorkerForBand(targetId, bandPreset.id).catch(() => {}); }, 10);
            }
          }
        }
        return { exitCode: 0, stdout: result.stdout };
      }
      if (argv[0] === "preset") {
        const sub = argv[1];
        const flag = (name: string, list: string[]) => { const index = list.indexOf(name); return index >= 0 ? list[index + 1] : undefined; };
        const rows = (db.prepare("SELECT * FROM presets WHERE id NOT LIKE 'card-override-%' ORDER BY is_default DESC, name COLLATE NOCASE ASC").all() as PresetRow[]);
        if (!sub || sub === "list") {
          return { exitCode: 0, stdout: rows.map((row) => `${row.id}\t${row.is_default === 1 ? "*" : " "}${row.built_in === 1 ? "B" : " "}\t${row.name}\t${row.provider_id}/${row.model_id}\t${row.reasoning_level}\t${row.permission_mode}`).join("\n") };
        }
        if (sub === "add") {
          const args = argv.slice(2);
          const name = flag("--name", args);
          const providerId = flag("--provider", args) ?? "pi";
          const modelId = flag("--model", args) ?? "bifrost/harness-coding";
          const reasoningLevel = flag("--reasoning", args) ?? "medium";
          const permissionMode = flag("--permission", args) ?? "full";
          const environmentKind = (flag("--workspace", args) ?? "project-default") as "project-default" | "new-worktree";
          const instructions = flag("--instructions", args) ?? "";
          if (!name) return { exitCode: 2, stderr: "Usage: bb stelow preset add --name <name> [--provider <id>] [--model <id>] [--reasoning <level>] [--permission <mode>] [--workspace <kind>] [--instructions <text>]" };
          try {
            const result = await upsertPresetHandler({ id: null, name, providerId, modelId, reasoningLevel, permissionMode: permissionMode as "accept-edits" | "auto" | "full", environmentKind, baseBranch: null, machineId: null, instructions });
            return { exitCode: 0, stdout: `OK ${result.preset.id} ${result.preset.name}` };
          } catch (error) {
            return { exitCode: 1, stderr: error instanceof Error ? error.message : "Unable to add preset." };
          }
        }
        if (sub === "remove") {
          const id = argv[2];
          if (!id) return { exitCode: 2, stderr: "Usage: bb stelow preset remove <id>" };
          const result = await deletePresetHandler({ id });
          if (!result.deleted) return { exitCode: 1, stderr: result.error ?? "Could not remove preset." };
          return { exitCode: 0, stdout: `Removed ${id}` };
        }
        if (sub === "assign") {
          const args = argv.slice(2);
          const cardId = flag("--card", args);
          const presetId = flag("--preset", args);
          if (!cardId || !presetId) return { exitCode: 2, stderr: "Usage: bb stelow preset assign --card <card_id> --preset <preset_id>" };
          const result = await assignPresetHandler({ cardId, presetId });
          if (!result.ok) return { exitCode: 1, stderr: result.error ?? "Could not assign preset." };
          return { exitCode: 0, stdout: `Assigned ${presetId} to ${cardId}` };
        }
        return { exitCode: 2, stderr: "Usage: bb stelow preset list|add|remove|assign" };
      }
      return { exitCode: 2, stderr: "Usage: bb stelow status|ask|seed|advance|preset" };
    },
  });

  const upsertPresetHandler = async ({ id, name, providerId, modelId, reasoningLevel, permissionMode, environmentKind, baseBranch, machineId, instructions }: { id: string | null; name: string; providerId: string; modelId: string; reasoningLevel: string; permissionMode: "accept-edits" | "auto" | "full"; environmentKind: "project-default" | "new-worktree"; baseBranch: string | null; machineId: string | null; instructions: string }) => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Preset name is required.");
    const effectiveId = id ?? `preset_${Math.random().toString(36).slice(2, 10)}`;
    const collision = db.prepare("SELECT id FROM presets WHERE LOWER(name) = LOWER(?) AND id != ?").get(trimmed, effectiveId) as { id: string } | undefined;
    if (collision) throw new Error(`A preset named "${trimmed}" already exists.`);
    const existing = db.prepare("SELECT id, built_in FROM presets WHERE id = ?").get(effectiveId) as { id: string; built_in: number } | undefined;
    if (existing?.built_in === 1 && (!id || id !== effectiveId)) throw new Error("Built-in presets cannot be renamed or duplicated; create a new one instead.");
    const ts = now();
    if (existing) {
      db.prepare("UPDATE presets SET name = ?, provider_id = ?, model_id = ?, reasoning_level = ?, permission_mode = ?, environment_kind = ?, base_branch = ?, machine_id = ?, instructions = ?, updated_at = ? WHERE id = ?").run(trimmed, providerId, modelId, reasoningLevel, permissionMode, environmentKind, baseBranch ?? null, machineId ?? null, instructions, ts, effectiveId);
    } else {
      db.prepare("INSERT INTO presets (id, name, provider_id, model_id, reasoning_level, permission_mode, environment_kind, base_branch, machine_id, instructions, is_default, built_in, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)").run(effectiveId, trimmed, providerId, modelId, reasoningLevel, permissionMode, environmentKind, baseBranch ?? null, machineId ?? null, instructions, ts, ts);
    }
    return { preset: { id: effectiveId, name: trimmed } };
  };

  const deletePresetHandler = async ({ id }: { id: string }) => {
    const row = db.prepare("SELECT built_in FROM presets WHERE id = ?").get(id) as { built_in: number } | undefined;
    if (!row) return { deleted: false, error: ERR_PRESET_NOT_FOUND };
    if (row.built_in === 1) return { deleted: false, error: "Built-in presets cannot be deleted." };
    const inUse = db.prepare("SELECT COUNT(*) AS count FROM card_presets WHERE preset_id = ?").get(id) as { count: number };
    if (inUse.count > 0) return { deleted: false, error: `Preset is assigned to ${inUse.count} card(s). Unassign first.` };
    db.prepare("DELETE FROM presets WHERE id = ?").run(id);
    return { deleted: true, error: null };
  };

  const assignPresetHandler = async ({ cardId, presetId }: { cardId: string; presetId: string | null }) => {
    const card = getCard(cardId);
    if (!card) return { ok: false, error: ERR_CARD_NOT_FOUND };
    if (presetId === null) {
      db.prepare("DELETE FROM card_presets WHERE card_id = ?").run(cardId);
    } else {
      const preset = getPresetById(presetId);
      if (!preset) return { ok: false, error: ERR_PRESET_NOT_FOUND };
      db.prepare("INSERT OR REPLACE INTO card_presets (card_id, preset_id, assigned_at) VALUES (?, ?, ?)").run(cardId, presetId, now());
      refreshRestartPending(db, cardId, card.worker_thread_id, card.worker_preset_id, presetId);
    }
    bb.realtime.publish("card-state", { cardId });
    return { ok: true, error: null };
  };

  bb.ui.registerMentionProvider({
    id: "workflow",
    label: "Stelow workflows",
    triggers: ["@"],
    async search({ query, projectId }) {
      const board = await loadBoard(bb, projectId ?? null);
      const needle = query.toLowerCase();
      const fromBoard = board.workflows.filter((workflow) => workflow.name.toLowerCase().includes(needle)).slice(0, 20).map((workflow) => ({ id: workflow.id, title: workflow.name, subtitle: `${workflow.stage} · ${workflow.status}` }));
      // Boards are project-root scoped and miss exploratory cards (per-card
      // stelow.json). Fall back to the cards table so every card is findable.
      const cardRows = (projectId
        ? db.prepare("SELECT id, display_name, name, stage, status, intent, dir_hash FROM cards WHERE project_id = ? AND status != 'archived'").all(projectId)
        : db.prepare("SELECT id, display_name, name, stage, status, intent, dir_hash FROM cards WHERE status != 'archived'").all()) as Array<{ id: string; display_name: string | null; name: string; stage: string; status: string; intent: string; dir_hash: string | null }>;
      const fromCards = cardRows
        .filter((card) => (card.display_name ?? card.name).toLowerCase().includes(needle))
        .slice(0, 20)
        .map((card) => ({ id: card.dir_hash ?? card.id, title: card.display_name ?? card.name, subtitle: `${card.stage} · ${card.status} · ${card.intent}` }));
      const seen = new Set(fromBoard.map((item) => item.id));
      return [...fromBoard, ...fromCards.filter((item) => !seen.has(item.id))].slice(0, 20);
    },
    async resolve(itemId) {
      const projects = await bb.sdk.projects.list({ includePersonal: true });
      for (const project of projects) {
        const board = await loadBoard(bb, project.id);
        const workflow = board.workflows.find((item) => item.id === itemId);
        if (workflow) return { context: `Stelow workflow ${workflow.name}: stage=${workflow.stage}, status=${workflow.status}, appetite=${workflow.appetite}, review_mode=${workflow.reviewMode}. Scopes: ${workflow.scopes.map((scope) => `${scope.id}:${scope.status}`).join(", ") || "none"}.` };
      }
      const card = db.prepare("SELECT display_name, name, stage, status, intent FROM cards WHERE dir_hash = ? OR id = ?").get(itemId, itemId) as { display_name: string | null; name: string; stage: string; status: string; intent: string } | undefined;
      if (card) return { context: `Stelow work item ${card.display_name ?? card.name}: stage=${card.stage}, status=${card.status}, intent=${card.intent}.` };
      throw new Error("Stelow workflow no longer exists.");
    },
  });

  // File mentions: type @ + filename in any composer (including the Stelow
  // board) to insert a workspace file reference the agent can open/read.
  bb.ui.registerMentionProvider({
    id: "file",
    label: "Workspace files",
    triggers: ["@"],
    async search({ query, projectId }) {
      if (!projectId) return [];
      const project = await bb.sdk.projects.get({ projectId }).catch(() => null);
      const root = project?.sources.find((entry) => entry.isDefault)?.path ?? null;
      if (!root) return [];
      const listed = await bb.sdk.files.list({ path: root, query, limit: 20 }).catch(() => null);
      return (listed?.files ?? []).slice(0, 20).map((file) => ({ id: file.path, title: file.path.split("/").pop() ?? file.path, subtitle: file.path }));
    },
    async resolve(itemId) {
      return { context: `Workspace file: ${itemId}` };
    },
  });
}

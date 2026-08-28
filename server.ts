import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join as nodeJoin, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

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
const PLUGIN_ORCHESTRATOR_REF = nodeJoin(PLUGIN_SKILLS_DIR, "stelow-product-orchestrator", "references");

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
const STATE_TEMPLATE = `---\nname: <workflow-name>\nintent: <new-product|feature|bugfix|refactor|investigate|unknown>\ncurrent_stage: triage\nstatus: active\nconfig:\n  appetite: Core\n  review_mode: Auto\n  product_type: software\nstages:\n  triage: pending\n  select: pending\n  setup: pending\n  context: pending\n  shape: pending\n  critique: pending\n  gate: pending\n  scope: pending\n  interface: pending\n  int-gate: pending\n  selection: pending\n  planning: pending\n  plan-gate: pending\n  execution: pending\n  verification: pending\n  diff-gate: pending\n  audit: pending\nartifacts: {}\nhistory: []\n---\n`;

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

const statusSchema = z.enum([
  "draft",
  "planning",
  "approved",
  "in-progress",
  "awaiting-answer",
  "completed",
  "archived",
  "pending",
  "done",
  "skipped",
  "blocked",
  "escalated",
  "failed",
]);

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
    }),
  },
  projects: {
    input: z.object({}).strict(),
    output: z.object({ projects: z.array(z.object({ id: z.string(), name: z.string() })) }),
  },
  readDocument: {
    input: z.object({ projectId: z.string().nullable(), path: z.string() }).strict(),
    output: z.object({ content: z.string(), sha256: z.string(), error: z.string().nullable() }),
  },
  addComment: {
    input: z.object({
      projectId: z.string().nullable(),
      path: z.string(),
      expectedSha256: z.string(),
      selectedText: z.string().max(10_000),
      comment: z.string().min(1).max(10_000),
    }).strict(),
    output: z.object({ saved: z.boolean(), sha256: z.string().optional(), error: z.string().nullable() }),
  },
  answerQuestion: {
    input: z.object({ cardId: z.string(), answers: z.array(z.string()) }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  listCards: {
    input: z.object({ projectId: z.string().nullable() }).strict(),
    output: z.object({ cards: z.array(z.object({ id: z.string(), name: z.string(), displayName: z.string(), prompt: z.string(), intent: z.string(), projectId: z.string(), projectName: z.string(), status: statusSchema, stage: z.string(), workerThreadId: z.string().nullable(), activity: z.enum(["idle", "running", "awaiting-answer", "error"]), lastError: z.string().nullable(), needsAttention: z.boolean(), attentionKind: z.enum(["question", "error", "completed", "idle"]).nullable(), presetName: z.string().nullable(), updatedAt: z.number() })) }),
  },
  createCard: {
    input: z.object({ projectId: z.string(), prompt: z.string().min(1).max(20_000), intent: z.enum(["new-product", "feature", "bugfix", "refactor", "investigate", "unknown"]).default("unknown"), presetId: z.string().nullable().optional() }).strict(),
    output: z.object({ cardId: z.string(), threadId: z.string() }),
  },
  updateCardIntent: {
    input: z.object({ cardId: z.string(), intent: z.enum(["new-product", "feature", "bugfix", "refactor", "investigate", "unknown"]) }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  cardDetail: {
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({
      card: z.object({ id: z.string(), name: z.string(), displayName: z.string(), prompt: z.string(), intent: z.string(), projectId: z.string(), projectName: z.string(), status: statusSchema, stage: z.string(), workerThreadId: z.string().nullable(), activity: z.enum(["idle", "running", "awaiting-answer", "error"]), lastError: z.string().nullable(), needsAttention: z.boolean(), attentionKind: z.enum(["question", "error", "completed", "idle"]).nullable(), presetName: z.string().nullable(), updatedAt: z.number() }),
      mentionedFiles: z.array(z.object({ path: z.string(), display: z.string() })),
      scopes: z.array(z.object({ id: z.string(), name: z.string(), type: z.string().optional(), status: statusSchema, blockedBy: z.array(z.string()).optional(), dependsOn: z.array(z.string()).optional(), tasks: z.array(z.object({ id: z.string(), name: z.string(), status: statusSchema, source: z.string().optional(), note: z.string().optional() })) })),
      comments: z.array(z.object({ id: z.string(), target: z.enum(["card", "scope", "task"]), targetId: z.string(), author: z.enum(["user", "agent"]), body: z.string(), createdAt: z.number() })),
      pendingQuestions: z.array(z.object({ id: z.string(), title: z.string(), question: z.string(), multiple: z.boolean(), options: z.array(z.object({ label: z.string(), description: z.string() })), expiresAt: z.number().nullable() })),
      expiredQuestions: z.array(z.object({ id: z.string(), question: z.string(), multiple: z.boolean(), options: z.array(z.object({ label: z.string(), description: z.string() })), expiredAt: z.number() })),
      artifacts: z.array(z.object({ stage: z.string(), path: z.string(), display: z.string() })),
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
  moveCard: {
    input: z.object({ cardId: z.string(), status: statusSchema }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  markCardSeen: {
    input: z.object({ cardId: z.string(), kind: z.enum(["completed", "error", "question"]).optional() }).strict(),
    output: z.object({ ok: z.boolean() }),
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
      id: z.string().nullable().optional(),
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
      providers: z.array(z.object({ id: z.string(), displayName: z.string() })),
      models: z.array(z.object({ providerId: z.string(), model: z.string(), displayName: z.string() })),
    }),
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

async function seedWorkflow(bb: BbPluginApi, rootPath: string, name: string, intent: string): Promise<{ statePath: string | null; stateDir: string | null; dirHash: string | null; error: string | null }> {
  const transitionsPath = join(rootPath, "skills/stelow-product-orchestrator/references/transitions.md");
  const trackingPath = join(rootPath, "stelow.json");
  try {
    mkdirSync(join(rootPath, ".stelow/approvals"), { recursive: true });
    mkdirSync(join(rootPath, "skills/stelow-product-orchestrator/references"), { recursive: true });

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
    if (entry && entry.dirHash && (await bb.sdk.files.read({ path: join(rootPath, `.stelow/${text(entry.created).slice(0, 10)}/${text(entry.dirHash)}/state.md`) }).then((f) => f.content.includes("current_stage:")).catch(() => false))) {
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
      writeFileSync(statePath, body, "utf8");
    }

    if (!existsSync(transitionsPath)) {
      writeFileSync(transitionsPath, readFileSync(TRANSITIONS_REF, "utf8"), "utf8");
    }

    const hasEntry = (trackingData.workflows as Array<LooseRecord>).some((workflow) => workflow.name === name && workflow.dirHash === dirHash);
    if (!hasEntry) {
      (trackingData.workflows as unknown[]).push({ name, description: "", status: "in-progress", cwd: rootPath, dirHash, created: new Date().toISOString(), updated: new Date().toISOString(), stage: { current_stage: "triage", previous_stage: null, transitioned_at: new Date().toISOString(), history: [{ stage: "triage", entered_at: new Date().toISOString() }] }, phases: [], config: { appetite: "Core", review_mode: "Auto" } });
      writeFileSync(trackingPath, JSON.stringify(trackingData, null, 2), "utf8");
    }
    return { statePath, stateDir, dirHash, error: null };
  } catch (error) {
    return { statePath: null, stateDir: null, dirHash: null, error: error instanceof Error ? error.message : "Unable to seed workflow." };
  }
}

async function detectMentionedFiles(bb: BbPluginApi, rootPath: string | null, text: string): Promise<Array<{ path: string; display: string }>> {
  if (!rootPath) return [];
  const candidates = new Set<string>();
  // Match file-ish tokens: path/to/file.ext (no spaces, may include -_./)
  for (const match of text.matchAll(/\b(?:(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:md|markdown|txt|json|yaml|yml|toml|ts|tsx|js|jsx|py|go|rs|sh|css|html|env))(?:\b|(?=[\s,.;:)]))/g)) {
    const token = match[0]!.replace(/[.,;:)]+$/, "");
    if (token.length >= 3 && token.length <= 120) candidates.add(token);
  }
  const found: Array<{ path: string; display: string }> = [];
  for (const candidate of candidates) {
    try {
      await bb.sdk.files.read({ path: join(rootPath, candidate) });
      found.push({ path: candidate, display: candidate });
    } catch { /* not found in workspace root */ }
  }
  if (found.length === 0) {
    // Fall back: check the raw basename anywhere under the workspace.
    for (const candidate of candidates) {
      const basename = candidate.split("/").pop()!;
      if (!basename) continue;
      const listed = await bb.sdk.files.list({ path: rootPath, query: basename }).catch(() => null);
      const hit = (listed?.files ?? []).find((entry) => entry.path.endsWith(basename));
      if (hit) found.push({ path: hit.path, display: hit.path });
    }
  }
  return found.slice(0, 6);
}

function parseNextStages(rootPath: string | null, currentStage: string): string[] {
  if (!rootPath) return [];
  const transitionsPath = join(rootPath, "skills/stelow-product-orchestrator/references/transitions.md");
  if (!existsSync(transitionsPath)) return [];
  let content: string;
  try { content = readFileSync(transitionsPath, "utf8"); } catch { return []; }
  const block = content.match(new RegExp(`^### ${currentStage}\\s*\\n([\\s\\S]*?)(?=^### |\\Z)`, "m"));
  if (!block) return [];
  const stages = new Set<string>();
  for (const raw of block[1].split("\n")) {
    const line = raw.trim();
    for (const key of ["next", "accept", "rework"] as const) {
      const match = line.match(new RegExp(`^${key}:\\s*(.*)$`));
      if (!match) continue;
      for (const token of match[1].split(",")) {
        const stage = token.replace(/[\[\]\s"']/g, "");
        // Parenthesized tokens are markers ((none), (done), …), not stages.
        if (stage && !stage.includes("(")) stages.add(stage);
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
  const transitions = join(rootPath, "skills/stelow-product-orchestrator/references/transitions.md");
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
    const env: Record<string, string> = { ...(process.env as Record<string, string>), STELOW_TRANSITIONS: nodeJoin(cwd, "skills/stelow-product-orchestrator/references/transitions.md") };
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
        return {
          id: text(task.id, `task-${taskIndex + 1}`),
          name: text(task.name, text(task.title, `Task ${taskIndex + 1}`)),
          status: normalizeStatus(task.status),
          ...(typeof task.source === "string" ? { source: task.source } : {}),
          ...(typeof task.note === "string" ? { note: task.note } : {}),
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
  const tracking = await readJson(bb.sdk.files, join(rootPath, "stelow.json"));
  if (!tracking) return { rootPath, workflows: [], error: "No stelow.json found in this project. Start a Stelow workflow first." };

  const workflows: Workflow[] = [];
  for (const [index, value] of array(tracking.workflows).entries()) {
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
  if (!cardColumns.some((column) => column.name === "last_seen_completed_at")) {
    db.exec("ALTER TABLE cards ADD COLUMN last_seen_completed_at INTEGER");
  }
  if (!cardColumns.some((column) => column.name === "display_name")) {
    db.exec("ALTER TABLE cards ADD COLUMN display_name TEXT");
  }
  if (!cardColumns.some((column) => column.name === "last_seen_error_at")) {
    db.exec("ALTER TABLE cards ADD COLUMN last_seen_error_at INTEGER");
  }
  if (!cardColumns.some((column) => column.name === "last_seen_question_at")) {
    db.exec("ALTER TABLE cards ADD COLUMN last_seen_question_at INTEGER");
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
  // stage_presets may not be applied by bb.storage.migrate on existing DBs,
  // so ensure it idempotently here as well.
  db.exec(`CREATE TABLE IF NOT EXISTS stage_presets (
    band TEXT PRIMARY KEY CHECK (band IN ('analysis','planning','execution','review')),
    preset_id TEXT NOT NULL,
    assigned_at INTEGER NOT NULL,
    FOREIGN KEY (preset_id) REFERENCES presets(id) ON DELETE CASCADE
  )`);

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

  type CardRow = { id: string; project_id: string; name: string; display_name: string | null; prompt: string; intent: string; status: string; stage: string; activity: string; worker_thread_id: string | null; worker_preset_id: string | null; dir_hash: string | null; last_error: string | null; last_assistant_text: string | null; last_seen_completed_at: number | null; last_seen_error_at: number | null; last_seen_question_at: number | null; last_idle_at: number | null; created_at: number; updated_at: number };
  type CommentRow = { id: string; card_id: string; target: string; target_id: string; author: string; body: string; created_at: number };
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

  // Resolve the worker preset for a stage band. A configured band preset
  // overrides the card's preset; otherwise fall back to the card preset so
  // existing cards (with no band preset) behave exactly as before.
  function getPresetForBand(band: string, cardId: string): PresetRow {
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
  async function respawnWorkerForBand(cardId: string, presetId: string): Promise<{ ok: boolean; error?: string; threadId?: string }> {
    const row = getCard(cardId);
    if (!row) return { ok: false, error: "Card not found." };
    const preset = getPresetById(presetId);
    if (!preset) return { ok: false, error: "Preset not found." };
    const params = presetAttachmentParams(preset);
    let projectPath = "";
    try {
      const project = await bb.sdk.projects.get({ projectId: row.project_id });
      projectPath = project.sources.find((s) => s.isDefault)?.path ?? project.sources[0]?.path ?? "";
    } catch { /* project gone; still respawn */ }
    // Resolve the real per-workflow state dir (stelow.json -> created date), so
    // the respawned worker is told the correct path — never a guessed date.
    let stateDir: string | null = null;
    if (row.dir_hash && projectPath) {
      stateDir = await workflowStateDir(bb, projectPath, row.dir_hash).catch(() => null);
    }
    const stateHint = stateDir ?? (row.dir_hash ? ".stelow/<date>/" + row.dir_hash : "<project>/.stelow/<date>/<dirHash>");
    try {
      const newThread = await bb.sdk.threads.spawn({
        projectId: row.project_id,
        environment: { type: "project-default" },
        visibility: "hidden",
        title: `Stelow: ${row.display_name ?? row.name}`,
        providerId: params.providerId,
        model: params.modelId,
        reasoningLevel: params.reasoningLevel as "low" | "medium" | "high" | "xhigh" | "max" | "none" | "ultra" | "ultracode",
        permissionMode: params.permissionMode as "accept-edits" | "auto" | "full",
        executionInputSources: { providerId: "explicit", model: "explicit", reasoningLevel: "explicit", permissionMode: "explicit" },
        prompt: `You are running a Stelow workflow inside the bb-plugin-stelow panel. The host re-seeded your per-workflow state, transitions.md, and stelow.json. Your workflow owns its own state dir (${text(stateHint)}) — its state.md holds name, intent, current_stage, status.${stateDir ? "" : " Resolve the exact path from stelow.json; its state.md holds name, intent, current_stage, status."} The Stelow workflow skills (stelow-entry, stelow-router, stelow-product-*) are provided by this plugin — start by loading them (they live under the plugin's skills directory; \`bb skill list\` shows them). Use \`bb stelow advance <stage>\` to change stages (do NOT hand-edit current_stage). Preserve every gate (product, interface, tech plan, diff).

The user already classified this request as intent=\`${row.intent}\` (recorded in state.md). Use that intent — do NOT ask the user to pick an intent again.${row.intent === "unknown" ? " Since no intent was pre-selected, determine the most fitting one yourself during triage (new-product, feature, bugfix, refactor, or investigate) and record it in state.md — only ask the user if it is genuinely ambiguous." : ""}

You are being restarted mid-workflow at a stage boundary so a new preset can take over for this phase. Read your state.md and transitions.md, and CONTINUE the workflow from the current stage. Do not restart from triage; do not re-confirm what is already settled in state.md. Pick up exactly where the workflow left off.

CRITICAL — User input contract:
ANY time you need user input, you MUST call the structured form:

    bb stelow ask --thread <this_thread_id> \\\\
      --question "<a single clear question>" \\\\
      --option "<label 1>" --option "<label 2>" [--option "<label 3>" ...] [--multiple]

Before asking a question, first summarize what you read (files, plan, codebase) so the user can answer with context. Each bb stelow ask call blocks until the user submits; the card moves to the "Gate pending" column automatically. Never re-ask the same question. Stop when the user archives the card or the workflow reaches \`audit\`.

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
      db.prepare("UPDATE cards SET worker_thread_id = ?, worker_preset_id = ?, activity = ?, last_error = ?, updated_at = ? WHERE id = ?").run(newThread.id, preset.id, "running", null, ts, cardId);
      bb.realtime.publish("card-state", { cardId });
      return { ok: true, threadId: newThread.id };
    } catch (error) {
      // Spawn failed — surface it instead of leaving a silent zombie card.
      const msg = error instanceof Error ? error.message : "Respawn failed.";
      db.prepare("UPDATE cards SET activity = ?, last_error = ?, updated_at = ? WHERE id = ?").run("error", msg, now(), cardId);
      bb.realtime.publish("card-state", { cardId });
      return { ok: false, error: msg };
    }
  }

  function getCard(cardId: string): CardRow | undefined {
    return db.prepare("SELECT * FROM cards WHERE id = ?").get(cardId) as CardRow | undefined;
  }
  function updateCard(cardId: string, fields: Partial<Omit<CardRow, "id" | "project_id" | "intent" | "prompt" | "name" | "created_at">>): void {
    // Hot-reload race: bb closes the plugin DB while syncThreadState callbacks
    // are still in flight; writing then crashes the whole server process.
    if (!(db as unknown as { open?: boolean }).open) return;
    const next = { updated_at: now(), ...fields };
    const keys = Object.keys(next);
    if (keys.length === 0) return;
    db.prepare(`UPDATE cards SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE id = @id`).run({ id: cardId, ...next });
    bb.realtime.publish("card-state", { cardId });
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
    try {
      // Resolve this card's own per-workflow state file (not a shared root state.md).
      const projectPath = await projectRoot(bb, card.project_id);
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
      const lastOutput = (await bb.sdk.threads.output({ threadId: card.worker_thread_id }).catch(() => null))?.output ?? null;
      // Stage source of truth is state.md (the agent advances it via `bb stelow
      // advance`); the DB `stage` is only written by the manual advanceCard RPC.
      let currentStage = card.stage;
      if (stateBlob) {
        currentStage = text(stateBlob.match(/current_stage:\s*(\S+)/m)?.[1]) || card.stage;
      }
      if (status === "active") {
        const pending = await fetchPendingQuestions(card.worker_thread_id);
        if (pending.length > 0) {
          updateCard(cardId, { activity: "awaiting-answer", last_assistant_text: lastOutput, status: "awaiting-answer" });
        } else {
          // Keep freshly-created cards in the Triage column (draft) while the
          // workflow is still at the triage stage, even though the thread is
          // already active. Only move to Running (in-progress) once the agent
          // has advanced past triage (current_stage != triage) or resumed from
          // a gate (status was awaiting-answer).
          const stillTriaging = currentStage === "triage" && card.status === "draft";
          const nextStatus = stillTriaging ? "draft" : card.status === "draft" || card.status === "awaiting-answer" ? "in-progress" : card.status;
          const updates: Record<string, unknown> = { activity: "running" as const, last_assistant_text: lastOutput, status: nextStatus };
          if (currentStage !== card.stage) updates.stage = currentStage;
          updateCard(cardId, updates);
        }
      } else if (status === "idle") {
        const expiredPending = db.prepare("SELECT id FROM expired_questions WHERE card_id = ? AND answered = 0").get(cardId) as { id: string } | undefined;
        const transitioningIntoIdle = card.activity !== "idle";
        if (expiredPending) {
          // The worker stopped (likely a timed-out ask) but a question is
          // still unanswered — keep the card in Gate pending so it does not
          // look abandoned. Answering it on the card resumes the thread.
          updateCard(cardId, { activity: "awaiting-answer", last_assistant_text: lastOutput, status: "awaiting-answer" });
        } else {
          updateCard(cardId, { activity: "idle", last_assistant_text: lastOutput, last_idle_at: transitioningIntoIdle ? now() : card.last_idle_at });
        }
        if (lastOutput && lastOutput !== card.last_assistant_text) {
          db.prepare("INSERT INTO comments (id, card_id, target, target_id, author, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(randomId("cmt"), cardId, "card", cardId, "agent", lastOutput, now());
        }
      } else if (status === "failed") {
        updateCard(cardId, { activity: "error", last_error: "Worker thread failed." });
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
    if (row) updateCard(row.id, { activity: "error", last_error: error ?? "Worker thread failed." });
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

  bb.onDispose(async () => {
    const rows = db.prepare("SELECT id, worker_thread_id FROM cards WHERE worker_thread_id IS NOT NULL AND status != 'archived'").all() as Array<{ id: string; worker_thread_id: string }>;
    for (const row of rows) {
      try { await bb.sdk.threads.stop({ threadId: row.worker_thread_id }); } catch { /* ignore */ }
    }
  });

  bb.rpc.register(rpcContract, {
    board: ({ projectId }) => loadBoard(bb, projectId),
    projects: async () => {
      const list = await bb.sdk.projects.list();
      return { projects: list.map((project) => ({ id: project.id, name: project.name })) };
    },

    async readDocument({ projectId, path }) {
      const root = await projectRoot(bb, projectId);
      if (!root) return { content: "", sha256: "", error: "Project workspace path is unavailable." };
      try {
        const file = await bb.sdk.files.read({ path: join(root, safeRelative(path)) });
        return { content: file.content, sha256: file.sha256, error: null };
      } catch (error) {
        return { content: "", sha256: "", error: error instanceof Error ? error.message : "Unable to read document." };
      }
    },

    async addComment({ projectId, path, expectedSha256, selectedText, comment }) {
      const root = await projectRoot(bb, projectId);
      if (!root) return { saved: false, error: "Project workspace path is unavailable." };
      const absolute = join(root, safeRelative(path));
      const file = await bb.sdk.files.read({ path: absolute });
      const quote = selectedText.trim() ? `\n> ${selectedText.trim().replace(/\n/g, "\n> ")}\n` : "";
      const block = `\n\n<!-- stelow-review-comment -->\n### Review comment\n${quote}\n${comment.trim()}\n`;
      const result = await bb.sdk.files.write({ path: absolute, rootPath: root, expectedSha256, content: `${file.content.replace(/\s*$/, "")}\n${block}` });
      if (result.outcome === "conflict") return { saved: false, error: "The document changed. Reload before commenting." };
      bb.realtime.publish("board-changed", { path });
      return { saved: true, sha256: result.sha256, error: null };
    },

    async approveGate({ projectId, workflowId, gate }) {
      const board = await loadBoard(bb, projectId);
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
        prompt: `Use the stelow workflow to shape and execute this request. The Stelow workflow skills (stelow-entry, stelow-router, stelow-product-*) are provided by bb-plugin-stelow — load them first. Use \`bb stelow advance <stage>\` to change stages; do NOT hand-write stage transitions. Preserve every gate (product, interface, tech plan, diff).\n\nRequest:\n${prompt}`,
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

    async listCards({ projectId }) {
      const stmt = projectId
        ? db.prepare("SELECT * FROM cards WHERE project_id = ? ORDER BY updated_at DESC")
        : db.prepare("SELECT * FROM cards ORDER BY updated_at DESC");
      const rows = (projectId ? stmt.all(projectId) : stmt.all()) as CardRow[];
      const projectsList = await bb.sdk.projects.list();
      const projectMap = new Map(projectsList.map((project) => [project.id, project.name]));
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
        // action (answer / inspect / review / retake). The four causes are
        // surfaced identically — only the verb differs — so idle-stuck,
        // question, error and completion all count as "needs attention".
        const termStatus = ["completed", "archived", "blocked"].includes(normalizeStatus(row.status));
        const idleStuck = activity === "idle"
          && row.worker_thread_id !== null
          && !termStatus
          && (row.last_idle_at ?? 0) > 0
          && now() - (row.last_idle_at ?? 0) >= IDLE_ATTENTION_MS;
        const questionPending = activity === "awaiting-answer" && (row.last_seen_question_at ?? 0) < row.updated_at;
        const errorPending = (Boolean(row.last_error) || activity === "error") && (row.last_seen_error_at ?? 0) < row.updated_at;
        const completedPending = normalizeStatus(row.status) === "completed" && (row.last_seen_completed_at ?? 0) < row.updated_at;
        const attentionKind = (idleStuck ? "idle" : questionPending ? "question" : errorPending ? "error" : completedPending ? "completed" : null) as "question" | "error" | "completed" | "idle" | null;
        const needsAttention = attentionKind !== null;
        const preset = getPresetForCard(row.id);
        return {
          id: row.id,
          name: row.name,
          displayName: row.display_name ?? row.name,
          prompt: row.prompt,
          intent: row.intent,
          projectId: row.project_id,
          projectName: projectMap.get(row.project_id) ?? row.project_id,
          status: normalizeStatus(row.status),
          stage: row.stage,
          workerThreadId: row.worker_thread_id,
          activity,
          lastError: row.last_error,
          needsAttention,
          attentionKind,
          presetName: preset.name,
          updatedAt: row.updated_at,
        };
      }));
      return { cards: enriched };
    },

    async createCard({ projectId, prompt, intent, presetId }) {
      const rootPath = await projectRoot(bb, projectId);
      if (!rootPath) throw new Error("Project workspace path is unavailable.");
      const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "stelow";
      const displayName = prompt.replace(/\s+/g, " ").trim().split(/\s+/).slice(0, 8).join(" ").slice(0, 60) || slug;
      const seed = await seedWorkflow(bb, rootPath, slug, intent);
      if (seed.error) throw new Error(seed.error);
      const cardId = randomId("card");
      const preset = presetId ? (getPresetById(presetId) ?? getDefaultPreset()) : getDefaultPreset();
      // A card always spawns into the analysis band (triage). Honor a configured
      // analysis band preset at first spawn (band override wins), else fall back
      // to the card/dedicated preset. `worker_preset_id` records the actual
      // spawn preset so later band transitions compare correctly.
      const analysisRow = db.prepare("SELECT preset_id FROM stage_presets WHERE band = 'analysis'").get() as { preset_id: string } | undefined;
      const spawnPreset = analysisRow ? (getPresetById(analysisRow.preset_id) ?? preset) : preset;
      const params = presetAttachmentParams(spawnPreset);
      const thread = await bb.sdk.threads.spawn({
        projectId,
        environment: { type: "project-default" },
        visibility: "hidden",
        title: `Stelow: ${displayName}`,
        providerId: params.providerId,
        model: params.modelId,
        reasoningLevel: params.reasoningLevel as "low" | "medium" | "high" | "xhigh" | "max" | "none" | "ultra" | "ultracode",
        permissionMode: params.permissionMode as "accept-edits" | "auto" | "full",
        executionInputSources: { providerId: "explicit", model: "explicit", reasoningLevel: "explicit", permissionMode: "explicit" },
        prompt: `You are running a Stelow workflow inside the bb-plugin-stelow panel. The host pre-seeded your per-workflow state, transitions.md, and stelow.json. Your workflow owns its own state dir (${text(seed.stateDir ?? "<project>/.stelow/<date>/<dirHash>")}) — its state.md holds name, intent, current_stage, status.

The Stelow workflow skills (stelow-entry, stelow-router, stelow-product-*) are provided by this plugin — start by loading them (they live under the plugin's skills directory; \`bb skill list\` shows them). Use \`bb stelow advance <stage>\` to change stages (do NOT hand-edit current_stage). Preserve every gate (product, interface, tech plan, diff).

The user already classified this request as intent=\`${intent}\` (recorded in state.md). Use that intent — do NOT ask the user to pick an intent again.${intent === "unknown" ? " Since no intent was pre-selected, determine the most fitting one yourself during triage (new-product, feature, bugfix, refactor, or investigate) and record it in state.md — only ask the user if it is genuinely ambiguous." : ""}

CRITICAL — User input contract:
ANY time you need user input (ambiguity, approval, scope, interface choice, etc.), you MUST call the structured form, NEVER just write text like "waiting for your choice":

    bb stelow ask --thread <this_thread_id> \\
      --question "<a single clear question>" \\
      --option "<label 1>" --option "<label 2>" [--option "<label 3>" ...] [--multiple]

Before asking a question, first summarize what you read (files, plan, codebase) so the user can answer with context — never dump a raw file list as the only content of a question. Do not skip the triage stage; do not start shaping before triage is settled. Each bb stelow ask call blocks until the user submits; the card moves to the "Gate pending" column automatically. If an ask returns "No response after Ns" (timeout), STOP and wait: do NOT proceed with the workflow. The question stays pending on the card and remains answerable; when the user answers it on the card, the answer is delivered to you as a message and you continue from there. Never re-ask the same question — wait for the card answer. Stop when the user archives the card or the workflow reaches \`audit\`.

${params.instructions ? `Preset instructions:\n${params.instructions}\n` : ""}Request:
${prompt}`,
      });
      const ts = now();
      db.prepare("INSERT INTO cards (id, project_id, name, display_name, prompt, intent, status, stage, activity, worker_thread_id, worker_preset_id, dir_hash, last_error, last_assistant_text, last_seen_completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(cardId, projectId, slug, displayName, prompt, intent, "draft", "triage", "running", thread.id, spawnPreset.id, seed.dirHash, null, null, null, ts, ts);
      db.prepare("INSERT OR REPLACE INTO card_presets (card_id, preset_id, assigned_at) VALUES (?, ?, ?)").run(cardId, preset.id, ts);
      bb.realtime.publish("card-state", { cardId });
      return { cardId, threadId: thread.id };
    },

    async cardDetail({ cardId }) {
      const card = getCard(cardId);
      if (!card) throw new Error("Card not found");
      const comments = db.prepare("SELECT * FROM comments WHERE card_id = ? ORDER BY created_at ASC").all(cardId) as CommentRow[];
      const pending = await fetchPendingQuestions(card.worker_thread_id);
      const expiredRows = db.prepare("SELECT * FROM expired_questions WHERE card_id = ? AND answered = 0 ORDER BY expired_at DESC").all(cardId) as Array<{ id: string; question: string; multiple: number; options: string; expired_at: number }>;
      const expiredQuestions = expiredRows.map((row) => ({ id: row.id, question: row.question, multiple: Boolean(row.multiple), options: JSON.parse(row.options) as Array<{ label: string; description: string }>, expiredAt: row.expired_at }));
      let projectName = card.project_id;
      let sourcePath: string | null = null;
      try {
        const project = await bb.sdk.projects.get({ projectId: card.project_id });
        projectName = project.name;
        sourcePath = project.sources.find((entry) => entry.isDefault)?.path ?? null;
      } catch { /* project removed; keep card viewable */ }
      const mentionedFiles = await detectMentionedFiles(bb, sourcePath, card.prompt);
      const nextStages = parseNextStages(sourcePath, card.stage);
      const scopes = loadCardScopes(sourcePath, card.name);
      const preset = getPresetForCard(card.id);
      // Read the card's per-workflow state.md to surface produced artifacts
      // (spec, plan, scope reports, …) as clickable assets on the card.
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
        const list: Array<{ stage: string; path: string; display: string }> = [];
        for (const raw of (String(stateBlob.match(/^artifacts:\s*$/m) ? stateBlob.split(/^artifacts:\s*$/m)[1] ?? "" : "").split(/\n(?=^\S)/m)[0] ?? "").split(/\n/)) {
          const m = raw.match(/^\s{2}([\w-]+):\s*(\.?\S+)\s*$/);
          if (!m) continue;
          const relPath = m[2];
          // Keep repo-root-relative (no leading /) so safeRelative() in
          // readDocument resolves it under the project root.
          const full = relPath.startsWith("/") ? join(sourcePath, relPath.slice(1)) : join(sourcePath, relPath);
          const exists = await bb.sdk.files.read({ path: full }).then(() => true).catch(() => false);
          if (exists) list.push({ stage: m[1], path: relPath, display: basename(full) });
        }
        return list;
      })();
      // Surface pending stelow ask interactions regardless of the stored activity:
      // an ask parks the card awaiting an answer even when the thread is idle.
      const effectiveActivity = (card.activity === "error" ? "error" : pending.length > 0 ? "awaiting-answer" : card.activity as "idle" | "running" | "awaiting-answer" | "error");
      const termStatus = ["completed", "archived", "blocked"].includes(normalizeStatus(card.status));
      const idleStuck = effectiveActivity === "idle"
        && card.worker_thread_id !== null
        && !termStatus
        && (card.last_idle_at ?? 0) > 0
        && now() - (card.last_idle_at ?? 0) >= IDLE_ATTENTION_MS;
      const attentionKind = (idleStuck ? "idle"
        : (effectiveActivity === "awaiting-answer" && (card.last_seen_question_at ?? 0) < card.updated_at) ? "question"
        : ((Boolean(card.last_error) || effectiveActivity === "error") && (card.last_seen_error_at ?? 0) < card.updated_at) ? "error"
        : (normalizeStatus(card.status) === "completed" && (card.last_seen_completed_at ?? 0) < card.updated_at) ? "completed"
        : null) as "question" | "error" | "completed" | "idle" | null;
      const pendingFirst = pending[0] ?? null;
      return {
        card: { id: card.id, name: card.name, displayName: card.display_name ?? card.name, prompt: card.prompt, intent: card.intent, projectId: card.project_id, projectName, status: normalizeStatus(card.status), stage: card.stage, workerThreadId: card.worker_thread_id, activity: effectiveActivity, lastError: card.last_error, needsAttention: attentionKind !== null, attentionKind, presetName: preset.name, updatedAt: card.updated_at },
        mentionedFiles,
        scopes,
        comments: comments.map(({ id, target, target_id, author, body, created_at }) => ({ id, target: target as "card" | "scope" | "task", targetId: target_id, author: author as "user" | "agent", body, createdAt: created_at })),
        pendingQuestions: pending,
        expiredQuestions,
        artifacts,
        nextStages,
      };
    },

    async updateCardIntent({ cardId, intent }) {
      const card = getCard(cardId);
      if (!card) return { ok: false, error: "Card not found." };
      const ts = now();
      db.prepare("UPDATE cards SET intent = ?, updated_at = ? WHERE id = ?").run(intent, ts, cardId);
      // Keep state.md intent in sync so the agent sees the corrected intent.
      try {
        const project = await bb.sdk.projects.get({ projectId: card.project_id });
        const source = project.sources.find((entry) => entry.isDefault) ?? project.sources[0];
        if (source?.path) {
          const statePath = join(source.path, "state.md");
          const existing = await bb.sdk.files.read({ path: statePath }).catch(() => null);
          if (existing) {
            await bb.sdk.files.write({ path: statePath, content: existing.content.replace(/^intent:.*$/m, `intent: ${intent}`) });
          }
        }
      } catch { /* state.md sync is best-effort */ }
      bb.realtime.publish("card-state", { cardId });
      return { ok: true, error: null };
    },

    async addCardComment({ cardId, target, targetId, body }) {
      const card = getCard(cardId);
      if (!card) return { commentId: "", error: "Card not found." };
      const commentId = randomId("cmt");
      const ts = now();
      db.prepare("INSERT INTO comments (id, card_id, target, target_id, author, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(commentId, cardId, target, targetId, "user", body, ts);
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

    async reseedCard({ cardId, presetId }) {
      const card = getCard(cardId);
      if (!card) return { reseeded: false, error: "Card not found." };
      let source: Awaited<ReturnType<typeof bb.sdk.projects.get>>["sources"][number] | undefined;
      try {
        const project = await bb.sdk.projects.get({ projectId: card.project_id });
        source = project.sources.find((entry) => entry.isDefault) ?? project.sources[0];
      } catch {
        return { reseeded: false, error: "Project no longer exists. Archive this card to remove it." };
      }
      if (!source?.path) return { reseeded: false, error: "Project workspace path is unavailable." };
      // Re-seed into a fresh per-workflow dir so the card gets a clean state file.
      const seed = await seedWorkflow(bb, source.path, card.name, card.intent);
      if (seed.error) return { reseeded: false, error: seed.error };
      if (seed.dirHash) {
        db.prepare("UPDATE cards SET dir_hash = ?, updated_at = ? WHERE id = ?").run(seed.dirHash, now(), cardId);
      }
      let preset: PresetRow;
      if (presetId) {
        const found = getPresetById(presetId);
        if (!found) return { reseeded: false, error: "Preset not found." };
        preset = found;
        db.prepare("INSERT OR REPLACE INTO card_presets (card_id, preset_id, assigned_at) VALUES (?, ?, ?)").run(cardId, preset.id, now());
      } else {
        preset = getPresetForCard(cardId);
      }
      if (card.worker_thread_id) {
        try { await bb.sdk.threads.archive({ threadId: card.worker_thread_id }); } catch { /* ignore */ }
        try { await bb.sdk.threads.stop({ threadId: card.worker_thread_id }); } catch { /* ignore */ }
      }
      const params = presetAttachmentParams(preset);
      const newThread = await bb.sdk.threads.spawn({
        projectId: card.project_id,
        environment: { type: "project-default" },
        visibility: "hidden",
        title: `Stelow: ${card.display_name ?? card.name}`,
        providerId: params.providerId,
        model: params.modelId,
        reasoningLevel: params.reasoningLevel as "low" | "medium" | "high" | "xhigh" | "max" | "none" | "ultra" | "ultracode",
        permissionMode: params.permissionMode as "accept-edits" | "auto" | "full",
        executionInputSources: { providerId: "explicit", model: "explicit", reasoningLevel: "explicit", permissionMode: "explicit" },
        prompt: `You are running a Stelow workflow inside the bb-plugin-stelow panel. The host re-seeded your per-workflow state, transitions.md, and stelow.json. Your workflow owns its own state dir (${text(card.dir_hash ? ".stelow/<date>/" + card.dir_hash : "<project>/.stelow/<date>/<dirHash>")}) — its state.md holds name, intent, current_stage, status. The Stelow workflow skills (stelow-entry, stelow-router, stelow-product-*) are provided by this plugin — start by loading them (they live under the plugin's skills directory; \`bb skill list\` shows them). Use \`bb stelow advance <stage>\` to change stages (do NOT hand-edit current_stage). Preserve every gate (product, interface, tech plan, diff).

The user already classified this request as intent=\`${card.intent}\` (recorded in state.md). Use that intent — do NOT ask the user to pick an intent again.${card.intent === "unknown" ? " Since no intent was pre-selected, determine the most fitting one yourself during triage (new-product, feature, bugfix, refactor, or investigate) and record it in state.md — only ask the user if it is genuinely ambiguous." : ""}

CRITICAL — User input contract:
ANY time you need user input, you MUST call the structured form:

    bb stelow ask --thread <this_thread_id> \\
      --question "<a single clear question>" \\
      --option "<label 1>" --option "<label 2>" [--option "<label 3>" ...] [--multiple]

Before asking a question, first summarize what you read (files, plan, codebase) so the user can answer with context — never dump a raw file list as the only content of a question. Do not skip the triage stage. Each bb stelow ask call blocks until the user submits; the card moves to the "Gate pending" column automatically. If an ask returns "No response after Ns" (timeout), STOP and wait: do NOT proceed with the workflow. The question stays pending on the card and remains answerable; when the user answers it on the card, the answer is delivered to you as a message and you continue from there. Never re-ask the same question — wait for the card answer. Stop when the user archives the card or the workflow reaches \`audit\`.

${params.instructions ? `Preset instructions:\n${params.instructions}\n` : ""}Request:
${card.prompt}`,
      });
      const ts = now();
      db.prepare("UPDATE cards SET stage = ?, activity = ?, last_error = ?, worker_thread_id = ?, worker_preset_id = ?, last_assistant_text = ?, updated_at = ? WHERE id = ?").run("triage", "running", null, newThread.id, preset.id, null, ts, cardId);
      bb.realtime.publish("card-state", { cardId });
      return { reseeded: true, error: null };
    },

    async moveCard({ cardId, status }) {
      const card = getCard(cardId);
      if (!card) return { ok: false, error: "Card not found." };
      updateCard(cardId, { status });
      return { ok: true, error: null };
    },

    async markCardSeen({ cardId, kind }) {
      const card = getCard(cardId);
      if (!card) return { ok: false };
      const column = kind === "error" ? "last_seen_error_at" : kind === "question" ? "last_seen_question_at" : "last_seen_completed_at";
      db.prepare(`UPDATE cards SET ${column} = @ts WHERE id = @id`).run({ id: cardId, ts: now() });
      bb.realtime.publish("card-state", { cardId });
      return { ok: true };
    },

    async answerExpiredQuestion({ cardId, questionId, answer }) {
      const card = getCard(cardId);
      const question = card ? db.prepare("SELECT * FROM expired_questions WHERE id = ? AND card_id = ? AND answered = 0").get(questionId, cardId) as { thread_id: string; question: string; multiple: number; options: string } | undefined : undefined;
      if (!card || !question) return { ok: false, error: "Question not found or already answered." };
      const commentId = randomId("cmt");
      db.prepare("INSERT INTO comments (id, card_id, target, target_id, author, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(commentId, cardId, "card", cardId, "user", `Answer to an earlier question that timed out:\n\nQ: ${question.question}\nA: ${answer}`, now());
      db.prepare("UPDATE expired_questions SET answered = 1 WHERE id = ?").run(questionId);
      // The question is answered — leave Gate pending. The threads.send below
      // resumes the worker (thread.active → syncThreadState → running); if the
      // thread fails to resume, idle is honest and the comment still records it.
      updateCard(cardId, { activity: "running", status: "in-progress" });
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
      if (!card) return { ok: false, stdout: "", error: "Card not found." };
      let source: Awaited<ReturnType<typeof bb.sdk.projects.get>>["sources"][number] | undefined;
      try {
        const project = await bb.sdk.projects.get({ projectId: card.project_id });
        source = project.sources.find((entry) => entry.isDefault) ?? project.sources[0];
      } catch {
        return { ok: false, stdout: "", error: "Project no longer exists. Archive this card to remove it." };
      }
      if (!source?.path) return { ok: false, stdout: "", error: "Project workspace path is unavailable." };
      const guard = await ensureProjectArtifacts(bb, source.path, card.dir_hash);
      if (guard) return { ok: false, stdout: "", error: guard };
      const stateDir = card.dir_hash ? await workflowStateDir(bb, source.path, card.dir_hash) : null;
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
      const nextStatus = stage === "triage" ? "draft" : normalizeStatus(stage) === "completed" ? normalizeStatus("completed") : "in-progress";
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
      const rows = db.prepare("SELECT * FROM presets ORDER BY is_default DESC, name COLLATE NOCASE ASC").all() as PresetRow[];
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
      if (!row) return { deleted: false, error: "Preset not found." };
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
        if (!getPresetById(presetId)) return { ok: false, error: "Preset not found." };
        db.prepare("INSERT OR REPLACE INTO stage_presets (band, preset_id, assigned_at) VALUES (?, ?, ?)").run(band, presetId, now());
      } else {
        db.prepare("DELETE FROM stage_presets WHERE band = ?").run(band);
      }
      return { ok: true, error: null };
    },

    async assignPreset({ cardId, presetId }) {
      const card = getCard(cardId);
      if (!card) return { ok: false, error: "Card not found." };
      if (presetId === null) {
        db.prepare("DELETE FROM card_presets WHERE card_id = ?").run(cardId);
      } else {
        const preset = getPresetById(presetId);
        if (!preset) return { ok: false, error: "Preset not found." };
        db.prepare("INSERT OR REPLACE INTO card_presets (card_id, preset_id, assigned_at) VALUES (?, ?, ?)").run(cardId, presetId, now());
      }
      bb.realtime.publish("card-state", { cardId });
      return { ok: true, error: null };
    },

    async setDefaultPreset({ id }) {
      const preset = getPresetById(id);
      if (!preset) return { ok: false, error: "Preset not found." };
      db.prepare("UPDATE presets SET is_default = 0").run();
      db.prepare("UPDATE presets SET is_default = 1 WHERE id = ?").run(id);
      bb.realtime.publish("board-changed", { presetId: id });
      return { ok: true, error: null };
    },

    async listProviderModels() {
      const providers = await bb.sdk.providers.list().catch(() => []);
      const models: Array<{ providerId: string; model: string; displayName: string }> = [];
      for (const provider of providers) {
        const result = await bb.sdk.providers.models({ providerId: provider.id }).catch(() => null);
        for (const model of result?.models ?? []) {
          models.push({ providerId: provider.id, model: model.model, displayName: model.displayName });
        }
      }
      return { providers: providers.map((provider) => ({ id: provider.id, displayName: provider.displayName })), models };
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
        // Move the owning card to Gate pending while the question is open.
        const cardRow = db.prepare("SELECT id FROM cards WHERE worker_thread_id = ?").get(threadId) as { id: string } | undefined;
        if (cardRow) updateCard(cardRow.id, { activity: "awaiting-answer", status: "awaiting-answer" });
        let result: Awaited<ReturnType<typeof bb.ui.requestInput>>;
        const askedAt = Date.now();
        const options = labels.map((label) => ({ label, description: "" }));
        try {
          result = await bb.ui.requestInput({ threadId, rendererId: "stelow-question", title: "Stelow question", timeoutMs: Number(process.env.STELOW_ASK_TIMEOUT_MS ?? 60 * 60 * 1000), payload: { question, multiple: argv.includes("--multiple"), options } }, { signal: ctx.signal });
        } finally {
          if (cardRow) updateCard(cardRow.id, { activity: "running", status: "in-progress" });
        }
        if (result.outcome === "cancelled" && result.reason === "timeout") {
          // The user never answered within the window. Keep the card in
          // "Gate pending" (awaiting-answer) so it is obvious a decision is
          // still outstanding, and tell the agent to STOP and wait rather
          // than guessing. The answer, when it arrives via the card, is
          // delivered as a comment that resumes the thread.
          if (cardRow) {
            db.prepare("INSERT OR REPLACE INTO expired_questions (id, card_id, thread_id, question, multiple, options, expired_at, answered) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(randomId("qexp"), cardRow.id, threadId, question, argv.includes("--multiple") ? 1 : 0, JSON.stringify(options), askedAt + Number(process.env.STELOW_ASK_TIMEOUT_MS ?? 60 * 60 * 1000), 0);
            updateCard(cardRow.id, { activity: "awaiting-answer", status: "awaiting-answer" });
            bb.realtime.publish("card-state", { cardId: cardRow.id });
          }
          const elapsed = Math.round((Date.now() - askedAt) / 1e3);
          return { exitCode: 1, stdout: `No response after ${elapsed}s — the user is away. STOP and wait: do NOT proceed with the workflow. The question is still pending on the card (Gate pending) and remains answerable. When the user answers it on the card, the answer is delivered here as a message and you may continue. If you are re-asked about this same question later, do not re-ask the user again — wait for the card answer.` };
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
        const rootPath = await projectRoot(bb, projectId);
        if (!rootPath) return { exitCode: 1, stderr: "Project workspace path is unavailable." };
        // The agent runs this from within its worker thread; resolve the owning
        // card so advance targets that card's per-workflow state file.
        const cliCard = ctx.threadId ? db.prepare("SELECT id, dir_hash, worker_preset_id FROM cards WHERE worker_thread_id = ?").get(ctx.threadId) as { id: string; dir_hash: string | null; worker_preset_id: string | null } | undefined : undefined;
        const stateDir = cliCard?.dir_hash ? await workflowStateDir(bb, rootPath, cliCard.dir_hash) : null;
        const guard = await ensureProjectArtifacts(bb, rootPath);
        if (guard) return { exitCode: 1, stderr: guard };
        const result = await runHelper(["advance", stage], rootPath, stateDir ?? undefined);
        if (result.code !== 0) return { exitCode: 1, stderr: result.stderr || "advance failed", stdout: result.stdout };
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
        const rows = (db.prepare("SELECT * FROM presets ORDER BY is_default DESC, name COLLATE NOCASE ASC").all() as PresetRow[]);
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
    if (!row) return { deleted: false, error: "Preset not found." };
    if (row.built_in === 1) return { deleted: false, error: "Built-in presets cannot be deleted." };
    const inUse = db.prepare("SELECT COUNT(*) AS count FROM card_presets WHERE preset_id = ?").get(id) as { count: number };
    if (inUse.count > 0) return { deleted: false, error: `Preset is assigned to ${inUse.count} card(s). Unassign first.` };
    db.prepare("DELETE FROM presets WHERE id = ?").run(id);
    return { deleted: true, error: null };
  };

  const assignPresetHandler = async ({ cardId, presetId }: { cardId: string; presetId: string | null }) => {
    const card = getCard(cardId);
    if (!card) return { ok: false, error: "Card not found." };
    if (presetId === null) {
      db.prepare("DELETE FROM card_presets WHERE card_id = ?").run(cardId);
    } else {
      const preset = getPresetById(presetId);
      if (!preset) return { ok: false, error: "Preset not found." };
      db.prepare("INSERT OR REPLACE INTO card_presets (card_id, preset_id, assigned_at) VALUES (?, ?, ?)").run(cardId, presetId, now());
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
      return board.workflows.filter((workflow) => workflow.name.toLowerCase().includes(query.toLowerCase())).slice(0, 20).map((workflow) => ({ id: workflow.id, title: workflow.name, subtitle: `${workflow.stage} · ${workflow.status}` }));
    },
    async resolve(itemId) {
      const projects = await bb.sdk.projects.list({ includePersonal: true });
      for (const project of projects) {
        const board = await loadBoard(bb, project.id);
        const workflow = board.workflows.find((item) => item.id === itemId);
        if (workflow) return { context: `Stelow workflow ${workflow.name}: stage=${workflow.stage}, status=${workflow.status}, appetite=${workflow.appetite}, review_mode=${workflow.reviewMode}. Scopes: ${workflow.scopes.map((scope) => `${scope.id}:${scope.status}`).join(", ") || "none"}.` };
      }
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

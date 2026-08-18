import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join as nodeJoin, resolve } from "node:path";
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
const TRANSITIONS_REF = (() => {
  const candidates = [
    nodeJoin(pluginDir, "references", "transitions.md"),
    nodeJoin(pluginDir, "..", "references", "transitions.md"),
  ];
  for (const candidate of candidates) {
    try { if (readFileSync(candidate, "utf8").length > 0) return candidate; } catch { /* try next */ }
  }
  return candidates[0]!;
})();
const STATE_TEMPLATE = `---\nname: <workflow-name>\nintent: <new-product|feature|bugfix|refactor|investigate|unknown>\ncurrent_stage: triage\nstatus: active\nconfig:\n  appetite: Core\n  review_mode: Auto\n  product_type: software\nstages:\n  triage: pending\n  select: pending\n  setup: pending\n  context: pending\n  shape: pending\n  critique: pending\n  gate: pending\n  scope: pending\n  interface: pending\n  int-gate: pending\n  selection: pending\n  planning: pending\n  plan-gate: pending\n  execution: pending\n  verification: pending\n  diff-gate: pending\n  audit: pending\nartifacts: {}\nhistory: []\n---\n`;

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
  listCards: {
    input: z.object({ projectId: z.string().nullable() }).strict(),
    output: z.object({ cards: z.array(z.object({ id: z.string(), name: z.string(), displayName: z.string(), prompt: z.string(), intent: z.string(), projectId: z.string(), projectName: z.string(), status: statusSchema, stage: z.string(), workerThreadId: z.string().nullable(), activity: z.enum(["idle", "running", "awaiting-answer", "error"]), lastError: z.string().nullable(), actionRequired: z.boolean(), updatedAt: z.number() })) }),
  },
  createCard: {
    input: z.object({ projectId: z.string(), prompt: z.string().min(1).max(20_000), intent: z.enum(["new-product", "feature", "bugfix", "refactor", "investigate"]) }).strict(),
    output: z.object({ cardId: z.string(), threadId: z.string() }),
  },
  cardDetail: {
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({
      card: z.object({ id: z.string(), name: z.string(), displayName: z.string(), prompt: z.string(), intent: z.string(), projectId: z.string(), projectName: z.string(), status: statusSchema, stage: z.string(), workerThreadId: z.string().nullable(), activity: z.enum(["idle", "running", "awaiting-answer", "error"]), lastError: z.string().nullable(), updatedAt: z.number() }),
      scopes: z.array(z.object({ id: z.string(), name: z.string(), type: z.string().optional(), status: statusSchema, blockedBy: z.array(z.string()).optional(), dependsOn: z.array(z.string()).optional(), tasks: z.array(z.object({ id: z.string(), name: z.string(), status: statusSchema, source: z.string().optional(), note: z.string().optional() })) })),
      comments: z.array(z.object({ id: z.string(), target: z.enum(["card", "scope", "task"]), targetId: z.string(), author: z.enum(["user", "agent"]), body: z.string(), createdAt: z.number() })),
      pendingQuestions: z.array(z.object({ id: z.string(), title: z.string(), question: z.string(), multiple: z.boolean(), options: z.array(z.object({ label: z.string(), description: z.string() })), expiresAt: z.number().nullable() })),
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
    input: z.object({ cardId: z.string() }).strict(),
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

function join(root: string, relative: string): string {
  return `${root.replace(/\/$/, "")}/${relative.replace(/^\//, "")}`;
}

function safeRelative(path: string): string {
  if (!path || path.startsWith("/") || path.split("/").some((part) => part === "..")) {
    throw new Error("Path must stay inside the project workspace.");
  }
  return path;
}

async function seedWorkflow(bb: BbPluginApi, rootPath: string, name: string, intent: string): Promise<{ statePath: string | null; error: string | null }> {
  const statePath = join(rootPath, "state.md");
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

    let stateExists = false;
    try {
      const existing = await bb.sdk.files.read({ path: statePath });
      stateExists = existing.content.includes("current_stage:");
    } catch { /* missing */ }

    if (stateExists) {
      const match = (trackingData.workflows as Array<LooseRecord>).find((workflow) => workflow.name === name);
      dirHash = text(match?.dirHash) || `pw-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
    } else {
      dirHash = `pw-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
      const stateDir = join(rootPath, `.stelow/${date}/${dirHash}`);
      mkdirSync(stateDir, { recursive: true });
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
    return { statePath, error: null };
  } catch (error) {
    return { statePath: null, error: error instanceof Error ? error.message : "Unable to seed workflow." };
  }
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
        if (stage) stages.add(stage);
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

async function ensureProjectArtifacts(bb: BbPluginApi, rootPath: string): Promise<string | null> {
  const tracking = join(rootPath, "stelow.json");
  const transitions = join(rootPath, "skills/stelow-product-orchestrator/references/transitions.md");
  const state = join(rootPath, "state.md");
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

function runHelper(args: string[], cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveRun) => {
    const child = spawn("bash", [HELPER_SCRIPT, ...args], { cwd, env: { ...process.env, STELOW_STATE: nodeJoin(cwd, "state.md"), STELOW_TRANSITIONS: nodeJoin(cwd, "skills/stelow-product-orchestrator/references/transitions.md") }, stdio: ["ignore", "pipe", "pipe"] });
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

  let stateStage = "";
  try {
    const stateBlob = await bb.sdk.files.read({ path: join(rootPath, "state.md") });
    stateStage = text(stateBlob.content.match(/current_stage:\s*(\S+)/)?.[1]);
  } catch { /* state.md not yet written */ }

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
    workflows.push({
      id: text(raw.dirHash, text(raw.name, `workflow-${index + 1}`)),
      name: text(raw.name, `Workflow ${index + 1}`),
      description: text(raw.description),
      status: normalizeStatus(raw.status),
      stage: stateStage || text(stage.current_stage, phases.find((phase) => phase.status === "in-progress")?.name ?? "Not started"),
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
  ]);

  const cardColumns = db.prepare("PRAGMA table_info(cards)").all() as Array<{ name: string }>;
  if (!cardColumns.some((column) => column.name === "last_seen_completed_at")) {
    db.exec("ALTER TABLE cards ADD COLUMN last_seen_completed_at INTEGER");
  }
  if (!cardColumns.some((column) => column.name === "display_name")) {
    db.exec("ALTER TABLE cards ADD COLUMN display_name TEXT");
  }

  function now(): number { return Date.now(); }
  function randomId(prefix: string): string { return `${prefix}_${Math.random().toString(36).slice(2, 10)}`; }

  type CardRow = { id: string; project_id: string; name: string; display_name: string | null; prompt: string; intent: string; status: string; stage: string; activity: string; worker_thread_id: string | null; last_error: string | null; last_assistant_text: string | null; last_seen_completed_at: number | null; last_seen_error_at: number | null; last_seen_question_at: number | null; created_at: number; updated_at: number };
  type CommentRow = { id: string; card_id: string; target: string; target_id: string; author: string; body: string; created_at: number };

  function getCard(cardId: string): CardRow | undefined {
    return db.prepare("SELECT * FROM cards WHERE id = ?").get(cardId) as CardRow | undefined;
  }
  function updateCard(cardId: string, fields: Partial<Omit<CardRow, "id" | "project_id" | "intent" | "prompt" | "name" | "created_at">>): void {
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

  async function syncThreadState(cardId: string): Promise<void> {
    const card = getCard(cardId);
    if (!card?.worker_thread_id) return;
    try {
      const thread = await bb.sdk.threads.get({ threadId: card.worker_thread_id });
      const status = thread.status as string;
      const lastOutput = (await bb.sdk.threads.output({ threadId: card.worker_thread_id }).catch(() => null))?.output ?? null;
      if (status === "active") {
        const pending = await fetchPendingQuestions(card.worker_thread_id);
        updateCard(cardId, { activity: pending.length > 0 ? "awaiting-answer" : "running", last_assistant_text: lastOutput, status: "in-progress" });
      } else if (status === "idle") {
        updateCard(cardId, { activity: "idle", last_assistant_text: lastOutput });
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

    async startWorkflow({ projectId, prompt }) {
      const thread = await bb.sdk.threads.spawn({
        projectId,
        environment: { type: "project-default" },
        title: `Stelow: ${prompt.slice(0, 70)}`,
        prompt: `Use the stelow workflow to shape and execute this request. The helper \`scripts/stelow\` is provided by bb-plugin-stelow. Use \`bb stelow advance <stage>\` to change stages; do NOT hand-write stage transitions. Start with /sw-start, preserve every gate (product, interface, tech plan, diff).\n\nRequest:\n${prompt}`,
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
        let activity = row.activity as "idle" | "running" | "awaiting-answer" | "error";
        if (activity === "running" && row.worker_thread_id) {
          const pending = await fetchPendingQuestions(row.worker_thread_id);
          if (pending.length > 0) activity = "awaiting-answer";
        }
        const actionRequired = (activity === "awaiting-answer" && (row.last_seen_question_at ?? 0) < row.updated_at)
          || (Boolean(row.last_error) && (row.last_seen_error_at ?? 0) < row.updated_at)
          || (activity === "error" && (row.last_seen_error_at ?? 0) < row.updated_at)
          || (normalizeStatus(row.status) === "completed" && (row.last_seen_completed_at ?? 0) < row.updated_at);
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
          actionRequired,
          updatedAt: row.updated_at,
        };
      }));
      return { cards: enriched };
    },

    async createCard({ projectId, prompt, intent }) {
      const rootPath = await projectRoot(bb, projectId);
      if (!rootPath) throw new Error("Project workspace path is unavailable.");
      const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "stelow";
      const displayName = prompt.replace(/\s+/g, " ").trim().split(/\s+/).slice(0, 8).join(" ").slice(0, 60) || slug;
      const seed = await seedWorkflow(bb, rootPath, slug, intent);
      if (seed.error) throw new Error(seed.error);
      const cardId = randomId("card");
      const thread = await bb.sdk.threads.spawn({
        projectId,
        environment: { type: "project-default" },
        visibility: "hidden",
        title: `Stelow: ${displayName}`,
        prompt: `You are running a Stelow workflow inside the bb-plugin-stelow panel. The host pre-seeded state.md, transitions.md, and stelow.json. Use \`bb stelow advance <stage>\` to change stages (do NOT hand-edit current_stage). Start with /sw-start. Preserve every gate (product, interface, tech plan, diff). When you need user input, call bb.ui.requestInput via the stelow-question renderer id; if the host's primitive is unavailable, ask inline in chat so the worker thread surfaces the question. Stop when the user archives the card or the workflow reaches \`audit\`.\n\nRequest:\n${prompt}`,
      });
      const ts = now();
      db.prepare("INSERT INTO cards (id, project_id, name, display_name, prompt, intent, status, stage, activity, worker_thread_id, last_error, last_assistant_text, last_seen_completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(cardId, projectId, slug, displayName, prompt, intent, "in-progress", "triage", "running", thread.id, null, null, null, ts, ts);
      bb.realtime.publish("card-state", { cardId });
      return { cardId, threadId: thread.id };
    },

    async cardDetail({ cardId }) {
      const card = getCard(cardId);
      if (!card) throw new Error("Card not found");
      const comments = db.prepare("SELECT * FROM comments WHERE card_id = ? ORDER BY created_at ASC").all(cardId) as CommentRow[];
      const pending = await fetchPendingQuestions(card.worker_thread_id);
      let projectName = card.project_id;
      let sourcePath: string | null = null;
      try {
        const project = await bb.sdk.projects.get({ projectId: card.project_id });
        projectName = project.name;
        sourcePath = project.sources.find((entry) => entry.isDefault)?.path ?? null;
      } catch { /* project removed; keep card viewable */ }
      const nextStages = parseNextStages(sourcePath, card.stage);
      const scopes = loadCardScopes(sourcePath, card.name);
      return {
        card: { id: card.id, name: card.name, displayName: card.display_name ?? card.name, prompt: card.prompt, intent: card.intent, projectId: card.project_id, projectName, status: normalizeStatus(card.status), stage: card.stage, workerThreadId: card.worker_thread_id, activity: card.activity as "idle" | "running" | "awaiting-answer" | "error", lastError: card.last_error, updatedAt: card.updated_at },
        scopes,
        comments: comments.map(({ id, target, target_id, author, body, created_at }) => ({ id, target: target as "card" | "scope" | "task", targetId: target_id, author: author as "user" | "agent", body, createdAt: created_at })),
        pendingQuestions: pending,
        nextStages,
      };
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

    async reseedCard({ cardId }) {
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
      const statePath = join(source.path, "state.md");
      const trackingPath = join(source.path, "stelow.json");
      const transitionsPath = join(source.path, "skills/stelow-product-orchestrator/references/transitions.md");
      try { mkdirSync(dirname(transitionsPath), { recursive: true }); writeFileSync(transitionsPath, readFileSync(TRANSITIONS_REF, "utf8"), "utf8"); } catch { /* already there */ }
      try { mkdirSync(join(source.path, ".stelow/approvals"), { recursive: true }); } catch { /* already there */ }
      try {
        writeFileSync(statePath, STATE_TEMPLATE.replace("<workflow-name>", card.name).replace("<new-product|feature|bugfix|refactor|investigate|unknown>", card.intent), "utf8");
      } catch (error) {
        return { reseeded: false, error: error instanceof Error ? error.message : "Unable to write state.md." };
      }
      try {
        let trackingData: LooseRecord = {};
        try { trackingData = JSON.parse(readFileSync(trackingPath, "utf8")) as LooseRecord; } catch { trackingData = { workflows: [] }; }
        if (!Array.isArray(trackingData.workflows)) trackingData.workflows = [];
        const date = new Date().toISOString().slice(0, 10);
        const dirHash = `pw-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
        mkdirSync(join(source.path, `.stelow/${date}/${dirHash}`), { recursive: true });
        (trackingData.workflows as unknown[]).push({ name: card.name, description: "", status: "in-progress", cwd: source.path, dirHash, created: new Date().toISOString(), updated: new Date().toISOString(), stage: { current_stage: "triage", previous_stage: null, transitioned_at: new Date().toISOString(), history: [{ stage: "triage", entered_at: new Date().toISOString() }] }, phases: [], config: { appetite: "Core", review_mode: "Auto" } });
        writeFileSync(trackingPath, JSON.stringify(trackingData, null, 2), "utf8");
      } catch (error) {
        return { reseeded: false, error: error instanceof Error ? error.message : "Unable to write stelow.json." };
      }
      updateCard(cardId, { stage: "triage", activity: "idle", last_error: null });
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
      return { ok: true };
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
      const guard = await ensureProjectArtifacts(bb, source.path);
      if (guard) return { ok: false, stdout: "", error: guard };
      const result = await runHelper(["advance", stage], source.path);
      if (result.code !== 0) return { ok: false, stdout: result.stdout, error: result.stderr || "stelow advance failed" };
      updateCard(cardId, { stage });
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
  });

  bb.cli.register({
    name: "stelow",
    summary: "Inspect and interact with Stelow workflows",
    commands: [
      { name: "status", summary: "Show Stelow workflows", usage: "bb stelow status [--project <proj_id>] [--json]" },
      { name: "ask", summary: "Ask a blocking structured question", usage: "bb stelow ask --thread <thr_id> --question <text> [--multiple] --option <label>..." },
      { name: "seed", summary: "Seed state.md, transitions.md, stelow.json", usage: "bb stelow seed --project <proj_id> --name <name> --intent <new-product|feature|bugfix|refactor|investigate>" },
      { name: "advance", summary: "Advance to the next Stelow stage", usage: "bb stelow advance [--project <proj_id>] <stage>" },
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
        const result = await bb.ui.requestInput({ threadId, rendererId: "stelow-question", title: "Stelow question", payload: { question, multiple: argv.includes("--multiple"), options: labels.map((label) => ({ label, description: "" })) } }, { signal: ctx.signal });
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
        const guard = await ensureProjectArtifacts(bb, rootPath);
        if (guard) return { exitCode: 1, stderr: guard };
        const result = await runHelper(["advance", stage], rootPath);
        if (result.code !== 0) return { exitCode: 1, stderr: result.stderr || "advance failed", stdout: result.stdout };
        return { exitCode: 0, stdout: result.stdout };
      }
      return { exitCode: 2, stderr: "Usage: bb stelow status|ask|seed|advance" };
    },
  });

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
}

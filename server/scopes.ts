import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join as nodeJoin } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { scopeFingerprint } from "../lib/scope-fingerprint.mjs";
import { parseScopeArgs } from "../lib/scope-command.mjs";
import {
  sanitizeEvidenceRecord,
  type EvidenceCondition,
  type EvidenceContract,
  type EvidenceRecord,
} from "../lib/trackable-evidence.mjs";
import { isSpecTechFile, plansRelDir } from "../lib/tracking-paths.mjs";
import { mergePlannedTasks } from "../lib/spec-scope-reader.mjs";
import { workflowEntryForOwner, workflowStateRelativeDir } from "../lib/workflow-state-identity.mjs";
import { scopeDoneGate, scopeStartGate, type ScopeBatchDb } from "./scope-batch.js";

export type ScopeStatus =
  | "draft"
  | "planning"
  | "approved"
  | "in-progress"
  | "completed"
  | "archived"
  | "pending"
  | "done"
  | "skipped"
  | "blocked"
  | "escalated"
  | "failed";

type LooseRecord = Record<string, unknown>;

export interface ScopeTask {
  id: string;
  name: string;
  kind: "task";
  status: ScopeStatus;
  source?: string;
  note?: string;
  blockedBy?: string[];
  dependsOn?: string[];
  conditions: EvidenceCondition[];
}

export interface WorkflowScope {
  [key: string]: unknown;
  id: string;
  name: string;
  kind: "scope";
  type?: string;
  status: ScopeStatus;
  source?: string;
  gap?: string;
  blockedBy?: string[];
  dependsOn?: string[];
  record?: EvidenceRecord;
  startedAt?: string;
  targetFiles?: string[];
  contract?: EvidenceContract;
  conditions: EvidenceCondition[];
  claimed: boolean | null;
  tasks: ScopeTask[];
}

const STATUSES = new Set<ScopeStatus>([
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

function record(value: unknown): LooseRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as LooseRecord
    : {};
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((entry) => typeof entry === "string" ? entry : String(entry));
}

export function normalizeStatus(value: unknown): ScopeStatus {
  const candidate = text(value, "pending");
  return STATUSES.has(candidate as ScopeStatus) ? candidate as ScopeStatus : "pending";
}

function projectTask(
  value: unknown,
  index: number,
): Omit<ScopeTask, "conditions"> {
  const task = record(value);
  const blockedBy = strings(task.blockedBy) ?? strings(task.blocked_by);
  const dependsOn = strings(task.dependsOn) ?? strings(task.depends_on);
  return {
    id: text(task.id, `task-${index + 1}`),
    name: text(task.name, text(task.title, `Task ${index + 1}`)),
    kind: "task",
    status: normalizeStatus(task.status),
    ...(typeof task.source === "string" ? { source: task.source } : {}),
    ...(typeof task.note === "string" ? { note: task.note } : {}),
    ...(blockedBy ? { blockedBy } : {}),
    ...(dependsOn ? { dependsOn } : {}),
  };
}

export function workflowScopes(raw: LooseRecord): WorkflowScope[] {
  return array(raw.scopes).map((entry, index) => {
    const scope = record(entry);
    const evidence = sanitizeEvidenceRecord(scope.record);
    const blockedBy = strings(scope.blockedBy);
    const dependsOn = strings(scope.depends_on);
    const targetFiles = strings(scope.targetFiles)?.filter(Boolean);
    return {
      id: text(scope.id, `scope-${index + 1}`),
      name: text(scope.name, text(scope.title, `Scope ${index + 1}`)),
      kind: "scope",
      ...(typeof scope.type === "string" ? { type: scope.type } : {}),
      status: normalizeStatus(scope.status),
      ...(typeof scope.source === "string" ? { source: scope.source } : {}),
      ...(typeof scope.gap === "string" ? { gap: scope.gap } : {}),
      ...(blockedBy ? { blockedBy } : {}),
      ...(dependsOn ? { dependsOn } : {}),
      ...(evidence ? { record: evidence } : {}),
      ...(typeof scope.started_at === "string" && scope.started_at
        ? { startedAt: scope.started_at }
        : {}),
      ...(targetFiles ? { targetFiles } : {}),
      tasks: array(scope.tasks).map(projectTask),
    } as unknown as WorkflowScope;
  });
}

export function trackingEntryForCard(
  rootPath: string,
  workflowId: string,
): LooseRecord | null {
  try {
    const tracking = JSON.parse(
      readFileSync(nodeJoin(rootPath, "stelow.json"), "utf8"),
    ) as LooseRecord;
    return workflowEntryForOwner(array(tracking.workflows), workflowId) as LooseRecord | null;
  } catch {
    return null;
  }
}

export function latestSpecTech(
  rootPath: string,
  workflowId: string,
): { file: string; content: string } | null {
  try {
    const match = trackingEntryForCard(rootPath, workflowId);
    if (!match) return null;
    const plansRel = plansRelDir(workflowStateRelativeDir(match));
    if (!plansRel) return null;
    const plans = nodeJoin(rootPath, ...plansRel.split("/"));
    const files = readdirSync(plans).filter(isSpecTechFile).sort();
    const file = files.at(-1);
    return file ? { file, content: readFileSync(nodeJoin(plans, file), "utf8") } : null;
  } catch {
    return null;
  }
}

export function loadCardScopes(
  rootPath: string | null,
  workflowId: string,
  opts?: { mergePlanned?: boolean },
): WorkflowScope[] {
  if (!rootPath) return [];
  const tracking = nodeJoin(rootPath, "stelow.json");
  if (!existsSync(tracking)) return [];
  let trackingData: LooseRecord;
  try {
    trackingData = JSON.parse(readFileSync(tracking, "utf8")) as LooseRecord;
  } catch {
    return [];
  }
  const match = workflowEntryForOwner(
    array(trackingData.workflows),
    workflowId,
  ) as LooseRecord | null;
  if (!match) return [];
  const tracked = workflowScopes(match);
  if (opts?.mergePlanned === false) return tracked;
  const spec = latestSpecTech(rootPath, workflowId)?.content ?? null;
  return mergePlannedTasks(tracked, spec) as WorkflowScope[];
}

export interface CliResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

interface ScopeCliCard {
  id: string;
  dir_hash: string | null;
}

interface ScopeCommandContext {
  threadId?: string | null;
  projectId?: string | null;
}

interface ScopeCommandDeps<TCard extends ScopeCliCard> {
  bb: Pick<BbPluginApi, "realtime">;
  getCardByWorkerThread: (threadId: string) => TCard | undefined;
  cardWorkspace: (card: TCard) => Promise<{ path?: string } | null>;
  projectRoot: (projectId: string | null) => Promise<string | null>;
  workflowStateDir: (
    rootPath: string,
    card: TCard,
  ) => Promise<string | null>;
  ensureProjectArtifacts: (
    rootPath: string,
    stateDir: string | null,
    requireOwnedState: boolean,
  ) => Promise<string | null>;
  runHelper: (
    args: string[],
    rootPath: string,
    stateDir?: string,
  ) => Promise<{ code: number | null; stdout: string; stderr: string }>;
  recordTrackableEvent: (event: {
    cardId: string;
    kind: "scope";
    trackableId: string;
    transition: "started" | "tasks-seeded" | "completed";
    actor: "worker";
    evidence: string;
  }) => void;
  /**
   * Scope-batch coordination hooks. Absent in unit harnesses and legacy
   * callers: without a database the command passes through untouched.
   * When present and the card holds batch-namespaced claims, `start`
   * admits + claims before the helper runs and `done` proves + releases
   * after it succeeds.
   */
  db?: ScopeBatchDb;
}

const SCOPE_TRANSITIONS = {
  start: "started",
  "seed-tasks": "tasks-seeded",
  done: "completed",
} as const;

async function resolveScopeContext<TCard extends ScopeCliCard>(
  ctx: ScopeCommandContext,
  projectId: string | null,
  deps: ScopeCommandDeps<TCard>,
) {
  const card = ctx.threadId ? deps.getCardByWorkerThread(ctx.threadId) : undefined;
  const workspace = card ? await deps.cardWorkspace(card) : null;
  const rootPath = workspace?.path ?? await deps.projectRoot(
    projectId ?? ctx.projectId ?? null,
  );
  if (!rootPath) {
    return {
      card,
      rootPath: null,
      stateDir: null,
      guard: "Workspace path is unavailable.",
    };
  }
  const stateDir = card?.dir_hash ? await deps.workflowStateDir(rootPath, card) : null;
  const guard = await deps.ensureProjectArtifacts(
    rootPath,
    stateDir,
    Boolean(card?.dir_hash),
  );
  return { card, rootPath, stateDir, guard };
}

export async function runScopeCommand<TCard extends ScopeCliCard>(
  argv: string[],
  ctx: ScopeCommandContext,
  deps: ScopeCommandDeps<TCard>,
): Promise<CliResult> {
  const parsed = parseScopeArgs(argv.slice(1));
  if (parsed.error) return { exitCode: 2, stderr: parsed.error };
  const context = await resolveScopeContext(ctx, parsed.projectId ?? null, deps);
  if (!context.rootPath) {
    return {
      exitCode: 1,
      stderr: context.guard ?? "Workspace path is unavailable.",
    };
  }
  if (context.guard) return { exitCode: 1, stderr: context.guard };
  const { card, rootPath, stateDir } = context;
  // Scope-batch start gate (admission + spawn): dormant unless the card
  // holds batch-namespaced claims. A refused batch never reaches the
  // helper, so no partial dispatch can happen.
  if (card && parsed.op === "start" && deps.db) {
    try {
      const gate = scopeStartGate(deps.db, {
        cardId: card.id,
        scopeId: parsed.scopeId!,
        workspacePath: rootPath,
        scopes: loadCardScopes(rootPath, card.id),
      });
      if (!gate.ok) {
        const conflicts = "conflicts" in gate && gate.conflicts
          ? ` ${JSON.stringify(gate.conflicts).slice(0, 500)}`
          : "";
        return { exitCode: 1, stderr: `${gate.code}: ${gate.reason}${conflicts}` };
      }
    } catch {
      // Gate infrastructure failures fail open: a broken registry must
      // never park a worker behind a scope it could run.
    }
  }
  const result = await deps.runHelper(
    ["scope", ...parsed.passthrough!],
    rootPath,
    stateDir ?? undefined,
  );
  if (result.code !== 0) {
    return {
      exitCode: 1,
      stderr: result.stderr || "scope transition failed",
      stdout: result.stdout,
    };
  }
  // Scope-batch done gate (pre-write proof + cleanup): dormant unless the
  // card holds batch-namespaced claims. The completing scope must still
  // hold live claims on its target files, then releases exactly its own.
  if (card && parsed.op === "done" && deps.db) {
    try {
      const finishing = loadCardScopes(rootPath, card.id).find((scope) => scope.id === parsed.scopeId!);
      const gate = scopeDoneGate(deps.db, {
        cardId: card.id,
        scopeId: parsed.scopeId!,
        workspacePath: rootPath,
        targetFiles: finishing?.targetFiles ?? [],
      });
      if (!gate.ok) return { exitCode: 1, stdout: result.stdout, stderr: `${gate.code}: ${gate.reason}` };
    } catch {
      // Release failures never undo a committed helper transition.
    }
  }
  if (card) {
    try {
      deps.recordTrackableEvent({
        cardId: card.id,
        kind: "scope",
        trackableId: parsed.scopeId!,
        transition: SCOPE_TRANSITIONS[
          parsed.op as keyof typeof SCOPE_TRANSITIONS
        ] ?? "completed",
        actor: "worker",
        evidence: result.stdout.slice(0, 200),
      });
    } catch {
      // The trail is durable evidence, but it must not undo a committed transition.
    }
    deps.bb.realtime.publish("card-state", { cardId: card.id });
    deps.bb.realtime.publish("board-changed", { cardId: card.id });
  }
  return { exitCode: 0, stdout: result.stdout };
}

interface ScopeProgressCard {
  id: string;
}

interface ScopeProgressDeps<TCard extends ScopeProgressCard> {
  getCard: (cardId: string) => TCard | undefined;
  cardWorkspace: (card: TCard) => Promise<{ path?: string } | null>;
  publish: (cardId: string) => void;
}

export function createScopeProgressSync<TCard extends ScopeProgressCard>(
  deps: ScopeProgressDeps<TCard>,
) {
  const prints = new Map<string, string>();
  async function sync(cardId: string): Promise<void> {
    try {
      const card = deps.getCard(cardId);
      if (!card) {
        prints.delete(cardId);
        return;
      }
      const workspace = await deps.cardWorkspace(card);
      const print = workspace?.path
        ? scopeFingerprint(loadCardScopes(workspace.path, card.id))
        : "";
      const previous = prints.get(cardId);
      prints.set(cardId, print);
      if (previous !== undefined && previous !== print) deps.publish(cardId);
    } catch {
      // Advisory watch: the next reconcile tick retries.
    }
  }
  function prune(liveIds: ReadonlySet<string>): void {
    for (const id of prints.keys()) if (!liveIds.has(id)) prints.delete(id);
  }
  return { sync, prune };
}

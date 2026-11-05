import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { reconcileScopeHistory } from "../../lib/scope-history-reconcile.mjs";
import { mergePlannedTasks } from "../../lib/spec-scope-reader.mjs";
import { isSpecTechFile } from "../../lib/tracking-paths.mjs";
import { resolveWithinRoot } from "../../lib/path-jail.mjs";
import { stateWorkflowId, workflowEntryForOwner, workflowStateRelativeDir } from "../../lib/workflow-state-identity.mjs";
import type { HelperResult } from "./helper-script.js";
import { releaseScopeSyncReservations } from "./scope-sync-reservations.js";

export type ScopeSyncFiles = Pick<BbPluginApi["sdk"]["files"], "write">;
type Invoke = (args: string[], cwd: string, stateDir?: string) => Promise<HelperResult>;
type Workflow = Record<string, unknown> & {
  name: string; scopes?: Array<{ id?: unknown; tasks?: unknown }>;
  specTechFile?: string; specTechSha256?: string;
};
type Snapshot = {
  root: { workflows: Workflow[] }; workflow: Workflow; content: string;
  stateDir: string; stateContent: string; specFile: string | null; specContent: string | null;
};
type Moves = Array<{ fromScope: string; taskId: string; toScope: string }>;
const digest = (content: string) => createHash("sha256").update(content).digest("hex");
const failure = (stderr: string): HelperResult => ({ code: 1, stdout: "", stderr });

export const SCOPE_SYNC_HOST_SCHEMA = {
  usage: "bb stelow sync-scopes [--name <workflow>] [--preserve-history] [--move-task source:task:target] [--dry-run] [--json]",
  flags: ["--name", "--json", "--preserve-history", "--move-task", "--dry-run"],
  env: ["STELOW_STATEDIR"],
  exit_codes: { "0": "synced, unchanged or read-only preview", "1": "unsafe migration, conflict or lock refusal", "2": "usage" },
  output: "JSON sync/preview summary; historical version changes require explicit preservation and task moves",
};

function snapshot(cwd: string, stateDir: string | undefined, args: string[]): Snapshot | null {
  const path = resolveWithinRoot(cwd, "stelow.json");
  if (!path) throw new Error("Tracking must remain inside the selected project root");
  if (!existsSync(path)) return null;
  const content = readFileSync(path, "utf8");
  const root = JSON.parse(content) as Snapshot["root"];
  if (!Array.isArray(root.workflows)) throw new Error("Tracking has no workflows array; recover valid tracking before syncing");
  const nameAt = args.indexOf("--name");
  const suppliedState = stateDir ? resolveWithinRoot(cwd, join(stateDir, "state.md")) : null;
  if (stateDir && !suppliedState) throw new Error("Supplied state must remain inside the selected project root");
  const suppliedContent = suppliedState ? readFileSync(suppliedState, "utf8") : null;
  const owner = suppliedContent ? stateWorkflowId(suppliedContent) : null;
  const candidates = root.workflows.filter((workflow) => nameAt >= 0
    ? workflow.name === args[nameAt + 1] : workflow.status === "in-progress");
  const workflow = owner
    ? workflowEntryForOwner(root.workflows, owner, basename(stateDir!)) as Workflow | null
    : candidates.length === 1 ? candidates[0] : null;
  if (!workflow || (nameAt >= 0 && workflow.name !== args[nameAt + 1])) {
    throw new Error("Choose exactly one owned workflow with --name or run from its worker thread");
  }
  const rel = workflowStateRelativeDir(workflow);
  if (!rel) throw new Error("Workflow has no canonical state directory; recover its owned state before syncing");
  const owned = resolveWithinRoot(cwd, rel);
  if (!owned) throw new Error("Workflow state directory must remain inside the selected project root");
  if (stateDir && resolve(stateDir) !== owned) throw new Error("Workflow state ownership does not match the selected workflow");
  const stateFile = resolveWithinRoot(cwd, join(rel, "state.md"));
  if (!stateFile) throw new Error("Owned state must remain inside the selected project root");
  const stateContent = suppliedState === stateFile ? suppliedContent! : readFileSync(stateFile, "utf8");
  const plans = resolveWithinRoot(cwd, join(rel, "plans"));
  if (!plans) throw new Error("Workflow plan directory must remain inside the selected project root");
  const specFile = existsSync(plans) ? readdirSync(plans).filter(isSpecTechFile).sort().at(-1) ?? null : null;
  const specPath = specFile ? resolveWithinRoot(cwd, join(rel, "plans", specFile)) : null;
  if (specFile && !specPath) throw new Error("The target spec must remain inside the selected project root");
  return { root, workflow, content, stateDir: owned, stateContent, specFile,
    specContent: specPath ? readFileSync(specPath, "utf8") : null };
}

function taskMoves(args: string[]): Moves {
  const moves: Moves = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] !== "--move-task") continue;
    const parts = args[++index]?.split(":");
    if (!parts || parts.length !== 3 || parts.some((part) => !part.trim())) {
      throw new Error("Use --move-task source-scope:task-id:target-scope");
    }
    moves.push({ fromScope: parts[0], taskId: parts[1], toScope: parts[2] });
  }
  return moves;
}

async function parsedWorkflow(current: Snapshot, invoke: Invoke): Promise<Workflow> {
  const temporary = mkdtempSync(join(tmpdir(), "stelow-scope-preview-"));
  try {
    const rel = workflowStateRelativeDir(current.workflow)!;
    const stateDir = join(temporary, rel);
    mkdirSync(join(stateDir, "plans"), { recursive: true });
    writeFileSync(join(stateDir, "state.md"), current.stateContent);
    writeFileSync(join(stateDir, "plans", current.specFile!), current.specContent!);
    writeFileSync(join(temporary, "stelow.json"), JSON.stringify({ workflows: [current.workflow] }));
    const result = await invoke(["sync-scopes", "--name", current.workflow.name, "--json"], temporary, stateDir);
    if (result.code !== 0) throw new Error(result.stderr || "Canonical scope parser failed in its isolated preview");
    const generated = JSON.parse(readFileSync(join(temporary, "stelow.json"), "utf8")).workflows[0] as Workflow;
    if (generated.specTechFile !== current.specFile || !generated.scopes?.length) {
      throw new Error("The target spec did not parse; fix its [SCOPE-N] blocks before reconciliation");
    }
    generated.scopes = mergePlannedTasks(generated.scopes, current.specContent!) as Workflow["scopes"];
    return generated;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

async function commit(
  current: Snapshot, workflow: Record<string, unknown>, cwd: string, files: ScopeSyncFiles,
): Promise<{ backup: string; targetChanged: boolean }> {
  const source = join(current.stateDir, "plans", current.specFile!);
  const unchanged = () => {
    try { return digest(readFileSync(source, "utf8")) === digest(current.specContent!); }
    catch { return false; }
  };
  if (!unchanged()) throw new Error("The target spec changed during preview; re-read it and retry");
  const backup = join(cwd, ".stelow-history", `${Date.now()}-${randomUUID()}.json`);
  const saved = await files.write({ path: backup, rootPath: cwd, content: current.content,
    createParents: true, mode: 0o600, expectedSha256: null });
  if (saved.outcome !== "written") throw new Error("Tracking backup could not be published; no migration applied");
  const root = { ...current.root, workflows: current.root.workflows.map((entry) => entry === current.workflow ? workflow : entry) };
  if (!unchanged()) throw new Error("The target spec changed before commit; no migration applied");
  const written = await files.write({ path: join(cwd, "stelow.json"), rootPath: cwd,
    content: `${JSON.stringify(root, null, 2)}\n`, expectedSha256: digest(current.content) });
  if (written.outcome !== "written") throw new Error("Tracking changed concurrently; no migration applied. Re-read and retry");
  return { backup, targetChanged: !unchanged() };
}

async function apply(
  current: Snapshot, workflow: Record<string, unknown>, cwd: string, files: ScopeSyncFiles, invoke: Invoke,
): Promise<string> {
  const scope = `host-reconcile-${randomUUID()}`;
  const state = join(cwd, ".stelow");
  const protectedFiles = [join(cwd, "stelow.json"), join(current.stateDir, "plans", current.specFile!)];
  const flags = protectedFiles.flatMap((path) => ["--file", path]);
  let committed: { backup: string; targetChanged: boolean } | undefined;
  let commitError: unknown;
  try {
    const lock = await invoke(["lock", "acquire", "--scope", scope, "--ttl", "3600", ...flags, "--json"], cwd, state);
    if (lock.code !== 0) throw new Error(lock.stderr || "Tracking is reserved by another writer; retry at a safe checkpoint");
    committed = await commit(current, workflow, cwd, files);
  } catch (error) {
    commitError = error;
  }
  const release = await releaseScopeSyncReservations(invoke, cwd, state, scope, protectedFiles);
  if (release.code !== 0) {
    const status = committed ? "Migration committed, but" : "No migration committed;";
    const message = `${status} owned lock release failed. Inspect the lock owner before recovery`;
    throw new AggregateError(commitError ? [commitError] : [], message);
  }
  if (commitError) throw commitError;
  if (committed!.targetChanged) {
    throw new Error("Migration committed, but the target spec changed at the commit boundary. Re-read tracking and publish a new plan version.");
  }
  return committed!.backup;
}

async function sync(args: string[], cwd: string, stateDir: string | undefined, invoke: Invoke, files?: ScopeSyncFiles) {
  const preserve = args.includes("--preserve-history");
  const dryRun = args.includes("--dry-run");
  if (args.includes("--move-task") && !preserve) throw new Error("--move-task requires --preserve-history");
  const current = snapshot(cwd, stateDir, args);
  if (!current?.specFile) {
    if (preserve) throw new Error("History reconciliation needs readable owned tracking and a target spec-tech file");
    return dryRun ? { code: 0, stdout: JSON.stringify({ dryRun: true, synced: 0 }), stderr: "" } : invoke(args, cwd, stateDir);
  }
  const same = current.workflow.specTechFile === current.specFile;
  const recordedHash = current.workflow.specTechSha256;
  if (same && recordedHash && recordedHash !== digest(current.specContent!)) {
    throw new Error("The active spec changed in place; publish a new versioned spec-tech file");
  }
  const historical = Boolean(current.workflow.scopes?.length);
  if (!same && historical && !preserve) {
    throw new Error("A newer plan would replace scope history. "
      + "Run bb stelow sync-scopes --preserve-history --dry-run with explicit --move-task entries, then apply without --dry-run");
  }
  if (same) return { code: 0, stdout: JSON.stringify({ dryRun, synced: current.workflow.scopes?.length ?? 0, unchanged: true }), stderr: "" };
  if (!preserve && !dryRun) return invoke(args, cwd, stateDir);
  const generated = await parsedWorkflow(current, invoke);
  const result = reconcileScopeHistory(current.workflow, generated, {
    at: new Date().toISOString(), specSha256: digest(current.specContent!), taskMoves: taskMoves(args),
  });
  if (!result.ok) throw new Error(result.error);
  if (dryRun) return { code: 0, stdout: JSON.stringify({ dryRun: true, synced: 0,
    wouldSync: generated.scopes!.length, specTechFile: current.specFile, summary: result.summary }), stderr: "" };
  if (!files) throw new Error("The supported host file writer is unavailable; no migration applied");
  const backup = await apply(current, result.workflow, cwd, files, invoke);
  return { code: 0, stdout: JSON.stringify({ synced: generated.scopes!.length,
    specTechFile: current.specFile, preservedHistory: true, backup, summary: result.summary }), stderr: "" };
}

/** Canonical parsing stays in the vendored helper; only the explicit host migration preserves execution facts. */
export async function runScopeHistorySync(
  args: string[], cwd: string, stateDir: string | undefined, invoke: Invoke, files?: ScopeSyncFiles,
): Promise<HelperResult> {
  try {
    return await sync(args, cwd, stateDir, invoke, files);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Scope reconciliation failed without a valid result");
  }
}

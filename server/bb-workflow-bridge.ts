import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BB_NATIVE_CAPABILITIES, missingNativeCapabilities } from "../lib/bb-workflow-capabilities.mjs";

const execFileAsync = promisify(execFile);
const bbBin = process.env.BB_CLI || "bb";

export { BB_NATIVE_CAPABILITIES, missingNativeCapabilities };

export interface NativeWorkflowRun {
  runId: string;
  workspaceId: string;
  projectId: string;
  threadId: string;
  status?: string;
  previewDirective?: string | null;
}

export interface NativeWorkflowRef {
  runId: string;
  workspaceId: string;
  projectId: string;
  threadId: string;
}

function workflowEnv(projectId: string, threadId: string): NodeJS.ProcessEnv {
  return { ...process.env, BB_PROJECT_ID: projectId, BB_THREAD_ID: threadId };
}

export async function nativeWorkflowAvailable(ref?: { projectId: string; threadId: string; workspaceId: string }): Promise<boolean> {
  try {
    if (!ref) {
      await execFileAsync(bbBin, ["workflows", "--help"], { timeout: 10_000 });
      return true;
    }
    const { stdout: threadJson } = await execFileAsync(
      bbBin,
      ["thread", "show", ref.threadId, "--json"],
      { cwd: ref.workspaceId, env: workflowEnv(ref.projectId, ref.threadId), timeout: 10_000 },
    );
    const thread = JSON.parse(threadJson).thread as { status?: string; environmentId?: string | null };
    if (!thread.environmentId || !["active", "idle"].includes(thread.status ?? "")) return false;
    const source = 'export const meta = { name: "stelow-capability-probe", description: "Stelow capability probe", phases: [{ title: "Probe" }] }; return { state: "succeeded" };';
    await execFileAsync(bbBin, ["workflows", "validate", "--script", source, "--json"], { cwd: ref.workspaceId, env: workflowEnv(ref.projectId, ref.threadId), timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

export function nativeStatusOf(value: unknown): string {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const status = record.status ?? record.state ?? record.runStatus ?? record.run_status;
    if (status != null) return String(status);
  }
  return String(value ?? "unknown");
}

export function nativeNeedsInput(value: unknown): { question: string; questionId: string | null; [key: string]: unknown } | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const result = record.result;
  const input = record.needsInput ?? record.needs_input ?? record.input ?? result ?? record;
  const question = typeof input === "object" && input ? (input as Record<string, unknown>).question ?? (input as Record<string, unknown>).prompt : input;
  if (typeof question !== "string" || !question.trim()) return null;
  const fields = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const id = fields.questionId ?? fields.id ?? null;
  const boundaryKeys = ["contractId", "boundaryId", "kind", "shapeVersion", "scopeMapVersion", "answerSchema"];
  const boundary = Object.fromEntries(boundaryKeys.filter((key) => key in fields).map((key) => [key, fields[key]]));
  return { question: question.trim(), questionId: id == null ? null : String(id), ...boundary };
}

export function normalizeNativeWorkflowStatus(status: string): "queued" | "running" | "needs_input" | "succeeded" | "failed" | "cancelled" {
  if (status === "needs_input") return "needs_input";
  if (status === "running" || status === "started") return "running";
  if (status === "queued" || status === "pending") return "queued";
  if (status === "succeeded" || status === "completed" || status === "done") return "succeeded";
  if (status === "cancelled" || status === "canceled" || status === "stopped") return "cancelled";
  return "failed";
}

export async function runNativeWorkflow({ workspaceId, projectId, threadId, source, args, resumeRunId }: { workspaceId: string; projectId: string; threadId: string; source: string; args: Record<string, unknown>; resumeRunId?: string | null }): Promise<NativeWorkflowRun> {
  const command = ["workflows", "run", "--script", source, "--args", JSON.stringify(args), "--json"];
  if (resumeRunId) command.push("--resume", resumeRunId);
  const { stdout } = await execFileAsync(bbBin, command, { cwd: workspaceId, env: workflowEnv(projectId, threadId), timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
  const result = JSON.parse(stdout);
  const run = result?.run ?? result?.data ?? result;
  if (!run?.runId) throw new Error("BB Workflows did not return a run id");
  return { runId: String(run.runId), status: run.status == null ? undefined : String(run.status), previewDirective: run.previewDirective ?? run.preview_directive ?? null, workspaceId, projectId, threadId };
}

/** Server-side lifecycle bridge for a run started through the CLI. */
export async function stopNativeWorkflow({ runId, workspaceId, projectId, threadId }: NativeWorkflowRef): Promise<void> {
  await execFileAsync(bbBin, ["workflows", "stop", runId, "--json"], { cwd: workspaceId, env: workflowEnv(projectId, threadId), timeout: 30_000 });
}

export async function nativeWorkflowStatus({ runId, workspaceId, projectId, threadId }: NativeWorkflowRef): Promise<unknown> {
  const { stdout } = await execFileAsync(bbBin, ["workflows", "status", runId, "--json"], { cwd: workspaceId, env: workflowEnv(projectId, threadId), timeout: 30_000 });
  try {
    const result = JSON.parse(stdout);
    return scriptOutcome(result?.run ?? result?.data ?? result);
  } catch {
    const status = stdout.match(/\b(queued|running|needs[_ -]?input|succeeded|completed|failed|cancelled|canceled|stopped)\b/i)?.[1];
    if (status) return { status };
    throw new Error("BB Workflows status returned no recognized state");
  }
}

/**
 * Fold the inline script's own return value into the run status.
 *
 * Context: the inline recipe script returns `{ state, error, outputs }`, and
 * until now the host only ever read the WORKFLOW's status. A script that
 * produced nothing still finished, so BB reported "succeeded" and the run was
 * recorded as a plain artifact miss — the real cause never reached the card.
 * The workflow succeeding only means the script ran to completion; whether
 * the recipe did its work is the script's answer, so that answer is read.
 *
 * A missing or unrecognized result leaves the status untouched: a host that
 * cannot read an outcome must not invent a failure.
 */
export function scriptOutcome(run: unknown): unknown {
  if (run === null || typeof run !== "object" || Array.isArray(run)) return run;
  const record = run as Record<string, unknown>;
  const result = record.result;
  if (result === null || typeof result !== "object" || Array.isArray(result)) return run;
  const script = result as Record<string, unknown>;
  const state = typeof script.state === "string" ? script.state : "";
  if (state === "failed" || state === "error") {
    const error = typeof script.error === "string" && script.error
      ? script.error
      : "the recipe script reported a failure";
    return { ...record, status: "failed", scriptState: state, scriptError: error };
  }
  // A recipe that finished with no task outputs did nothing. That is a silent
  // no-op, and leaving it as "succeeded" is what turned a real failure into
  // a missing-file mystery three layers down.
  if (state === "succeeded" && isEmptyOutputs(script.outputs)) {
    return { ...record, status: "failed", scriptState: state, scriptError: "the recipe produced no task outputs" };
  }
  return run;
}

function isEmptyOutputs(outputs: unknown): boolean {
  return outputs !== null && typeof outputs === "object" && !Array.isArray(outputs) && Object.keys(outputs).length === 0;
}

function stripWorkflowSchemaMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripWorkflowSchemaMetadata);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== "$schema")
    .map(([key, child]) => [key, stripWorkflowSchemaMetadata(child)]));
}

function workflowAgentSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return stripWorkflowSchemaMetadata(schema) as Record<string, unknown>;
}

/** One catalog task as the recipe catalog declares it. */
type CatalogTask = {
  id: string;
  skill?: string;
  output?: string;
  depends_on?: string[];
  when?: string;
  requirements?: string[];
  failure_policy?: string;
  human_boundary?: string;
  output_schema_contract?: Record<string, unknown>;
};

/**
 * One catalog task as the workflow's own task shape. The catalog is snake_case
 * and nullable-by-omission; the generated script is camelCase and explicit, so
 * the translation happens once here instead of inside the template.
 */
function toWorkflowTask(task: CatalogTask) {
  return {
    id: task.id,
    skill: task.skill ?? null,
    output: task.output ?? null,
    dependsOn: task.depends_on ?? [],
    when: task.when ?? "always",
    requirements: task.requirements ?? [],
    failurePolicy: task.failure_policy ?? "fail",
    humanBoundary: task.human_boundary ?? "none",
    outputSchema: workflowAgentSchema(
      task.output_schema_contract ?? { type: "object", additionalProperties: true },
    ),
  };
}

/** Source is inline because plugin-bundled script paths are not origin-workspace paths. */
export function renderInlineWorkflowScript(
  recipe: { id: string; tasks?: CatalogTask[] },
  context: Record<string, unknown>,
): string {
  const tasks = (recipe.tasks ?? []).map(toWorkflowTask);
  const source = `export const meta = { name: ${JSON.stringify(`stelow-${recipe.id}`)}, description: ${JSON.stringify(`Stelow recipe ${recipe.id}`)}, phases: [{ title: "Execute" }] }
const recipeTasks = ${JSON.stringify(tasks)};
const input = { ...args, tasks: recipeTasks };
if (!input || !input.localRunId) return { state: "failed", error: "missing execution identity" };
const outputs = {};
const completed = new Set();
const skipped = new Set();
const DEFAULT_QUESTION = "The workflow needs a human decision.";
const BOUNDARY_FIELDS = ["questionId", "contractId", "boundaryId", "kind", "shapeVersion", "scopeMapVersion", "answerSchema"];
const boundaryContract = (n) => ({ question: n.question ?? n.prompt ?? DEFAULT_QUESTION,
  ...Object.fromEntries(BOUNDARY_FIELDS.map((f) => [f, n[f] ?? null])) });
const condition = (task) => {
  if (task.when === "always") return true;
  if (task.when === "appetite_supports_fanout") return ["Core", "Complete"].includes(input.context?.appetite);
  if (task.when === "partition_is_safe") return input.context?.partitionSafe === true;
  if (task.when === "findings_exist") return Object.values(outputs).some((value) => Array.isArray(value?.findings) && value.findings.length > 0);
  if (task.when === "ui_scope_present") return input.context?.uiScopePresent === true;
  throw new Error("Unknown recipe condition: " + task.when);
};
const executeTask = async (task) => {
  if (!condition(task)) { skipped.add(task.id); outputs[task.id] = { skipped: true, reason: "condition-false" }; return; }
  if (task.dependsOn.some((id) => skipped.has(id))) { skipped.add(task.id); outputs[task.id] = { skipped: true, reason: "dependency-skipped" }; return; }
  const dependencies = Object.fromEntries(task.dependsOn.map((id) => [id, outputs[id]]));
  const result = await agent("Execute this Stelow task in the origin workspace. Read the named skill and inputs, write the required task output at input.context.artifactRoot + '/' + task.output, and return structured evidence. Do not edit state.md, gates, or completion state. Task: " + JSON.stringify({ recipe: input.recipeId, task, dependencies, context: input.context }), { phase: "Execute", schema: task.outputSchema });
  if (result && (result.state === "failed" || result.state === "error")) {
    if (task.failurePolicy === "skip-with-reason") { skipped.add(task.id); outputs[task.id] = { skipped: true, reason: result.error ?? "task-failed" }; return; }
    throw new Error("Task failed: " + task.id);
  }
  if (result && (result.state === "needs_input" || result.needs_input)) {
    if (task.humanBoundary !== "coordinator") throw new Error("Task requested input without a human boundary: " + task.id);
    return { needsInput: result };
  }
  outputs[task.id] = result;
};
while (completed.size + skipped.size < input.tasks.length) {
  const ready = input.tasks.filter((task) => !completed.has(task.id) && !skipped.has(task.id) && task.dependsOn.every((id) => completed.has(id) || skipped.has(id)));
  if (ready.length === 0) throw new Error("Recipe dependency cycle or unresolved task");
  const results = await parallel(ready.map((task) => () => executeTask(task)));
  for (let index = 0; index < ready.length; index += 1) {
    const result = results[index];
    if (result?.needsInput) return { state: "needs_input", recipe: input.recipeId, ...boundaryContract(result.needsInput) };
    completed.add(ready[index].id);
  }
}
return { state: "succeeded", recipe: input.recipeId, outputs };
`;
  if (Buffer.byteLength(source, "utf8") > 512 * 1024) throw new Error("BB Workflows source exceeds 512 KiB");
  return source;
}

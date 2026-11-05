import { canonicalTaskId } from "./spec-scope-reader.mjs";

const PLANNING_FIELDS = [
  "id", "name", "type", "blockedBy", "dependsOn", "targetFiles", "maxIterations",
  "contract", "conditions", "acceptanceHash",
];
const TERMINAL = new Set(["done", "completed", "skipped"]);
const clone = (value) => structuredClone(value);
const validId = (id) => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id);
const taskKey = (task) => validId(task?.id) ? canonicalTaskId(task.id) : "";
const taskName = (task) => String(task?.name ?? "").trim().replace(/\s+/g, " ");

function uniqueEntries(values, key, label) {
  if (!Array.isArray(values)) throw new Error(`${label} must be an array`);
  const entries = new Map();
  for (const value of values) {
    const id = key(value);
    if (!validId(id) || entries.has(id)) {
      throw new Error(`${label} contains a missing or duplicate id`);
    }
    entries.set(id, value);
  }
  return entries;
}

function definition(scope) {
  return JSON.stringify(PLANNING_FIELDS.map((key) => [key, scope[key] ?? null]));
}

function validateTasks(scopes, label) {
  const claimed = new Set();
  for (const scope of scopes.values()) {
    const tasks = uniqueEntries(scope.tasks ?? [], taskKey, label);
    for (const id of tasks.keys()) {
      if (claimed.has(id)) throw new Error(`${label} contains a task id shared across scopes`);
      claimed.add(id);
    }
  }
}

function mergedScope(previous, generated) {
  if (previous && TERMINAL.has(previous.status) && definition(previous) !== definition(generated)) {
    throw new Error(`Completed scope ${previous.id} changed definition; use a new scope id for new work`);
  }
  let scope = clone(generated);
  if (previous) {
    const retained = Object.fromEntries(Object.entries(previous)
      .filter(([key]) => !PLANNING_FIELDS.includes(key) && key !== "tasks")
      .map(([key, value]) => [key, clone(value)]));
    scope = { ...scope, ...retained };
  } else if (scope.status !== undefined && scope.status !== "pending") {
    throw new Error(`New scope ${scope.id} cannot inherit an execution result`);
  }
  scope.status ??= "pending";
  scope.tasks = clone(previous?.tasks ?? []);
  return scope;
}

function transferTasks(previous, scopes, moves) {
  const consumed = new Set();
  for (const move of moves) {
    const source = previous.get(move.fromScope);
    const target = scopes.get(move.toScope);
    const key = canonicalTaskId(move.taskId);
    const sourceKey = `${move.fromScope}:${key}`;
    if (!source || !target || !validId(move.taskId) || !key || move.fromScope === move.toScope || consumed.has(sourceKey)) {
      throw new Error("Task move has a missing, duplicate or invalid source/target");
    }
    if (TERMINAL.has(target.status)) throw new Error("A completed scope cannot receive a moved task");
    const task = uniqueEntries(source.tasks ?? [], taskKey, "Historical tasks").get(key);
    if (!task || target.tasks.some((entry) => taskKey(entry) === key)) {
      throw new Error(`Task move ${sourceKey} is missing or conflicts with the target`);
    }
    const liveSource = scopes.get(move.fromScope);
    if (liveSource) liveSource.tasks = liveSource.tasks.filter((entry) => taskKey(entry) !== key);
    target.tasks.push(clone(task));
    consumed.add(sourceKey);
  }
  for (const [id, scope] of previous) {
    if (scopes.has(id)) continue;
    for (const task of scope.tasks ?? []) {
      if (!TERMINAL.has(task.status) && !consumed.has(`${id}:${taskKey(task)}`)) {
        throw new Error(`Unfinished task ${id}:${task.id} needs an explicit --move-task source:task:target`);
      }
    }
  }
}

function addPendingTasks(scopes, generated) {
  for (const [id, definition] of generated) {
    const target = scopes.get(id);
    const existing = uniqueEntries(target.tasks, taskKey, "Retained tasks");
    const incoming = uniqueEntries(definition.tasks ?? [], taskKey, "Generated tasks");
    for (const [key, task] of incoming) {
      if (existing.has(key)) {
        if (taskName(existing.get(key)) !== taskName(task)) {
          throw new Error(`Stable task ${id}:${task.id} changed meaning; use a new task id for new work`);
        }
        continue;
      }
      if (TERMINAL.has(target.status)) throw new Error(`Completed scope ${id} cannot receive a new task`);
      if (task.status !== undefined && task.status !== "pending") {
        throw new Error(`New task ${id}:${task.id} cannot inherit an execution result`);
      }
      target.tasks.push({ ...clone(task), status: "pending" });
    }
  }
}

function plan(previous, generated, options) {
  if (!previous || !generated || !generated.specTechFile || !/^[a-f0-9]{64}$/.test(options.specSha256 ?? "")) {
    throw new Error("Reconciliation requires workflow identity, target spec and its SHA-256");
  }
  if (!Number.isFinite(Date.parse(options.at)) || (previous.name && generated.name && previous.name !== generated.name)) {
    throw new Error("Reconciliation requires a valid audit time and the same workflow identity");
  }
  const old = uniqueEntries(previous.scopes, (scope) => scope?.id, "Historical scopes");
  const incoming = uniqueEntries(generated.scopes, (scope) => scope?.id, "Generated scopes");
  if (!incoming.size) throw new Error("An empty parser result cannot replace historical scopes");
  validateTasks(old, "Historical tasks");
  validateTasks(incoming, "Generated tasks");
  if (previous.specTechFile === generated.specTechFile) {
    if (previous.specTechSha256 && previous.specTechSha256 !== options.specSha256) {
      throw new Error("The active spec changed in place; publish a new versioned spec-tech file");
    }
    if (old.size !== incoming.size || [...incoming].some(([id, scope]) => !old.has(id) || definition(old.get(id)) !== definition(scope))) {
      throw new Error("Tracking disagrees with its active plan; publish a new versioned spec-tech file for rework");
    }
    return { ok: true, changed: false, workflow: clone(previous), summary: { retainedScopes: old.size } };
  }
  const scopes = new Map([...incoming].map(([id, scope]) => [id, mergedScope(old.get(id), scope)]));
  const moves = options.taskMoves ?? [];
  if (!Array.isArray(moves) || !Array.isArray(previous.scopeHistory ?? [])) throw new Error("Invalid history or task moves");
  transferTasks(old, scopes, moves);
  addPendingTasks(scopes, incoming);
  validateTasks(scopes, "Reconciled tasks");
  return reconciliation(previous, generated, scopes, options, moves);
}

function reconciliation(previous, generated, scopes, options, taskMoves) {
  const history = {
    kind: "scope-history-reconciliation", at: options.at,
    fromSpecTechFile: previous.specTechFile ?? null, toSpecTechFile: generated.specTechFile,
    fromSpecTechSha256: previous.specTechSha256 ?? null, toSpecTechSha256: options.specSha256,
    scopes: clone(previous.scopes), taskMoves: clone(taskMoves),
  };
  return {
    ok: true, changed: true,
    workflow: {
      ...clone(previous), scopes: [...scopes.values()], specTechFile: generated.specTechFile,
      specTechSha256: options.specSha256, scopeHistory: [...clone(previous.scopeHistory ?? []), history],
    },
    summary: { retainedScopes: scopes.size, archivedScopes: previous.scopes.length, movedTasks: taskMoves.length },
  };
}

/** Preserve historical execution facts; stable task IDs assert the same work, never new completion. */
export function reconcileScopeHistory(previous, generated, options = {}) {
  try {
    return plan(previous, generated, options);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid scope reconciliation" };
  }
}

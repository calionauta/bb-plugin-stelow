/**
 * Trackable relations (pure, no I/O, kind-blind).
 *
 * Dependencies are contractual, not advisory: a trackable blocked on an
 * open trackable cannot start, a trackable with open children cannot close,
 * and a dependency cycle refuses loud instead of stalling silently. Edges
 * come from the tracking the writer owns (`blockedBy`/`dependsOn`,
 * structural containment) — this module only validates and derives, never
 * invents edges or guesses headlines.
 *
 * Units are registry entries `{ id, kind?, status?, blockedBy?,
 * dependsOn?, children? }`, built by buildRegistry from whatever nesting
 * the writer uses (scopes with nested tasks, flat lists). All functions
 * below take the registry — there is no scope-specific or task-specific
 * variant. Dangling references warn (plans may span files); cycles refuse.
 */
import { isDoneStatus, isSkippedStatus, cleanTrackableId } from "./trackables.mjs";

function idList(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()) : [];
}

/**
 * Flatten writer-nested structures into a Map<id, entry>. Scopes register
 * with kind "scope" and their nested tasks as kind "task" children (task
 * ids pass through untouched); flat entries register as-is. defaultKind
 * names entries that carry neither kind nor children (callers registering
 * scopes pass "scope" — otherwise a taskless scope degrades to a bare
 * "trackable" and loses its contract lookup). Later ids never overwrite
 * earlier ones.
 */
export function buildRegistry(entries, { defaultKind } = {}) {
  const registry = new Map();
  const put = (entry) => {
    const id = entry && typeof entry === "object" ? cleanTrackableId(entry.id) : null;
    if (id && !registry.has(id)) registry.set(id, entry);
  };
  const fallback = typeof defaultKind === "string" && defaultKind ? defaultKind : "trackable";
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry !== "object") continue;
    const children = idList(entry.children);
    const tasks = Array.isArray(entry.tasks) ? entry.tasks : [];
    const taskIds = [];
    for (const task of tasks) {
      const taskId = task && typeof task === "object" ? cleanTrackableId(task.id) : null;
      if (!taskId) continue;
      taskIds.push(taskId);
      put({ ...task, id: taskId, kind: task.kind ?? "task", parent: cleanTrackableId(entry.id) ?? undefined });
    }
    const nested = [...children, ...taskIds];
    put({ ...entry, kind: entry.kind ?? (nested.length > 0 ? "scope" : fallback), children: nested });
  }
  return registry;
}

/** Dependency edges of one entry: blockedBy first, dependsOn second. */
export function edgesOf(entry) {
  if (!entry || typeof entry !== "object") return [];
  return [...idList(entry.blockedBy), ...idList(entry.dependsOn)];
}

/** Child entries of one entry: nested writer structures first, then registry links. */
export function childrenOf(entry, registry) {
  const nested = entry && typeof entry === "object" && Array.isArray(entry.tasks)
    ? entry.tasks.filter((task) => task && typeof task === "object")
    : [];
  if (!(registry instanceof Map)) return nested;
  const linked = entry && typeof entry === "object"
    ? idList(entry.children).map((id) => registry.get(id)).filter(Boolean)
    : [];
  const seen = new Set(nested.map((task) => task.id));
  return [...nested, ...linked.filter((child) => !seen.has(child.id))];
}

/** Edges pointing at unknown ids (warn-only: plans may span files). */
export function danglingEdges(registry) {
  const dangling = [];
  if (!(registry instanceof Map)) return dangling;
  for (const entry of registry.values()) {
    for (const dep of edgesOf(entry)) {
      if (!registry.has(dep)) dangling.push({ from: entry.id, to: dep });
    }
  }
  return dangling;
}

/** Dependency cycles ([] when acyclic). Each names its loop for refusals. */
export function dependencyCycles(registry) {
  const cycles = [];
  if (!(registry instanceof Map)) return cycles;
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map([...registry.keys()].map((id) => [id, WHITE]));
  const stack = [];
  const visit = (node) => {
    color.set(node, GRAY);
    stack.push(node);
    for (const dep of edgesOf(registry.get(node))) {
      if (!registry.has(dep)) continue;
      if (color.get(dep) === GRAY) {
        cycles.push([...stack.slice(stack.indexOf(dep)), dep]);
      } else if (color.get(dep) === WHITE) {
        visit(dep);
      }
    }
    stack.pop();
    color.set(node, BLACK);
  };
  for (const id of [...registry.keys()].sort()) {
    if (color.get(id) === WHITE) visit(id);
  }
  return cycles;
}

/** Whether a trackable may start: every known dependency is done. */
export function canStart(registry, id, isDone) {
  if (!(registry instanceof Map)) return false;
  const entry = registry.get(id);
  if (!entry) return false;
  return openDependencies(entry, registry, isDone).length === 0;
}

/** Known dependencies that are not done (empty when startable). */
export function openDependencies(entry, registry, isDone) {
  if (!(registry instanceof Map)) return [];
  const done = typeof isDone === "function" ? isDone : () => false;
  return edgesOf(entry).filter((dep) => registry.has(dep) && !done(registry.get(dep).status));
}

/** Open children (neither done nor skipped). Childless closes trivially. */
export function openChildren(entry, registry) {
  return childrenOf(entry, registry).filter((child) => !isDoneStatus(child.status) && !isSkippedStatus(child.status));
}

/** Whether a trackable may close: no open children remain. */
export function canClose(entry, registry) {
  if (!entry || typeof entry !== "object") return false;
  return openChildren(entry, registry).length === 0;
}

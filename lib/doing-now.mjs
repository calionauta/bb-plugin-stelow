/**
 * Doing-now selection (pure, no DB).
 *
 * One definition of "what is the worker executing" shared by the board
 * tile pill, the list row, and the detail "Doing now" line — three
 * surfaces that must never disagree. In-progress scopes first (state.md
 * order), then orphan in-progress tasks (tasks running outside any
 * in-progress scope). Closed scopes never surface: done work is history,
 * not doing.
 */

function isDoing(status) {
  return status === "in-progress";
}

export function doingNowNames(scopes, limit = 8) {
  if (!Array.isArray(scopes)) return [];
  const max = Number.isInteger(limit) && limit > 0 ? limit : 8;
  const doingScopes = scopes.filter((scope) => scope && typeof scope === "object" && isDoing(scope.status));
  const inDoing = new Set();
  for (const scope of doingScopes) {
    for (const task of Array.isArray(scope.tasks) ? scope.tasks : []) inDoing.add(task);
  }
  const orphans = [];
  for (const scope of scopes) {
    if (!scope || typeof scope !== "object") continue;
    for (const task of Array.isArray(scope.tasks) ? scope.tasks : []) {
      if (isDoing(task?.status) && !inDoing.has(task) && typeof task?.name === "string" && task.name.length > 0) orphans.push(task.name);
    }
  }
  const names = [
    ...doingScopes.map((scope) => scope.name).filter((name) => typeof name === "string" && name.length > 0),
    ...orphans,
  ];
  return names.slice(0, max);
}

// Dominant scope: the headline of the doing set. The executing scope
// first; without one, the open scope holding the most unfinished tasks
// (where the remaining work lives); without scopes, null — never a
// finished scope, never a guess.
export function dominantScopeName(scopes) {
  if (!Array.isArray(scopes)) return null;
  const doing = scopes.find((scope) => scope && typeof scope === "object" && isDoing(scope.status));
  if (doing && typeof doing.name === "string" && doing.name.length > 0) return doing.name;
  let best = null;
  let bestOpen = -1;
  for (const scope of scopes) {
    if (!scope || typeof scope !== "object") continue;
    const open = (Array.isArray(scope.tasks) ? scope.tasks : []).filter(
      (task) => task && typeof task === "object" && !["done", "completed"].includes(task.status),
    ).length;
    if (open > bestOpen && typeof scope.name === "string" && scope.name.length > 0) { best = scope.name; bestOpen = open; }
  }
  return bestOpen > 0 ? best : null;
}

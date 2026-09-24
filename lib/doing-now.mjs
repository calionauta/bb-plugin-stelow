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

import { isActiveStatus } from "./trackables.mjs";

function isDoing(status) {
  return isActiveStatus(status);
}

export function orderedDoingNow(executingScope, names) {
  const values = Array.isArray(names) ? names.filter((name) => typeof name === "string" && name.length > 0) : [];
  if (typeof executingScope === "string" && executingScope.length > 0) {
    return [...new Set([executingScope, ...values])];
  }
  return [...new Set(values)];
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

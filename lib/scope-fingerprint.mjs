/**
 * Scope-progress fingerprint (pure, no DB).
 *
 * Bounds silent staleness: the reconcile loop hashes each live card's
 * scope statuses and publishes card-state when the hash moves, so worker
 * edits with no host action surface on the board within one tick instead
 * of whenever the next host action happens to reload it. Only
 * progress-relevant fields enter the hash (scope/task ids + statuses) —
 * renames and notes never wake the board. Order-sensitive by design:
 * file order is the execution order the board renders.
 */

function keyOf(entry, fallback) {
  if (!entry || typeof entry !== "object") return null;
  const id = typeof entry.id === "string" && entry.id.length > 0 ? entry.id : typeof entry.name === "string" && entry.name.length > 0 ? entry.name : fallback;
  const status = typeof entry.status === "string" ? entry.status : "?";
  return `${id}:${status}`;
}

export function scopeFingerprint(scopes) {
  const list = Array.isArray(scopes) ? scopes : [];
  const parts = [];
  list.forEach((scope, index) => {
    const key = keyOf(scope, `scope-${index + 1}`);
    if (key === null) return;
    parts.push(key);
    const tasks = Array.isArray(scope.tasks) ? scope.tasks : [];
    tasks.forEach((task, taskIndex) => {
      const taskKey = keyOf(task, `task-${taskIndex + 1}`);
      if (taskKey !== null) parts.push(taskKey);
    });
  });
  return parts.join("|");
}

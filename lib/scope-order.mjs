/**
 * Scope ordering for the detail view. Pure logic, no BB host dependency.
 *
 * Topological order by dependency: a scope that depends on / is blocked by
 * another comes AFTER its dependency, so reading top→bottom follows
 * execution order. Ties keep the original (state.md) order — deterministic.
 * Cycles keep original position instead of hanging. Statuses rank for
 * sorting work (tasks): active first, then committed, then blocked, then
 * finished — a sensible vertical reading.
 */

import { isDoneStatus } from "./trackables.mjs";

export const STATUS_RANK = {
  "in-progress": 0,
  draft: 1,
  planning: 1,
  pending: 1,
  blocked: 2,
  failed: 2,
  skipped: 3,
  done: 4,
  completed: 4,
};

export function statusRank(status) {
  return STATUS_RANK[status ?? ""] ?? 3;
}

export function orderScopes(scopes) {
  const list = Array.isArray(scopes) ? scopes : [];
  const byId = new Map(list.map((s) => [s.id, s]));
  const done = new Set(list.filter((s) => isDoneStatus(s.status ?? "")).map((s) => s.id));
  // dependency ids: dependsOn must precede; blockedBy must precede
  const deps = (s) => [
    ...((s.dependsOn ?? []).filter((id) => byId.has(id))),
    ...((s.blockedBy ?? []).filter((id) => byId.has(id))),
  ];
  const ordered = [];
  const placed = new Set();
  const chain = new Set();
  const waitingOn = new Map();
  const visit = (s) => {
    if (!s || placed.has(s.id)) return;
    if (chain.has(s.id)) return; // cycle guard: keep original position
    chain.add(s.id);
    // visit each live dependency first (finished deps are fine in any order)
    for (const depId of deps(s)) {
      const dep = byId.get(depId);
      if (dep && !done.has(depId)) visit(dep); // still-pending deps push order
    }
    chain.delete(s.id);
    placed.add(s.id);
    ordered.push(s);
    const wait = deps(s).filter((id) => !done.has(id));
    if (wait.length) waitingOn.set(s.id, wait);
  };
  list.forEach(visit);
  return { ordered, waitingOn };
}

import { isDoneStatus } from "./trackables.mjs";

const BLOCKED = new Set(["blocked", "failed", "escalated"]);

function percent(done, total) {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

export function summarizeScopeProgress(scopes) {
  const list = Array.isArray(scopes) ? scopes : [];
  const tasks = list.flatMap((scope) => Array.isArray(scope?.tasks) ? scope.tasks : []);
  const doneScopes = list.filter((scope) => isDoneStatus(scope?.status));
  const doneTasks = tasks.filter((task) => isDoneStatus(task?.status));
  const doingScopes = list.filter((scope) => scope?.status === "in-progress");
  const doingTasks = tasks.filter((task) => task?.status === "in-progress");
  const doingNames = [
    ...doingScopes.map((scope) => scope.name),
    ...doingTasks
      .filter((task) => !doingScopes.some((scope) => scope.tasks?.includes(task)))
      .map((task) => task.name),
  ];
  return {
    scopes: { done: doneScopes.length, total: list.length, percent: percent(doneScopes.length, list.length) },
    tasks: { done: doneTasks.length, total: tasks.length, percent: percent(doneTasks.length, tasks.length) },
    doingNames,
    doingCount: doingScopes.length + doingTasks.length,
    blockedNames: list.filter((scope) => BLOCKED.has(scope?.status)).map((scope) => scope.name),
    allComplete: list.length > 0 && doneScopes.length === list.length,
  };
}

export function gapSummaryPresentation(summary) {
  if (!summary?.matched) return null;
  const blocked = summary.unscoped > 0 || summary.pendingScopes > 0;
  const causes = [];
  if (summary.unscoped > 0) causes.push(`Done waits on ${summary.unscoped} escalated gap${summary.unscoped === 1 ? "" : "s"} without a rework scope — this card loops back: the worker runs gap-scopes, advances to execution, executes the new scopes, and re-runs the critique.`);
  if (summary.pendingScopes > 0) causes.push(`${summary.pendingScopes} rework scope${summary.pendingScopes === 1 ? "" : "s"} still open.`);
  return {
    blocked,
    waitCopy: blocked && !summary.done ? causes.join(" ") : null,
    resolvedCopy: summary.escalated > 0 && !blocked ? "Every escalation links a finished rework scope." : null,
  };
}

export function qualitySealPresentation(seal, path) {
  if (!seal) return { text: "quality…", icon: "?", tone: "border-zinc-500/40 bg-zinc-500/10 hover:bg-zinc-500/20" };
  const states = {
    verified: { text: "verified", icon: "✓", tone: "border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20" },
    "hypothesis-only": { text: "hypothesis", icon: "◐", tone: "border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20" },
    "needs-revision": { text: "needs work", icon: "!", tone: "border-orange-500/40 bg-orange-500/10 hover:bg-orange-500/20" },
  };
  const state = states[seal.status] ?? { text: "unverified", icon: "?", tone: "border-zinc-500/40 bg-zinc-500/10 hover:bg-zinc-500/20" };
  return {
    ...state,
    title: seal.failures?.length ? `${seal.label ?? path}: ${seal.failures.join("; ")}` : (seal.label ?? path),
  };
}

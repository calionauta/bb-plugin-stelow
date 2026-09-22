/**
 * Build completion gates (pure, no I/O).
 *
 * Every refusal on the way into execution and into done lives here, in
 * documented order — first refusal wins. Callers (server advance/done,
 * the upstream CLI equivalents) only gather inputs; the ORDER below is the
 * contract, pinned by tests, so a reordered gate breaks the build instead
 * of silently changing which refusal a worker sees.
 *
 * Advance order: untracked-execution → dependency cycle → unstartable
 * ordering note (advisory, never a refusal).
 * Done order: untracked-execution → unverified Record → open children.
 * Every refusal names the valid redirect.
 */
import { isDoneStatus } from "./trackables.mjs";
import { buildRegistry, canClose, openChildren } from "./trackable-relations.mjs";
import { diagnoseScopeSync } from "./spec-scope-reader.mjs";

const SYNC_REDIRECT = "run `bb stelow sync-scopes`, then advance again";

function untrackedRefusal({ kind, stage, at, specMachine, specHuman }) {
  if (kind !== "build") return null;
  if (specHuman > 0 && specMachine === 0) {
    return `Refused: ${at} with 0 synced scopes, but spec-tech uses human headings (\`### SCOPE-N:\`) that sync-scopes silently skips. Rewrite each scope opener as \`[SCOPE-N] Title\` (see scopes-and-sequencing), run \`bb stelow sync-scopes\`, \`bb stelow advance execution\`, execute the scopes, then run done again.`;
  }
  if (specMachine > 0) {
    return `Refused: ${at} with 0 synced scopes, but spec-tech has ${specMachine} machine scope block(s). Run \`bb stelow sync-scopes\`, \`bb stelow advance execution\`, execute the scopes, then run done again.`;
  }
  return null;
}

/**
 * Advance-into-execution gates. Returns { refusal, note }: refusal blocks,
 * note rides a successful advance (ordering advisory).
 */
export function advanceExecutionGates({ kind, stage, specContent, syncedCount, cycles = [], hasUnstartablePending = false } = {}) {
  if (kind !== "build" || stage !== "execution") return { refusal: null, note: null };
  const diagnosis = diagnoseScopeSync({ specContent, syncedCount });
  if (diagnosis.state === "human-dialect" || diagnosis.state === "unsynced") {
    const refusal = untrackedRefusal({ kind, stage, at: "entering execution", specMachine: diagnosis.machine, specHuman: diagnosis.human });
    if (refusal) return { refusal, note: null };
  }
  if (Array.isArray(cycles) && cycles.length > 0 && Array.isArray(cycles[0])) {
    return {
      refusal: `Refused: blockedBy cycle detected (${cycles[0].join(" -> ")}) — fix Dependencies: in the spec-tech file so the graph is acyclic, run \`bb stelow sync-scopes\`, then advance again.`,
      note: null,
    };
  }
  if (hasUnstartablePending) {
    return {
      refusal: null,
      note: "no scope can start — every pending scope waits on unfinished work; check blockedBy before executing",
    };
  }
  return { refusal: null, note: null };
}

/**
 * Done gates over tracked truth (never merged display tasks). First
 * refusal wins: untracked → unverified Record → open children.
 */
export function doneBuildGates({ kind, stage, scopes = [], specMachine = 0, specHuman = 0 } = {}) {
  if (kind !== "build" || stage !== "audit") return null;
  const tracked = Array.isArray(scopes) ? scopes.filter((scope) => scope && typeof scope === "object") : [];
  if (tracked.length === 0) {
    return untrackedRefusal({ kind, stage, at: "audit reached", specMachine, specHuman });
  }
  const unverified = tracked.filter((scope) => isDoneStatus(scope.status)
    && scope.record && typeof scope.record === "object" && scope.record.verified !== true);
  if (unverified.length > 0) {
    return `Build completion is blocked: ${unverified.length} done scope(s) carry an unverified Record — complete every verification checklist item and re-run the scope's verify commands, then run done again:\n${unverified.map((scope) => `- ${scope.name ?? scope.id}`).join("\n")}`;
  }
  const registry = buildRegistry(tracked);
  const unclosed = tracked.filter((scope) => isDoneStatus(scope.status) && !canClose(registry.get(scope.id), registry));
  if (unclosed.length > 0) {
    const openNames = (id) => openChildren(registry.get(id), registry).map((task) => task.name ?? task.id).join("; ");
    return `Build completion is blocked: ${unclosed.length} done scope(s) still hold open tasks — a scope closes only when its tasks do. Mark each done or skipped, then run done again:\n${unclosed.map((scope) => `- ${scope.name ?? scope.id}: ${openNames(scope.id)}`).join("\n")}`;
  }
  return null;
}

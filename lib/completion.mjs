// Explicit completion gate. Done-ness used to be inferred from
// `current_stage == audit` + idle, so a worker that narrated-and-stopped at
// audit was indistinguishable from one stuck at audit — the same confusion
// that produced the stop-per-turn incidents. Now the worker commits
// completion with `bb stelow done`, and the host decides, in code, whether
// the workflow is actually complete:
//
// - build completes only at the `audit` stage (the machine's terminal);
// - build completes only with every scope done, completed, or explicitly
//   skipped — pending scopes at audit mean the worker walked past the
//   execution it promised, and done must not certify that;
// - research/explore complete only with a pending-question-free card (their
//   artifact gates run through `verify`, which `done` does not replace).
//
// Every refusal names the valid redirect — a refusal without an exit is a
// deadlock with a good error message.
import { isDoneStatus, isSkippedStatus } from "./trackables.mjs";
export function doneEligibility({ kind, stage, questionPending, scopesOpen = [] }) {
  if (questionPending) {
    return "Refused: a question is still pending an answer. Answer it (or wait for the card answer to arrive) before running `bb stelow done` — completing now would abandon it.";
  }
  if (kind === "build") {
    if (stage !== "audit") {
      const where = stage ?? "an unknown stage";
      return `Refused: this workflow is at '${where}', not 'audit'. Keep working the current stage and advancing — run 'bb stelow done' only when the audit work is complete.`;
    }
    const open = Array.isArray(scopesOpen) ? scopesOpen.filter((scope) => scope && typeof scope === "object" && !isDoneStatus(scope.status) && !isSkippedStatus(scope.status)) : [];
    if (open.length > 0) {
      return `Refused: ${open.length} scope(s) still open — done certifies finished work, not walked-past work. Finish them (advance execution and execute), or mark the obsolete ones skipped, then run done again:\n${open.map((scope) => `- ${scope.name ?? scope.id} (${scope.status ?? "pending"})`).join("\n")}`;
    }
    return null;
  }
  if (kind === "research" || kind === "explore") {
    return null;
  }
  return `Refused: unknown card kind "${kind}". Archive this card and start a new one.`;
}

// Scope-sync companion to doneEligibility (which stays untouched: an empty
// scope list alone is no veto there). A build at audit with zero synced
// scopes but a spec-tech carrying scope blocks — machine or human-dialect —
// is the invisible-scopes incident: done would certify work whose execution
// was never tracked. Every refusal names the valid redirect.
export function doneScopeSyncRefusal({ kind, stage, scopesOpen = [], specMachine = 0, specHuman = 0 }) {
  if (kind !== "build" || stage !== "audit") return null;
  const open = Array.isArray(scopesOpen) ? scopesOpen.filter((scope) => scope && typeof scope === "object") : [];
  if (open.length > 0) return null;
  if (specHuman > 0 && specMachine === 0) {
    return "Refused: audit reached with 0 synced scopes, but spec-tech uses human headings (`### SCOPE-N:`) that sync-scopes silently skips. Rewrite each scope opener as `[SCOPE-N] Title` (see scopes-and-sequencing), run `bb stelow sync-scopes`, `bb stelow advance execution`, execute the scopes, then run done again.";
  }
  if (specMachine > 0) {
    return `Refused: audit reached with 0 synced scopes, but spec-tech has ${specMachine} machine scope block(s). Run \`bb stelow sync-scopes\`, \`bb stelow advance execution\`, execute the scopes, then run done again.`;
  }
  return null;
}

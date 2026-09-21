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
export function doneEligibility({ kind, stage, questionPending, scopesOpen = [] }) {
  if (questionPending) {
    return "Refused: a question is still pending an answer. Answer it (or wait for the card answer to arrive) before running `bb stelow done` — completing now would abandon it.";
  }
  if (kind === "build") {
    if (stage !== "audit") {
      const where = stage ?? "an unknown stage";
      return `Refused: this workflow is at '${where}', not 'audit'. Keep working the current stage and advancing — run 'bb stelow done' only when the audit work is complete.`;
    }
    const open = Array.isArray(scopesOpen) ? scopesOpen.filter((scope) => scope && typeof scope === "object" && !["done", "completed", "skipped"].includes(scope.status)) : [];
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

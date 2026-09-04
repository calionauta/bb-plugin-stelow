/**
 * Ask-cancellation policy. Pure logic, no BB host dependency, so the full
 * cancel-reason matrix is exercised in tests.
 *
 * Context: `bb stelow ask` blocks on a host interaction. When the wait ends
 * without an answer, the question must persist (expired_questions +
 * awaiting-answer) for infrastructure reasons (the user never saw it), and
 * pass through for explicit end states (the human or the thread ended it).
 * Getting this wrong silently loses decisions — as happened when a plugin
 * reload cancelled a gate approval with reason `plugin-disposed`.
 */

export const TRANSIENT_CANCEL_REASONS = ["timeout", "plugin-disposed", "server-restarted", "request-aborted"];

/**
 * Returns "persist" when a cancelled ask must be recorded as still-pending,
 * "passthrough" when the worker should simply see the cancellation.
 * A request that threw before returning counts as transient (the user
 * never saw the question either).
 */
export function classifyAskCancel(outcome, reason, requestFailed = false) {
  if (requestFailed) return "persist";
  if (outcome !== "cancelled" || reason == null) return "passthrough";
  return TRANSIENT_CANCEL_REASONS.includes(reason) ? "persist" : "passthrough";
}

/**
 * Worker-facing explanation for a persisted interruption. Never claims the
 * user is away when the infrastructure dropped the question instead.
 */
export function interruptionWhy(reason, requestFailed, elapsedSecs) {
  if (requestFailed) return "The question request failed before delivery.";
  if (reason === "timeout") return `No response after ${elapsedSecs}s — the user is away.`;
  const cause = reason === "plugin-disposed" ? "plugin reload" : reason;
  return `The question was interrupted by a ${cause} after ${elapsedSecs}s — the user never saw it.`;
}

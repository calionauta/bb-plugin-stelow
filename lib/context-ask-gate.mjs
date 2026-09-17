/**
 * Deterministic intent gate for the context stage. The context stage exists
 * to explore product space (strategic approaches, domain libraries) — a
 * refactor/bugfix normally have less product space to explore. Upstream
 * `context:5` now permits a reduced opt-in ask when the baseline is
 * verifiable, so this host must not impose a blanket refusal it cannot
 * distinguish from that permitted path.
 */

export const CONTEXT_STAGE = "context";

// Intents with no product space to explore. Unknown/other intents fail
// open — the gate never blocks what it cannot classify.
export const CONTEXT_SKIP_INTENTS = ["refactor", "bugfix"];

/**
 * Decide whether a worker ask may reach the human.
 * Returns { allowed, error }: refusals name the redirect, never dead-end.
 */
export function contextAskGate({ kind, intent, stage, tag, forced }) {
  if (forced) return { allowed: true, error: null };
  if (tag === "split") return { allowed: true, error: null };
  if (kind !== "build") return { allowed: true, error: null };
  void intent;
  void stage;
  return { allowed: true, error: null };
}

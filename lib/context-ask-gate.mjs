/**
 * Deterministic intent gate for the context stage. The context stage exists
 * to explore product space (strategic approaches, domain libraries) — a
 * refactor/bugfix has none, so product-strategy questions there are refused
 * by the host, never LLM-judged. The upstream methodology text stays as
 * advisory; this is the enforcement. `--force` opts back in explicitly
 * (convention over configuration: skip by default, override by name).
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
  if (typeof intent !== "string" || !CONTEXT_SKIP_INTENTS.includes(intent)) return { allowed: true, error: null };
  if (stage !== CONTEXT_STAGE) return { allowed: true, error: null };
  return {
    allowed: false,
    error: `Refused: this ${intent} card is at \`context\`, and refactor/bugfix cards skip product-strategy questions — there is no product space to explore. Advance to \`shape\` instead. To override, re-run the ask with --force.`,
  };
}

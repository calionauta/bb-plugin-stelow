/**
 * Pure start-policy gate for GitHub automation (Agentes-style: decision in
 * lib with a node test, never inline-only in server.ts).
 *
 * Decides from the EFFECTIVE spawn environment — the band-routed preset
 * wins over any explicitly passed preset at spawn time, so checking "some
 * worktree preset exists" is not enough. The caller resolves the effective
 * environment kind through the same band logic the spawn uses and hands it
 * here as a plain value.
 */

export function decideAutomationSpawn({ startImmediate, effectiveEnvKind }) {
  if (!startImmediate) return { start: false, parkedReason: null };
  if (effectiveEnvKind === "new-worktree") return { start: true, parkedReason: null };
  return { start: false, parkedReason: "no-worktree-preset" };
}

export function describeParkedReason(reason) {
  if (reason === "no-worktree-preset") {
    return "parked: the resolved spawn environment is not an isolated worktree — create a New-worktree preset in Agent Presets";
  }
  return "parked by rule policy";
}

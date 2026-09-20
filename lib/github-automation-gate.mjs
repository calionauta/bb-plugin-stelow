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

/**
 * Effective spawn environment from its two inputs: the band-routed
 * preset wins over any explicitly passed preset at spawn time, so a
 * present band value always decides — even when a worktree preset
 * exists elsewhere. Unknown/missing reads as project-default (shared),
 * never as isolated: fail closed.
 */
export function resolveEffectiveEnvKind({ bandEnvKind, worktreePresetId }) {
  if (bandEnvKind === "new-worktree" || bandEnvKind === "project-default") return bandEnvKind;
  if (typeof bandEnvKind === "string" && bandEnvKind) return "project-default";
  if (typeof worktreePresetId === "string" && worktreePresetId) return "new-worktree";
  return "project-default";
}

export function describeParkedReason(reason) {
  if (reason === "no-worktree-preset") {
    return "parked: the resolved spawn environment is not an isolated worktree — create a New-worktree preset in Agent Presets";
  }
  return "parked by rule policy";
}

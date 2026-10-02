import { useRef } from "react";
import { captureEnvironmentSeed, presetEnvironmentSeed } from "../../lib/preset-environment-seed.mjs";

export type ComposerEnvironmentSeed = ReturnType<typeof presetEnvironmentSeed>;

/**
 * The composer's environment seed, captured once per dialog *open*.
 *
 * The host value-compares every `default*` prop on each render and re-seeds
 * **every** selection when one changes — including selections the person has
 * already touched. That is reachable here: opening Agent Presets does not
 * close the create dialog, a save refreshes the preset list, and the active
 * preset's kind can change under a live composer.
 *
 * Capturing once per open is what makes the *environment* picker immune to
 * that. It is deliberately the only field that is: provider, model, reasoning
 * level and permission mode are still read live from the preset, so changing
 * one of those mid-dialog re-seeds it. FEATURES.md says so in the same words.
 *
 * The rule itself lives in `captureEnvironmentSeed` so it can be executed by a
 * test rather than read out of this file. The seed value is a frozen module
 * constant from `lib/preset-environment-seed.mjs`, so even the first render
 * hands the host a stable reference rather than a fresh literal.
 */
export function useSeededComposerEnvironment(
  environmentKind: string | null | undefined,
  open: boolean,
): ComposerEnvironmentSeed {
  // A wrapper object rather than the seed itself: `undefined` is a real,
  // meaningful value here (it means "seed nothing"), so it cannot double as
  // the "not captured yet" sentinel.
  const captured = useRef<{ open: boolean; seed: ComposerEnvironmentSeed } | null>(null);
  captured.current = captureEnvironmentSeed(captured.current, open, environmentKind);
  return captured.current.seed;
}

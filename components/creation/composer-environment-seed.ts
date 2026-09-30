import { useRef } from "react";
import { presetEnvironmentSeed } from "../../lib/preset-environment-seed.mjs";

export type ComposerEnvironmentSeed = ReturnType<typeof presetEnvironmentSeed>;

/**
 * The composer's environment seed, captured once for this dialog's mounted
 * lifetime.
 *
 * The host value-compares every `default*` prop on each render and re-seeds
 * **every** selection when one changes — including selections the person has
 * already touched. That is reachable here: opening Agent Presets does not close
 * the create dialog, a save refreshes the preset list, and the active preset's
 * kind can change under a live composer.
 *
 * Capturing once is what makes "picking something else always wins" true rather
 * than aspirational. The value itself is a module-level frozen constant from
 * `lib/preset-environment-seed.mjs`, so even the first render hands the host a
 * stable reference rather than a fresh literal.
 *
 * Reopening the dialog remounts this hook and re-reads the preset, which is
 * the one moment the seed is allowed to change.
 */
export function useSeededComposerEnvironment(
  environmentKind: string | null | undefined,
): ComposerEnvironmentSeed {
  // A wrapper object rather than the seed itself: `undefined` is a real,
  // meaningful value here (it means "seed nothing"), so it cannot double as
  // the "not captured yet" sentinel.
  const captured = useRef<{ seed: ComposerEnvironmentSeed } | null>(null);
  captured.current ??= { seed: presetEnvironmentSeed(environmentKind) };
  return captured.current.seed;
}
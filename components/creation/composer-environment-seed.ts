import { useRef } from "react";
import { presetEnvironmentSeed } from "../../lib/preset-environment-seed.mjs";

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
 * Capturing once per open is what makes "picking something else always wins"
 * true rather than aspirational: the seed is read when the dialog opens and
 * then frozen, so nothing that happens underneath it can overwrite a person's
 * pick. The value itself is a module-level frozen constant from
 * `lib/preset-environment-seed.mjs`, so even the first render hands the host a
 * stable reference rather than a fresh literal.
 *
 * `open` is the reset key, and it has to be: this hook is called ABOVE
 * `<Dialog>`, and Radix unmounts `DialogContent` on close — not the component
 * holding the hook. A plain mount-once ref would therefore survive a close and
 * a reopen, and the picker would keep showing the preset as it was the first
 * time the panel mounted. Keying on `open` is what makes "reopening re-reads
 * the preset" true rather than merely intended.
 */
export function useSeededComposerEnvironment(
  environmentKind: string | null | undefined,
  open: boolean,
): ComposerEnvironmentSeed {
  // A wrapper object rather than the seed itself: `undefined` is a real,
  // meaningful value here (it means "seed nothing"), so it cannot double as
  // the "not captured yet" sentinel.
  const captured = useRef<{ open: boolean; seed: ComposerEnvironmentSeed } | null>(null);
  if (captured.current?.open !== open) {
    captured.current = { open, seed: presetEnvironmentSeed(environmentKind) };
  }
  return captured.current.seed;
}
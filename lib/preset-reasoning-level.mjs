/**
 * The reasoning-level vocabulary a preset is allowed to hold, in one place.
 *
 * These are exactly the eight values of the BB host's `reasoningLevelSchema`
 * (`@get-bb/plugin-sdk` bundled types, `reasoningLevelSchema`). A level outside
 * this set cannot be honoured when the card's worker is spawned — the host
 * either refuses it or silently drops to the provider's default effort while
 * the settings screen keeps showing what the human chose — so it is refused at
 * the write boundary and repaired by the preset migration.
 *
 * The vocabulary used to live in `components/settings/preset-execution-values.mjs`,
 * which the server cannot import: depcruise's `lib-stays-host-neutral` forbids
 * `lib/` reaching into `components/`. That is the whole reason the server had
 * no validator at all. One owner, imported by both sides, ends that.
 */

/** @type {readonly ["low", "medium", "high", "xhigh", "max", "none", "ultra", "ultracode"]} */
export const PRESET_REASONING_LEVELS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "none",
  "ultra",
  "ultracode",
];

/**
 * The level a preset carries when nothing else applies. Identical to the host's
 * own `DEFAULT_REASONING_LEVEL`, so repairing an out-of-enum row lands on the
 * same effort the host would have chosen — and on the value the picker already
 * displayed for it, which is why repairing is invisible.
 */
export const DEFAULT_PRESET_REASONING_LEVEL = "medium";

/** Whether a value is a level the host can actually spawn. Never coerces. */
export function isPresetReasoningLevel(value) {
  return PRESET_REASONING_LEVELS.includes(value);
}

/**
 * A level narrowed to something spawnable: the value when it is one of the
 * eight, `medium` otherwise. Display/read normalisation only — a write must be
 * refused, never quietly rewritten (see `upsertPreset`).
 */
export function asPresetReasoningLevel(value) {
  return isPresetReasoningLevel(value) ? value : DEFAULT_PRESET_REASONING_LEVEL;
}
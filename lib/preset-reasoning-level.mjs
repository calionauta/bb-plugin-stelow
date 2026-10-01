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
 *
 * The eight are the host's global enum, which is a SUPERSET of what any one
 * provider accepts: each provider declares its own ladder (the host's
 * `ProviderInfo.reasoningLevels`, ids only) and every provider is missing at
 * least one of the eight — `pi` declares none of `ultra`/`ultracode`, `codex`
 * declares no `none`, `acp-*` declare neither. So passing this module's
 * `isPresetReasoningLevel` is necessary and not sufficient, and the second half
 * of the check lives here too: the provider ladder, read from the host roster.
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
 *
 * It survives a truthful surface because it is not a claim about support: the
 * host picker component's prop is typed as the eight, so a stored value outside
 * them has to be narrowed to be renderable at all. It fires only for a value
 * the storage CHECK already refuses, so it can never be the thing that hides an
 * unsupported-but-legal level — `isLevelDeclaredForProvider` is what reports
 * that, and it is reported next to the level, not folded into it.
 */
export function asPresetReasoningLevel(value) {
  return isPresetReasoningLevel(value) ? value : DEFAULT_PRESET_REASONING_LEVEL;
}

/**
 * The reasoning levels one provider declares, read from the host's own roster
 * (`ProviderInfo.reasoningLevels`, the option descriptors carrying an `id`).
 * `null` when the provider is absent from the roster or declares no ladder —
 * "the host did not say", which is not the same as "the level is unsupported"
 * and must never be collapsed into it.
 *
 * Host-neutral on purpose: the roster arrives as plain data so `lib/` keeps no
 * dependency on the SDK, and the server and the UI ask the same question of the
 * same shape.
 */
export function declaredProviderLevels(roster, providerId) {
  const provider = (roster ?? []).find((entry) => entry?.id === providerId);
  const declared = (provider?.reasoningLevels ?? [])
    .map((entry) => entry?.id)
    .filter((id) => typeof id === "string");
  return declared.length > 0 ? declared : null;
}

/**
 * Whether `level` is one the provider declares. `true`/`false` on a known
 * ladder, `null` when the provider declares none — the caller must treat `null`
 * as "unverified" and say so, never as support.
 */
export function isLevelDeclaredForProvider(roster, providerId, level) {
  const declared = declaredProviderLevels(roster, providerId);
  if (!declared) return null;
  return ladderIncludes(declared, level);
}

/**
 * Whether a declared ladder (the array `declaredProviderLevels` returned)
 * contains the level. Split out so a caller that already holds the ladder — the
 * write boundary, which read the roster once — asks the question without
 * rebuilding a roster to ask it.
 */
export function ladderIncludes(declared, level) {
  return declared.includes(asPresetReasoningLevel(level));
}

/**
 * The refusal a save gets when the provider's own ladder excludes the level.
 * It names the ladder the provider declared, because "invalid level" would send
 * the reader back to a picker that is not where the mismatch lives.
 */
export function unsupportedLevelMessage(providerId, level, declared) {
  return `Provider "${providerId}" does not support reasoning level "${level}". `
    + `It supports: ${declared.join(", ")}.`;
}

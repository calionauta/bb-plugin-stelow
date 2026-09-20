/**
 * Reliable-tier preset resolution. Reliable work (worker spawns, band swaps,
 * research fan-out, automation drafts) runs on the band preset by default —
 * the safe behavior, since it does tools, exact file shapes, and multi-step
 * sequencing. An optional board-level reliable override lets the user pin a
 * different preset for that tier without touching per-phase band routing.
 * Empty override means today's behavior, never a refusal.
 */

// Where the reliable preset came from. `band` and `default` are the safe
// fallbacks: an unset override degrades to today's behavior.
export const RELIABLE_SOURCE_CARD = "card";
export const RELIABLE_SOURCE_OVERRIDE = "reliable";
export const RELIABLE_SOURCE_BAND = "band";
export const RELIABLE_SOURCE_DEFAULT = "default";

export function resolveReliablePreset({ cardPin, reliableOverride, bandPreset, defaultPreset }) {
  if (typeof cardPin === "string" && cardPin.length > 0) return { presetId: cardPin, source: RELIABLE_SOURCE_CARD };
  if (typeof reliableOverride === "string" && reliableOverride.length > 0) return { presetId: reliableOverride, source: RELIABLE_SOURCE_OVERRIDE };
  if (typeof bandPreset === "string" && bandPreset.length > 0) return { presetId: bandPreset, source: RELIABLE_SOURCE_BAND };
  if (typeof defaultPreset === "string" && defaultPreset.length > 0) return { presetId: defaultPreset, source: RELIABLE_SOURCE_DEFAULT };
  return { presetId: null, source: null };
}

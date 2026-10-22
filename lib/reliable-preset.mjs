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

/**
 * Accept a band list as well as the single band this took before.
 *
 * A list is the stage's tier band followed by its phase band
 * (`presetBandsForCardKindStage`), so the first band that resolves wins and an
 * unset tier row falls through to exactly the preset the phase would have
 * chosen. The single-name form is retained verbatim because callers that
 * resolve a band for a reason other than a stage — the draft burst's board
 * default, a band picker — still ask one question with one answer.
 */
function firstResolvedBand(bandPreset) {
  const bands = Array.isArray(bandPreset) ? bandPreset : [bandPreset];
  for (const band of bands) {
    if (typeof band === "string" && band.length > 0) return band;
  }
  return null;
}

export function resolveReliablePreset({ cardPin, reliableOverride, bandPreset, defaultPreset }) {
  if (typeof cardPin === "string" && cardPin.length > 0) return { presetId: cardPin, source: RELIABLE_SOURCE_CARD };
  if (typeof reliableOverride === "string" && reliableOverride.length > 0) return { presetId: reliableOverride, source: RELIABLE_SOURCE_OVERRIDE };
  const band = firstResolvedBand(bandPreset);
  if (band) return { presetId: band, source: RELIABLE_SOURCE_BAND };
  if (typeof defaultPreset === "string" && defaultPreset.length > 0) return { presetId: defaultPreset, source: RELIABLE_SOURCE_DEFAULT };
  return { presetId: null, source: null };
}

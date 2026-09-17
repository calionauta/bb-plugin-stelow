/**
 * Self-update mapping for the BB-native plugin check. The SDK call itself
 * lives in server.ts (it needs the live `bb.sdk`); everything decidable is
 * here so it stays testable and out of the handlers.
 *
 * Wire outcomes (`PluginUpdateCheckEntry.outcome`): update-available,
 * current, incompatible, pinned, unavailable. "checking" is our local
 * pre-first-check state only — never from BB.
 */

const WIRE_OUTCOMES = ["update-available", "current", "incompatible", "pinned", "unavailable"];

/** This plugin's entry among every installed plugin's check result. */
export function selectOwnEntry(entries, pluginId) {
  if (!Array.isArray(entries)) return null;
  return entries.find((entry) => entry !== null && typeof entry === "object" && entry.id === pluginId) ?? null;
}

/** Reduce one wire entry to panel state. Never throws; unknown shapes read as unavailable. */
export function mapUpdateEntry(entry) {
  const empty = { outcome: "unavailable", installed: null, installedDisplay: null, candidate: null, candidateDisplay: null, detail: null };
  if (entry === null || typeof entry !== "object") {
    return { ...empty, detail: "BB returned no update status for this plugin." };
  }
  const outcome = WIRE_OUTCOMES.includes(entry.outcome) ? entry.outcome : "unavailable";
  const installed = entry.installed && typeof entry.installed.version === "string" ? entry.installed.version : null;
  const installedDisplay = entry.installed && typeof entry.installed.display === "string" ? entry.installed.display : null;
  const candidate = outcome === "update-available" && entry.candidate && typeof entry.candidate.version === "string" ? entry.candidate.version : null;
  const candidateDisplay = candidate !== null && typeof entry.candidate.display === "string" ? entry.candidate.display : null;
  const blockedReason = entry.blocked && Array.isArray(entry.blocked.reasons) && typeof entry.blocked.reasons[0] === "string" ? entry.blocked.reasons[0] : null;
  const detail = typeof entry.detail === "string" ? entry.detail : blockedReason ?? (outcome === "unavailable" ? "BB returned no update status for this plugin." : null);
  return { outcome, installed, installedDisplay, candidate, candidateDisplay, detail };
}

/**
 * Human label for a wire version. Git installs report commit shas, so prefer
 * the tag BB prints in the display string ("…git@v0.18.47 (4450336f…)"),
 * then a short sha, then the raw value. The tag is the last @-segment
 * without slashes, so userinfo hosts earlier in the display never win.
 */
export function shortRef(version, display) {
  if (typeof display === "string") {
    const tag = display.match(/@([^/\s(]+)\s*(\(|$)/);
    if (tag) return tag[1];
  }
  if (typeof version === "string" && /^[0-9a-f]{40}$/i.test(version)) return version.slice(0, 12);
  return version ?? null;
}

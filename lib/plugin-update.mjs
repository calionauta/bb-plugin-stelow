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
 * Whether BB installed this plugin from a local path. Only path installs
 * take the manual update path (checkout pull + rebuild + reload); every
 * other source is BB-managed, so update copy must never send those users
 * to a checkout they do not have.
 */
export function isPathInstall(display) {
  return typeof display === "string" && display.trim().toLowerCase().startsWith("path:");
}

/**
 * Merge a failed refresh into the last known verdict. A transient check
 * failure (network, BB registry blip) must never erase a verdict that was
 * already shown: the candidate button disappears and the panel reads
 * "nothing available" while the release is real. So keep the previous
 * outcome and fields, stamp the failure as the detail, and only fall back
 * to "unavailable" when there was no previous verdict yet ("checking").
 */
export function applyFailedCheck(previous, reason, checkedAt = Date.now()) {
  const keep = previous !== null && typeof previous === "object" && previous.outcome !== "checking";
  return {
    ...(keep
      ? previous
      : { outcome: "unavailable", installed: null, installedDisplay: null, candidate: null, candidateDisplay: null }),
    detail: `Update check failed: ${reason}`,
    checkedAt,
  };
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

/**
 * Decision freshness. A receipt authorizes the versions it names — never the
 * future. When the shape or the scope map moved past what the receipt saw, or
 * the code under its scopes changed, the receipt is stale: still readable as
 * history, no longer load-bearing as permission. Reconfirmation is then asked,
 * never assumed.
 *
 * Version-bound, not clock-bound: a creation date lies in both directions
 * (an old decision may be in force; a new one may be wrong). Versions do not.
 * Missing versions mean `unknown` on purpose — freshness must prove itself.
 */

/**
 * @param {object} receipt `{ authorizesVersions?: { shape_version?, scopeMapVersion? }, scopeIds? }`
 * @param {{ shapeVersion?: unknown, scopeMapVersion?: unknown, touchedScopeIds?: unknown }} current
 * @returns {"current" | "stale" | "unknown"}
 */
export function freshnessOf(receipt, current) {
  const authorized = receipt?.authorizesVersions;
  if (!authorized || typeof authorized !== "object") return "unknown";
  const shapeAuth = authorized.shape_version;
  const mapAuth = authorized.scopeMapVersion;
  if (shapeAuth === undefined && mapAuth === undefined) return "unknown";
  const now = current ?? {};
  if (shapeAuth !== undefined && now.shapeVersion !== undefined && now.shapeVersion !== shapeAuth) return "stale";
  if (mapAuth !== undefined && now.scopeMapVersion !== undefined && now.scopeMapVersion !== mapAuth) return "stale";
  if (touchedUnder(receipt, now.touchedScopeIds)) return "stale";
  if (shapeAuth !== undefined && now.shapeVersion === undefined) return "unknown";
  if (mapAuth !== undefined && now.scopeMapVersion === undefined) return "unknown";
  return "current";
}

function touchedUnder(receipt, touchedScopeIds) {
  if (!Array.isArray(touchedScopeIds) || touchedScopeIds.length === 0) return false;
  const covered = Array.isArray(receipt?.scopeIds) ? new Set(receipt.scopeIds) : null;
  if (covered === null) return true;
  return touchedScopeIds.some((id) => covered.has(id));
}

/** True when the receipt may still authorize work at the given versions. */
export function isAuthoritative(receipt, current) {
  return freshnessOf(receipt, current) === "current";
}

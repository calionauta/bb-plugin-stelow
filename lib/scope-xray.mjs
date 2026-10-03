import { scopeMapFreshness, validateScopeMap } from "./scope-map.mjs";

export function parseCurrentShapeVersion(stateText) {
  const match = typeof stateText === "string" ? stateText.match(/^shape_version:\s*(\S+)[ \t]*$/m) : null;
  return match?.[1] ?? null;
}

export function buildScopeXray(map, { currentShapeVersion } = {}) {
  const issues = validateScopeMap(map);
  if (issues.length) throw new Error(`scope X-ray cannot project: ${issues.join("; ")}`);
  if (map.status !== "approved") throw new Error("scope X-ray can only project an approved map");
  const freshness = currentShapeVersion ? scopeMapFreshness(map, { currentShapeVersion }).state : "unknown";
  const provenance = [...map.provenance];
  const stateById = new Map(map.scopes.map((scope) => [scope.id, freshness === "stale" ? "stale" : scope.status]));
  return {
    source: "server-projection",
    mutable: false,
    mapId: map.mapId,
    mapVersion: map.shapeVersion,
    freshness,
    nodes: map.scopes.map((scope) => ({
      id: scope.id,
      title: scope.title,
      capabilities: [...scope.capabilities],
      state: stateById.get(scope.id),
      provenance: [...provenance],
    })),
    edges: map.scopes.flatMap((scope) => scope.dependsOn.map((dependency) => ({
      from: dependency,
      to: scope.id,
      kind: "depends-on",
      state: freshness === "stale" ? "stale" : stateById.get(scope.id) === "blocked" || stateById.get(dependency) === "blocked" ? "blocked" : "current",
      provenance: [...provenance],
    }))),
  };
}

/** The draft map drawn as a graph, explicitly not approved.
 *
 * Same projection as the approved X-ray, gated the opposite way: it throws
 * unless the map carries draft status, and the result carries `draft: true`
 * so no renderer can mistake it for an approved map. A draft never competes
 * with an approved map — callers show it only when no approved map exists.
 */
export function buildScopeDraft(map, { currentShapeVersion } = {}) {
  const issues = validateScopeMap(map);
  if (issues.length) throw new Error(`scope draft cannot project: ${issues.join("; ")}`);
  if (map.status === "approved") throw new Error("scope draft can only project a draft map");
  const freshness = currentShapeVersion ? scopeMapFreshness(map, { currentShapeVersion }).state : "unknown";
  const provenance = [...map.provenance];
  const stateById = new Map(map.scopes.map((scope) => [scope.id, freshness === "stale" ? "stale" : scope.status]));
  return {
    source: "server-projection",
    mutable: false,
    draft: true,
    mapId: map.mapId,
    mapVersion: map.shapeVersion,
    freshness,
    nodes: map.scopes.map((scope) => ({
      id: scope.id,
      title: scope.title,
      capabilities: [...scope.capabilities],
      state: stateById.get(scope.id),
      provenance: [...provenance],
    })),
    edges: map.scopes.flatMap((scope) => scope.dependsOn.map((dependency) => ({
      from: dependency,
      to: scope.id,
      kind: "depends-on",
      state: freshness === "stale" ? "stale" : stateById.get(scope.id) === "blocked" || stateById.get(dependency) === "blocked" ? "blocked" : "current",
      provenance: [...provenance],
    }))),
  };
}

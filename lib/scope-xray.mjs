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

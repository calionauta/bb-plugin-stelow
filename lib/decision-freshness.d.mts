export declare function freshnessOf(
  receipt: { authorizesVersions?: { shape_version?: unknown; scopeMapVersion?: unknown }; scopeIds?: unknown },
  current: { shapeVersion?: unknown; scopeMapVersion?: unknown; touchedScopeIds?: unknown },
): "current" | "stale" | "unknown";
export declare function isAuthoritative(receipt: unknown, current: unknown): boolean;

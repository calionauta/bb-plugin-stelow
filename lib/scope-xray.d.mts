import type { ScopeMap } from "./scope-map.mjs";

export type ScopeXray = {
  source: "server-projection";
  mutable: false;
  mapId: string;
  mapVersion: string;
  freshness: "current" | "stale" | "unknown";
  nodes: Array<{ id: string; title: string; capabilities: string[]; state: "current" | "stale" | "blocked" | "unknown"; provenance: string[] }>;
  edges: Array<{ from: string; to: string; kind: "depends-on"; state: "current" | "stale" | "blocked" | "unknown"; provenance: string[] }>;
};

export function parseCurrentShapeVersion(stateText: string | null | undefined): string | null;
export function buildScopeXray(map: ScopeMap, context?: { currentShapeVersion?: string | null }): ScopeXray;

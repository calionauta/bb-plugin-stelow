export type ScopeMap = {
  schemaVersion: 1;
  mapId: string;
  status: "draft" | "approved";
  shapeVersion: string;
  provenance: string[];
  approval?: { receiptId: string; approvedBy: string };
  openDecisions: string[];
  scopes: Array<{
    id: string;
    title: string;
    outcome: string;
    capabilities: string[];
    inScope: string[];
    outOfScope: string[];
    dependsOn: string[];
    status: "current" | "stale" | "blocked" | "unknown";
  }>;
};

export type ScopeMapChallenge = {
  schemaVersion: 1;
  challengeId: string;
  mapId: string;
  mapShapeVersion: string;
  kind: "scope-boundary" | "dependency-change" | "product-commitment";
  affectedScopeIds: string[];
  reason: string;
  disposition: "continue" | "human-decision-required" | "shape-required" | "research-required" | "repair-brief";
  authority: "agent" | "human";
  evidence: string[];
  requestedBy: string;
};

export function validateScopeMap(map: unknown): string[];
export function validateScopeMapChallenge(challenge: unknown): string[];
export function scopeMapFreshness(map: unknown, context?: { currentShapeVersion?: string }): { state: "current" | "stale"; stale: boolean };
export function resolveScopeMapChallenge(challenge: unknown): { destination: "scope" | "shape"; staleArtifacts: string[]; requiresApproval: boolean };
export function projectScopeMapToTracking(map: ScopeMap): { mapId: string; shapeVersion: string; scopes: Array<{ id: string; name: string; status: "pending"; blockedBy: string[] }> };

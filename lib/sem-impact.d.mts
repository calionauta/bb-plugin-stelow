export interface SemEntityRef {
  id: string;
  name: string;
  type: string;
  file: string;
  lines: number[];
}

export interface SemTransitiveRef extends SemEntityRef {
  depth?: number;
}

export interface SemImpactSummary {
  entity: SemEntityRef;
  dependencies: SemEntityRef[];
  dependents: SemEntityRef[];
  transitive: SemTransitiveRef[];
  tests: SemEntityRef[];
}

export declare function summarizeSemImpact(json: unknown): SemImpactSummary | null;

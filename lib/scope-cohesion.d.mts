export interface ScopeInput {
  id: string;
  symbols: string[];
}

export interface ScopeCollision {
  a: string;
  b: string;
  shared: string[];
}

export declare function findScopeCollisions(scopes: unknown): ScopeCollision[] | null;

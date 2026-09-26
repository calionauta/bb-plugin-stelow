// Type declarations for lib/artifact-contracts.mjs
//
// The data itself lives in lib/jtbd-contracts.mjs, lib/strategy-contracts.mjs,
// and lib/explore-contracts.mjs; this module re-exports all three, so these
// interfaces describe the whole contract surface consumers see.

export interface ArtifactCheck {
  kind: "headings" | "named-headings" | "contains" | "section-items" | "field-blocks" | "table-rows" | "table-columns" | "gap-registry";
  [key: string]: unknown;
}

export interface ArtifactContract {
  slug: string;
  ref: string;
  minWords?: number;
  checks: ArtifactCheck[];
}

export interface StrategyContract {
  id: string;
  ref: string;
  minWords?: number;
  checks?: ArtifactCheck[];
  variants?: Array<{ minWords?: number; checks?: ArtifactCheck[] }>;
}

export interface ExploreContract {
  id: string;
  ref: string;
  minWords?: number;
  checks?: ArtifactCheck[];
}

export declare const JTBD_CONTRACTS: ArtifactContract[];
export declare function contractForSubstep(slug: unknown): ArtifactContract | null;

export declare const STRATEGY_CONTRACTS: StrategyContract[];
export declare function contractForStrategy(id: unknown): StrategyContract | null;

export declare const EXPLORE_CONTRACTS: ExploreContract[];
export declare function contractForExplore(stageId: unknown): ExploreContract | null;
export declare function contractForBuildArtifact(filePath: unknown, content: unknown): ExploreContract | null;

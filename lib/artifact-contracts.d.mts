// Type declarations for lib/artifact-contracts.mjs

export interface ArtifactCheck {
  kind: "min-words" | "headings" | "named-headings" | "contains" | "section-items" | "field-blocks" | "table-rows";
  [key: string]: unknown;
}

export interface ArtifactContract {
  slug: string;
  ref: string;
  minWords?: number;
  checks: ArtifactCheck[];
}

export declare const JTBD_CONTRACTS: ArtifactContract[];
export declare function contractForSubstep(slug: unknown): ArtifactContract | null;

export interface StrategyContract {
  id: string;
  ref: string;
  minWords?: number;
  checks?: ArtifactCheck[];
  variants?: Array<{ minWords?: number; checks?: ArtifactCheck[] }>;
}

export declare const STRATEGY_CONTRACTS: StrategyContract[];
export declare function contractForStrategy(id: unknown): StrategyContract | null;

export interface ExploreContract {
  id: string;
  ref: string;
  minWords?: number;
  checks?: ArtifactCheck[];
}

export declare const EXPLORE_CONTRACTS: ExploreContract[];
export declare function contractForExplore(stageId: unknown): ExploreContract | null;
export declare function contractForBuildArtifact(filePath: unknown, content: unknown): ExploreContract | null;

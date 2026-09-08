export interface ResearchStrategy {
  id: string;
  label: string;
  skill: string;
  blurb: string;
  emoji: string;
  keywords: string[];
  contract: "single" | "variant" | "composite";
  substeps?: string[];
}

export declare const RESEARCH_STRATEGIES: ResearchStrategy[];
export declare function researchStrategyById(id: string): ResearchStrategy | null;
export declare function parseStrategyList(raw: unknown): string[];
export declare function expectedSubsteps(strategyId: string): string[];
export declare function missingSubsteps(strategyId: string, presentSlugs: unknown): string[];
export declare function mergeStrategyContracts(
  localList: ResearchStrategy[],
  registry: { strategies?: Array<{ id?: unknown; skill?: unknown; contract?: unknown; substeps?: unknown }> } | null | undefined,
): ResearchStrategy[];

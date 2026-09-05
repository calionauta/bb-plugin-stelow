export interface ResearchStrategy {
  id: string;
  label: string;
  skill: string;
  blurb: string;
  emoji: string;
  keywords: string[];
}

export declare const RESEARCH_STRATEGIES: ResearchStrategy[];
export declare function researchStrategyById(id: string): ResearchStrategy | null;
export declare function parseStrategyList(raw: unknown, fallbackId: unknown): string[];

export declare const RESEARCH_STRATEGIES: Array<{ id: string; label: string; skill: string; blurb: string }>;
export declare function researchStrategyById(id: string): { id: string; label: string; skill: string; blurb: string } | null;
export declare function parseStrategyList(raw: unknown, fallbackId: unknown): string[];

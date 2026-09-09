export declare type ResearchIndexOutput = { strategy: string; round: string; output: string; path: string; notes: string };
export declare function parseResearchIndexSections(markdown: unknown): { summary: string | null; outputs: ResearchIndexOutput[] };
export declare function stripResearchOpportunities(markdown: unknown): string;
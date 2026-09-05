export declare type ResearchOpportunity = { id: string; title: string; checked: boolean; group: string | null; lineIndex: number };
export declare function parseResearchBrief(markdown: unknown): { found: boolean; opportunities: ResearchOpportunity[] };
export declare function checkBriefItems(markdown: unknown, ids: unknown): { updated: string; checked: string[] };

export declare type ResearchOpportunity = { id: string; title: string; checked: boolean; group: string | null; lineIndex: number };
export declare function parseResearchIndex(markdown: unknown): { found: boolean; opportunities: ResearchOpportunity[] };
export declare function checkIndexItems(markdown: unknown, ids: unknown): { updated: string; checked: string[] };

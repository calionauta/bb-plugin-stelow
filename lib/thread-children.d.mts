export declare const MAX_CHILDREN: number;
export declare function shapeChildThreads(list: unknown): Array<{ threadId: string; title: string | null; status: string; providerId: string | null }>;
export declare function attachChildTokenUsage(children: unknown, usageById: unknown): Array<{ threadId: string; title: string | null; status: string; providerId: string | null; tokenUsage: number | null }>;
export interface TokenBreakdown { input: number | null; output: number | null; cached: number | null; reasoning: number | null; total: number | null }
export declare function attachChildTokenBreakdown(children: unknown, breakdownById: unknown): Array<{ threadId: string; title: string | null; status: string; providerId: string | null; tokenUsage: number | null; tokenBreakdown: TokenBreakdown | null }>;

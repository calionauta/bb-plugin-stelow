export declare const MAX_CHILDREN: number;
export declare function shapeChildThreads(list: unknown): Array<{ threadId: string; title: string | null; status: string; providerId: string | null }>;
export declare function attachChildTokenUsage(children: unknown, usageById: unknown): Array<{ threadId: string; title: string | null; status: string; providerId: string | null; tokenUsage: number | null }>;

// Type declarations for lib/research-evidence.mjs

export declare const NO_WEB_PATTERNS: RegExp[];
export declare function declaresNoWebEvidence(indexMarkdown: unknown): boolean;
export declare function evidenceStatus(indexMarkdown: unknown): "hypothesis-only" | "verified";

export declare function extractFencedMermaid(markdown: unknown): string | null;

export interface SplitFencedMermaid { source: string; prose: string }
export function splitFencedMermaid(markdown: unknown): SplitFencedMermaid | null;

export interface DocumentSection { level: number; text: string; start: number; bodyStart: number; end: number }
export interface ReviewExcerpt { text: string; truncated: boolean; originalChars: number; sentChars: number; selected: "whole" | "contract" | "head" }
export const MAX_REVIEW_CHARS: number;
export function documentSections(text: unknown): DocumentSection[];
export function contractHeadings(contract: { checks?: readonly { kind?: string; names?: readonly unknown[]; startsWithAny?: readonly unknown[] }[] } | null | undefined): { names: string[]; stems: string[] };
export function selectReviewExcerpt(content: unknown, contract: unknown, options?: { maxChars?: number }): ReviewExcerpt;

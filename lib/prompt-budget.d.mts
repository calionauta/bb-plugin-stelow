export interface ClauseCost { length: number; tokens: number }
export interface PinnedSentenceDiff { missing: string[]; extra: string[] }
export interface CacheReport { label: string; total: number; prefix: number; ratio: number; divergedAt: string }
export interface RepeatedSentence { sentence: string; count: number }
export interface SharedBlock { paragraph: string; paths: string[]; chars: number }
export interface SharedAcrossPaths { shared: SharedBlock[]; duplicatedChars: number; totalChars: number; duplicationRatio: number }
export interface ComposedBudget { composedChars: number; composedDuplicatedChars: number; composedDuplicationRatio: number; blocks: SharedBlock[]; perPath: Record<string, number> }
export interface PromptBudgetReport {
  path: string;
  chars: number;
  estimatedTokens: number;
  clauseChars: number;
  clauseEntries: Record<string, ClauseCost>;
  repeatedSentences: RepeatedSentence[];
  repeatedChars: number;
}
export const CHARS_PER_TOKEN: number;
export function normalizeClause(text: unknown): string;
export function estimateTokens(text: unknown): number;
export function clauseCost(clause: unknown): ClauseCost;
export function clausesPresent(rendered: unknown, clauses: Record<string, { probe?: string; text?: string } | string>): Record<string, boolean>;
export function missingClauses(rendered: unknown, clauses: Record<string, { probe?: string; text?: string } | string>): string[];
export function ruleSentences(clause: unknown, options?: { minChars?: number }): string[];
export function pinnedSentenceDiff(rendered: unknown, pinned: readonly string[], options?: { minChars?: number }): PinnedSentenceDiff;
export function cacheablePrefix(a: string, b: string): number;
export function cacheReport(a: string, b: string, options?: { label?: string }): CacheReport;
export function positionOf(rendered: unknown, needle: unknown): number;
export function composedText(rendered: string, clauses: Record<string, { text?: string } | string>): string;
export function composedBudget(paths: Record<string, string>, clauses: Record<string, { text?: string } | string>): ComposedBudget;
export function repeatedSentences(rendered: unknown, options?: { minChars?: number }): RepeatedSentence[];
export function sharedAcrossPaths(paths: Record<string, string>): SharedAcrossPaths;
export function promptBudget(rendered: unknown, options?: { clauses?: Record<string, { text?: string } | string>; path?: string }): PromptBudgetReport;

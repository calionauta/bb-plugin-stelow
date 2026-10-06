export function tokenUsageFromEvents(events: unknown[]): number | null;
export function formatTokenUsage(total: number | null): string | null;
export function totalTokenUsage(history: unknown): number | null;
export interface TokenBreakdown { input: number | null; output: number | null; cached: number | null; reasoning: number | null; total: number | null }
export function tokenBreakdownFromEvents(events: unknown): TokenBreakdown | null;
export function sumTokenBreakdowns(list: unknown): TokenBreakdown | null;
export interface ContextUsage {
  usedTokens: number;
  modelContextWindow: number | null;
  estimated: boolean;
}
export function contextUsageFromEvents(events: unknown): ContextUsage | null;
export type UsageSource = "provider" | "context-estimate" | null;
export interface UsageReading {
  total: number | null;
  source: UsageSource;
  context: ContextUsage | null;
}
export function usageFromEvents(events: unknown): UsageReading;

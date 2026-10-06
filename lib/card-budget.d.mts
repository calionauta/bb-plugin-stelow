export type BudgetVerdict = "unlimited" | "ok" | "warn" | "ask";

export const BUDGET_VERDICTS: readonly BudgetVerdict[];

export const WARN_SHARE: number;

export interface BudgetReading {
  verdict: BudgetVerdict;
  reason: string | null;
  remaining: number | null;
  share: number | null;
}

export function budgetVerdict(input: {
  spent: number | null | undefined;
  budget: number | null | undefined;
  warnShare?: number;
}): BudgetReading;

export interface BudgetQuestion {
  question: string;
  options: Array<{ label: string; desc: string }>;
  tag: "budget";
}

export function budgetQuestion(input: {
  spent: number;
  budget: number;
  cardName: string;
}): BudgetQuestion;

export function budgetTrailLine(
  verdict: BudgetVerdict,
  input: { spent: number; budget: number },
): string | null;

export declare const CLAUSE_CHAR_CEILINGS: Readonly<Record<string, number>>;
export declare const CEILING_SLACK: number;
export declare function clauseBudgetFindings(texts: Record<string, string | undefined>): {
  overBudget: string[];
  unbudgeted: string[];
  loose: string[];
};
export declare function clausesWithoutCeiling(rendered: string[]): string[];

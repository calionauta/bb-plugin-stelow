// Type declarations for lib/skills-tables.mjs

export interface TableDelimiterProblem {
  /** 1-based line number of the offending delimiter row. */
  line: number;
  /** Raw delimiter cells as written. */
  cells: string[];
}

export function findInvalidTableDelimiters(text: string): TableDelimiterProblem[];

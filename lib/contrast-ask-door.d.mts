import type { ContrastAskDeclaration } from "./contrast-artifact.mjs";

/** The slice of the plugin database this door touches. */
type Db = {
  prepare(query: string): {
    all(...values: unknown[]): any[];
    get(...values: unknown[]): any;
    run(...values: unknown[]): unknown;
  };
  transaction(fn: (...args: unknown[]) => unknown): (...args: unknown[]) => unknown;
};

export declare function recordMatrixQuestions(
  db: Db,
  input: {
    cardId: string;
    stateDir?: string | null;
    askedAt: number;
    makeId: (declaration: ContrastAskDeclaration, index: number) => string;
    read: (path: string) => string | null | Promise<string | null>;
  },
): Promise<{ declarations: number; recorded: number } | null>;

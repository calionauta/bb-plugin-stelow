type Db = {
  exec(query: string): void;
  prepare(query: string): {
    run(...values: unknown[]): unknown;
    get(...values: unknown[]): any;
    all(...values: unknown[]): any[];
  };
  transaction(fn: (...args: any[]) => any): (...args: any[]) => any;
};
export declare const TERMINAL_SCOPE_OUTCOMES: string[];
export declare function isScopeTerminal(outcome: unknown): boolean;
export declare function finishScope(db: Db, args: {
  batchId?: string | null;
  scopeId: string;
  cardId?: string | null;
  outcome?: string;
  nowMs?: number;
}): {
  scopeId: string;
  batchId: string | null;
  outcome: string;
  terminal: boolean;
  released: Array<{ workspacePath: string; file: string; fencing: number }>;
  notified: Array<{ cardId: string; scope: string | null; visibility: string }>;
};

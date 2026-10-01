export type LedgerRepair = {
  index: number;
  recordedHash: string;
  shippedHash: string;
};

export declare const REWRITTEN_LEDGER_REPAIR: {
  index: number;
  recordedHash: string;
  shippedHash: string;
};

export declare function statementHash(statement: string): string;

export declare function healRewrittenLedgerRow(
  db: {
    prepare(sql: string): { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] };
  },
  statements: readonly string[],
  onDecline?: (why: string) => void,
): LedgerRepair | null;

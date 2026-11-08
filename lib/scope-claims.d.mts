type RunResult = { changes: number };
type Db = {
  exec(query: string): void;
  prepare(query: string): {
    run(...values: unknown[]): RunResult;
    get(...values: unknown[]): any;
    all(...values: unknown[]): any[];
  };
  transaction(fn: (...args: any[]) => any): (...args: any[]) => any;
};
export declare function scopeClaimTag(batchId: unknown, scopeId: unknown): string | null;
export declare function acquireScopeClaims(db: Db, args?: {
  cardId?: string;
  batchId?: string | null;
  scopeId?: string;
  files?: unknown[];
  effectiveCheckout?: string | null;
  workspacePath?: string | null;
  checkoutPath?: string | null;
  worktreePath?: string | null;
  sourcePath?: string | null;
  ttlMs?: number;
  nowMs?: number;
}): {
  ok: boolean;
  code: "ACQUIRED" | "CONFLICT" | "CLAIM_REQUIRED";
  acquired: Array<{ file: string; fencing: number; holder: string }>;
  stolen: Array<{ file: string; previousHolder: string; previousScope: string | null; fencing: number }>;
  conflicts: Array<{ file: string; heldBy: string; heldScope: string | null; holder: string; expiresAt: number }>;
  park: Array<{ file: string; stderr: string; dedupeKey: string; visibility: string }>;
};

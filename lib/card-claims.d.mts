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
export declare const CLAIM_TTL_MS: number;
export declare function ensureCardClaimsTables(db: Db): void;
export declare function normalizeClaimPath(raw: unknown): string | null;
export declare function acquireWorkspaceClaims(db: Db, args: {
  cardId: string;
  workspacePath: string;
  files: unknown[];
  scope?: string | null;
  ttlMs?: number;
  nowMs?: number;
}): {
  acquired: Array<{ file: string; fencing: number }>;
  renewed: Array<{ file: string }>;
  stolen: Array<{ file: string; previousHolder: string; fencing: number }>;
  conflicts: Array<{ file: string; heldBy: string; heldScope: string | null; expiresAt: number }>;
};
export declare function checkWorkspaceClaims(db: Db, args: {
  cardId: string | null;
  workspacePath: string;
  files: unknown[];
  ttlMs?: number;
  nowMs?: number;
}): { free: string[]; conflicts: Array<{ file: string; heldBy: string; heldScope: string | null; expiresAt: number }> };
export declare function releaseWorkspaceClaims(db: Db, args: {
  cardId: string;
  workspacePath?: string | null;
  files?: unknown[] | null;
  nowMs?: number;
}): Array<{ workspacePath: string; file: string }>;
export declare function releaseAllCardClaims(db: Db, cardId: string): Array<{ workspacePath: string; file: string }>;
export declare function addClaimWaiters(db: Db, args: {
  cardId: string;
  workspacePath: string;
  files: unknown[];
  scope?: string | null;
  nowMs?: number;
}): number;
export declare function clearClaimWaiters(db: Db, args: {
  cardId: string;
  workspacePath?: string | null;
  files?: unknown[] | null;
}): number;
export declare function waitersForFiles(db: Db, args: {
  workspacePath: string;
  files: unknown[];
}): Array<{ card_id: string; scope: string | null }>;
export declare function sweepExpiredClaims(db: Db, nowMs?: number): Array<{ workspacePath: string; file: string; previousHolder: string }>;
export declare function liveClaimsForWorkspace(db: Db, args: {
  workspacePath: string;
  nowMs?: number;
}): Array<{ file_path: string; card_id: string; scope: string | null; expires_at: number; fencing: number }>;
export declare function matchScopeClaims(rows: unknown, args?: {
  ownerId?: string;
  scopeId?: string;
  files?: string[];
  nowMs?: number;
}): Array<{ file_path: string; card_id: string; scope: string | null; expires_at: number }>;
export declare function lapsedScopeClaims(db: Db, args: {
  cardId: string;
  workspacePath: string;
  scope?: string | null;
  files?: string[];
  nowMs?: number;
}): boolean;
export declare function scopeClaimTag(batchId: unknown, scopeId: unknown): string | null;
export declare function acquireScopeClaims(db: Db, args: {
  cardId: string;
  batchId?: string | null;
  scopeId: string;
  files: unknown[];
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
  conflicts: Array<{ file: string; heldBy: string; heldScope: string | null; holder: string; expiresAt: number }>;
  park: Array<{ file: string; stderr: string; dedupeKey: string; visibility: string }>;
};

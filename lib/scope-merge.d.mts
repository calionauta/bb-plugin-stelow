export interface ScopeOutput {
  scopeId?: string;
  files?: Record<string, string>;
  fencingToken?: number | null;
  status?: string;
  ok?: boolean;
}
export interface ScopeMergeOptions {
  cancelled?: boolean;
  batchCancelled?: boolean;
  holdLock?: boolean;
}
export interface ScopeMergeResult {
  ok: boolean;
  code: "MERGED" | "MERGE_CONFLICT" | "FENCING_STALE" | "SCOPE_FAILED" | "BATCH_CANCELLED" | "MERGE_IN_PROGRESS";
  conflicts: Array<{ file?: string; scopes?: string[]; scope?: string; status?: string; expected?: unknown; actual?: unknown }>;
  merged: Record<string, string> | null;
  batchId?: string;
  parentUnchanged: boolean;
  reason?: string;
}
export declare const FAILED_SCOPE_STATUSES: Set<string>;
export declare const SUCCESS_SCOPE_STATUSES: Set<string>;
export declare function acquireScopeMergeLock(batchId: string): { batchId: string; release(): void } | null;
export declare function releaseScopeMergeLock(batchId: string): void;
export declare function isScopeMergeLocked(batchId: string): boolean;
export declare function withScopeMergeLock(batchId: string, fn: () => ScopeMergeResult): ScopeMergeResult;
export interface ParentVerification {
  batchId?: string;
  mergeCommit?: string;
  verifiedAt?: number;
  mergeAt?: number;
}
export declare function mergeScopesAtomically(
  batchId: string,
  scopeOutputs: readonly ScopeOutput[] | null | undefined,
  parentFiles: Record<string, string> | null | undefined,
  expectedTokens?: Record<string, number>,
  options?: ScopeMergeOptions,
): ScopeMergeResult;
export declare function verifyParentMerge(
  batchId: string,
  verification: ParentVerification | null | undefined,
  mergeCommit?: string,
): { ok: boolean; code: "VERIFIED" | "VERIFICATION_MISSING" | "VERIFICATION_STALE"; reason?: string };

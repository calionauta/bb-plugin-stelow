import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  acquireScopeClaims,
  ensureCardClaimsTables,
} from "../lib/card-claims.mjs";
import { checkScopeWrite } from "../lib/execution-route.mjs";
import {
  NATIVE_SCOPE_BATCH_PILOT_ALLOWED,
  SCOPE_BATCH_PILOT_MAX_CONCURRENCY,
  SCOPE_BATCH_PILOT_TIMEOUT_MS,
  collectScopeBatchPilotReceipts,
  evaluateScopeBatchPilot,
} from "../lib/execution-route.mjs";
import { cancelBatch } from "../lib/scope-batch-cancel.mjs";
import { finishScope } from "../lib/scope-batch-cleanup.mjs";
import {
  acquireScopeMergeLock,
  mergeScopesAtomically,
  releaseScopeMergeLock,
  verifyParentMerge,
} from "../lib/scope-merge.mjs";
import {
  computeScopePartitions,
  expandScopeFiles,
} from "../lib/scope-partition.mjs";
import { claimScopeRetry } from "../lib/scope-retry.mjs";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

/**
 * Minimal database surface the scope-batch coordinator needs. The host
 * database satisfies it structurally; depending on the narrow interface
 * keeps every caller (server.ts, scopes.ts, tests) assignable without
 * importing the driver type.
 */
export interface ScopeBatchDb {
  prepare(query: string): {
    run(...values: unknown[]): { changes: number };
    get(...values: unknown[]): any;
    all(...values: unknown[]): any[];
  };
  exec(query: string): void;
  transaction(fn: (...args: any[]) => any): (...args: any[]) => any;
}

export interface BatchScope {
  scopeId?: string;
  id?: string;
  targetFiles?: unknown;
  files?: unknown;
  writes?: unknown;
  reads?: unknown;
  imports?: unknown;
  transitiveFiles?: unknown;
  transitive?: unknown;
  status?: string;
}

export interface BatchScopeClaim {
  scopeId: string;
  files: string[];
}

/**
 * Admission path: a scope-batch admits only when the transitive file sets
 * of all scopes are pairwise disjoint. Overlap refuses the whole batch
 * before any spawn — no partial dispatch. Coordinator-sequential only:
 * this gate never fans work out.
 */
export function admitScopeBatchRun(scopes: BatchScope[]) {
  return computeScopePartitions(scopes);
}

export { NATIVE_SCOPE_BATCH_PILOT_ALLOWED, SCOPE_BATCH_PILOT_MAX_CONCURRENCY, SCOPE_BATCH_PILOT_TIMEOUT_MS };

export interface ScopeBatchPilotScope {
  scopeId: string;
  files: string[];
}

export interface ScopeBatchPilotReceipt {
  scopeId: string;
  claimVerified: boolean;
  filesTouched: string[];
  artifacts: string[] | Record<string, string>;
}

/**
 * Pilot route evaluation for scope-batch: native fan-out ONLY for
 * independent disjoint scopes with satisfied claims, proven
 * file-claims + isolated-workspace capabilities, and bounded
 * concurrency. Every gate failure falls back to coordinator-sequential
 * with no partial fan-out. The coordinator spawn loop below stays
 * sequential (NO_FANOUT); this function only decides the route.
 */
export function evaluateScopeBatchPilotRun(args: {
  scopes: BatchScope[];
  satisfiedScopeIds?: string[];
  nativeCapabilities?: Record<string, boolean>;
  nativePilotAllowed?: boolean;
  maxConcurrency?: number;
}) {
  const admission = admitScopeBatchRun(args.scopes);
  const partitions = admission.partitions as Record<string, string[]>;
  const satisfied = new Set(args.satisfiedScopeIds ?? []);
  const decision = evaluateScopeBatchPilot({
    scopes: args.scopes,
    satisfiedScopeIds: [...satisfied],
    nativeCapabilities: args.nativeCapabilities ?? {},
    nativePilotAllowed: args.nativePilotAllowed ?? NATIVE_SCOPE_BATCH_PILOT_ALLOWED,
    maxConcurrency: args.maxConcurrency ?? SCOPE_BATCH_PILOT_MAX_CONCURRENCY,
  });
  return { admission, partitions, decision };
}

/**
 * Pilot receipt collection: each child must return claim verification,
 * files touched, and an artifact manifest; receipts land per scope and
 * stay disjoint. Any failure refuses the merge so the coordinator can
 * retry sequentially or escalate to inbox.
 */
export function collectScopeBatchPilotReceiptsRun(
  receipts: ScopeBatchPilotReceipt[],
  scopes: BatchScope[],
) {
  const admission = admitScopeBatchRun(scopes);
  if (!admission.admitted) {
    return {
      ok: false as const,
      code: "PARTITION_OVERLAP" as const,
      overlaps: admission.overlaps,
    };
  }
  return collectScopeBatchPilotReceipts(
    receipts,
    admission.partitions as Record<string, string[]>,
  );
}

/**
 * Spawn path: claim every scope's files sequentially (coordinator order).
 * The first conflict refuses the whole batch and rolls back the scopes
 * already claimed, so a refused batch leaves no partial holders behind.
 * NO_FANOUT: this loop is sequential by contract — no concurrent
 * dispatch or batched promise fan-out; coordinator-sequential only until
 * file-claim and parent-merge safety is proven for fan-out.
 */
export function claimScopeBatchRun(
  db: ScopeBatchDb,
  args: { cardId: string; batchId: string; workspacePath: string; scopes: BatchScopeClaim[] },
): { ok: true; acquired: Array<{ scopeId: string; files: string[] }> }
  | { ok: false; code: "SCOPE_BATCH_CONFLICT"; conflicts: unknown[]; rolledBack: string[] } {
  const acquired: Array<{ scopeId: string; files: string[] }> = [];
  for (const scope of args.scopes) {
    const result = acquireScopeClaims(db, {
      cardId: args.cardId,
      batchId: args.batchId,
      scopeId: scope.scopeId,
      files: scope.files,
      effectiveCheckout: args.workspacePath,
    });
    if (!result.ok) {
      const rolledBack: string[] = [];
      for (const done of acquired) {
        try {
          finishScope(db, { batchId: args.batchId, scopeId: done.scopeId, cardId: args.cardId, outcome: "cancelled" });
          rolledBack.push(done.scopeId);
        } catch {
          // Rollback is best-effort; the refusal below still names the conflict.
        }
      }
      return { ok: false, code: "SCOPE_BATCH_CONFLICT", conflicts: result.conflicts, rolledBack };
    }
    acquired.push({ scopeId: scope.scopeId, files: scope.files });
  }
  return { ok: true, acquired };
}

/**
 * Pre-write path: a scope may mutate a file only when it holds a live
 * batch claim for (checkout, file). Throws CLAIM_REQUIRED before any
 * workspace write or state.md mutation lands.
 */
export function guardScopeBatchWrite(
  input: { scopeId: string; file: string; checkout: string },
  heldClaims: Array<{ scopeId?: string; scope?: string; file: string; checkout?: string; workspacePath?: string }>,
): true {
  return checkScopeWrite(input, heldClaims);
}

/**
 * Cleanup path: finishing a scope releases exactly its batch claims and
 * notifies its waiters once. Terminal outcomes never leak a claim.
 */
export function finishScopeBatchRun(
  db: ScopeBatchDb,
  args: { batchId: string; scopeId: string; cardId?: string | null; outcome?: string },
) {
  return finishScope(db, { batchId: args.batchId, scopeId: args.scopeId, cardId: args.cardId, outcome: args.outcome });
}

/**
 * Retry path: (batchId, scopeId, retryKey) executes its effect at most
 * once. Replays return the recorded outcome without re-executing.
 */
export function retryScopeBatchRun<T>(
  db: ScopeBatchDb,
  args: {
    batchId: string;
    scopeId: string;
    retryKey: string;
    run: () => T;
    revalidate?: (() => boolean | { ok: boolean; reason?: string }) | null;
  },
): { duplicate: boolean; outcome: T; failed?: boolean; code?: string } {
  return claimScopeRetry(db, args);
}

/**
 * Merge path: single owner per batch (lock-serialized), failed children
 * filtered, cancelled batches refused. Never interleaves concurrent
 * merges; the loser gets MERGE_IN_PROGRESS instead of a torn parent.
 */
export function mergeScopeBatchRun(
  batchId: string,
  scopeOutputs: Array<{ scopeId?: string; files?: Record<string, string>; fencingToken?: number | null; status?: string; ok?: boolean }>,
  parentFiles: Record<string, string>,
  expectedTokens: Record<string, number> = {},
  options: { cancelled?: boolean; batchCancelled?: boolean } = {},
) {
  const lock = acquireScopeMergeLock(batchId);
  if (!lock) {
    return {
      ok: false as const,
      code: "MERGE_IN_PROGRESS" as const,
      conflicts: [],
      merged: null,
      parentUnchanged: true,
      reason: "another merge owns this batch; concurrent merges never interleave.",
    };
  }
  try {
    return mergeScopesAtomically(batchId, scopeOutputs, parentFiles, expectedTokens, { ...options, holdLock: true });
  } finally {
    releaseScopeMergeLock(batchId);
  }
}

/**
 * Verify path: batch success requires a fresh parent-verification.json
 * naming the current batchId and mergeCommit. Absent or stale
 * verification refuses success.
 */
export function verifyScopeBatchRun(
  batchId: string,
  verification: { batchId?: string; mergeCommit?: string; verifiedAt?: number; mergeAt?: number } | null | undefined,
  mergeCommit?: string,
) {
  return verifyParentMerge(batchId, verification, mergeCommit);
}

/**
 * Cancel path: whole-batch cancel for the 1-card x N-scopes topology.
 * Aborts the card's in-flight run, releases every claim the card holds,
 * clears its parked waiters, and returns the notify list for waiters.
 */
export function cancelScopeBatchRun(
  db: ScopeBatchDb,
  args: {
    batchId: string;
    cardId: string;
    scopes?: Array<string | { scopeId?: string; id?: string; cardId?: string }>;
    reason?: string;
  },
) {
  return cancelBatch(db, args);
}

/** Batch tags a card currently holds (`batchId::scopeId` claim scopes). */
export function batchIdsForCard(db: ScopeBatchDb, cardId: string): string[] {
  try {
    ensureCardClaimsTables(db);
  } catch {
    return [];
  }
  let rows: Array<{ scope: string | null }>;
  try {
    rows = db.prepare("SELECT DISTINCT scope FROM card_claims WHERE card_id = ?").all(cardId) as Array<{ scope: string | null }>;
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const row of rows) {
    const scope = row?.scope;
    if (typeof scope !== "string") continue;
    const split = scope.indexOf("::");
    if (split <= 0) continue;
    const batchId = scope.slice(0, split);
    if (batchId && !out.includes(batchId)) out.push(batchId);
  }
  return out;
}

/** True when the card holds any batch-namespaced claim: batch coordination is active. */
export function isBatchCoordinated(db: ScopeBatchDb, cardId: string): boolean {
  return batchIdsForCard(db, cardId).length > 0;
}

export function batchScopeFiles(scope: BatchScope): string[] {
  return expandScopeFiles(scope);
}

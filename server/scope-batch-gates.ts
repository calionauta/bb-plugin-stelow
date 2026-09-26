/**
 * The two scope-batch gates the `bb stelow scope` CLI path reads.
 *
 * A card running a batch is a card with N scopes in flight, so the single-scope
 * command can no longer trust "this scope is mine" to mean "this scope is
 * free". `scope start` admits the scope against its in-progress siblings and
 * claims its files before the helper transition runs; `scope done` proves the
 * scope still holds live claims on its target files and then releases exactly
 * its own. Both are dormant unless the card holds a batch-namespaced claim, so
 * a legacy single-scope card passes through untouched.
 *
 * These are the gates, not the coordinator: the batch lifecycle (claim, finish,
 * retry, merge, cancel) lives in `scope-batch.ts`, and this module only decides
 * whether one CLI call may proceed.
 */
import {
  admitScopeBatchRun,
  batchIdsForCard,
  batchScopeFiles,
  claimScopeBatchRun,
  finishScopeBatchRun,
  guardScopeBatchWrite,
  type BatchScope,
  type ScopeBatchDb,
} from "./scope-batch.js";

function scopeIdOf(scope: BatchScope): string | null {
  const id = scope?.scopeId ?? scope?.id;
  return typeof id === "string" && id ? id : null;
}

/**
 * Admission + claim, before the helper can move anything. A refused batch
 * never reaches the transition, so no partial dispatch can happen.
 */
export function scopeStartGate(
  db: ScopeBatchDb,
  args: { cardId: string; scopeId: string; workspacePath: string; scopes: BatchScope[] },
): { ok: true; coordinated: boolean }
  | { ok: false; code: string; reason: string; conflicts?: unknown } {
  const batches = batchIdsForCard(db, args.cardId);
  if (batches.length === 0) return { ok: true, coordinated: false };
  const batchId = batches[0]!;
  const starting = args.scopes.find((scope) => scopeIdOf(scope) === args.scopeId);
  const siblings = args.scopes.filter((scope) => {
    const id = scopeIdOf(scope);
    return id && id !== args.scopeId && scope?.status === "in-progress";
  });
  const admission = admitScopeBatchRun(starting ? [...siblings, starting] : siblings);
  if (!admission.admitted) {
    return {
      ok: false,
      code: "PARTITION_OVERLAP",
      reason: `scope ${args.scopeId} overlaps an in-progress sibling; the batch refuses before any spawn.`,
      conflicts: admission.overlaps,
    };
  }
  const files = starting ? batchScopeFiles(starting) : [];
  if (files.length === 0) return { ok: true, coordinated: true };
  const claimed = claimScopeBatchRun(db, {
    cardId: args.cardId,
    batchId,
    workspacePath: args.workspacePath,
    scopes: [{ scopeId: args.scopeId, files }],
  });
  if (!claimed.ok) {
    return {
      ok: false,
      code: "SCOPE_BATCH_CONFLICT",
      reason: `scope ${args.scopeId} cannot claim its files; park it and work an independent scope.`,
      conflicts: claimed.conflicts,
    };
  }
  return { ok: true, coordinated: true };
}

/**
 * Pre-write proof + release. The scope must still hold live batch claims
 * covering its target files, and its own claims release exactly once with
 * waiter notify; the other scopes' claims are never touched.
 */
export function scopeDoneGate(
  db: ScopeBatchDb,
  args: { cardId: string; scopeId: string; workspacePath: string; targetFiles?: string[] },
): { ok: true; coordinated: boolean; released?: number }
  | { ok: false; code: string; reason: string } {
  const batches = batchIdsForCard(db, args.cardId);
  if (batches.length === 0) return { ok: true, coordinated: false };
  const batchId = batches[0]!;
  const tag = `${batchId}::${args.scopeId}`;
  let live: Array<{ file_path: string }> = [];
  try {
    live = db.prepare(
      "SELECT file_path FROM card_claims WHERE card_id = ? AND scope = ?",
    ).all(args.cardId, tag) as Array<{ file_path: string }>;
  } catch {
    return { ok: true, coordinated: true, released: 0 };
  }
  const held = live.map((row) => ({ scopeId: tag, file: row.file_path, checkout: args.workspacePath }));
  for (const file of args.targetFiles ?? []) {
    try {
      guardScopeBatchWrite({ scopeId: tag, file, checkout: args.workspacePath }, held);
    } catch {
      return {
        ok: false,
        code: "CLAIM_REQUIRED",
        reason: `scope ${args.scopeId} no longer holds a live claim on ${file}; re-acquire before completing.`,
      };
    }
  }
  const done = finishScopeBatchRun(db, { batchId, scopeId: args.scopeId, cardId: args.cardId, outcome: "succeeded" });
  return { ok: true, coordinated: true, released: done.released.length };
}

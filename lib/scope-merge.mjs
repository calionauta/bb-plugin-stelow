/**
 * Parent merge: single owner, atomic across scope outputs, abort on
 * conflict, fencing-token validation at merge time. Plus the
 * post-merge verification gate: batch success requires a fresh
 * parent-verification.json naming the current batchId and mergeCommit.
 *
 * Safety contract (coordinator-sequential):
 * - Failed children are filtered before the merge: an output whose
 *   status is failed/cancelled/blocked is never applied. A batch with
 *   any non-successful child refuses with SCOPE_FAILED naming the child
 *   scopes — failed output must never silently land in the parent.
 * - A cancelled batch refuses with BATCH_CANCELLED before touching the
 *   parent. Pass `{ cancelled: true }` (or a batch-state row) when the
 *   batch was cancelled or superseded.
 * - One merge per batch at a time: acquireScopeMergeLock serializes
 *   concurrent merge attempts. The second holder gets null (fail-soft)
 *   and the merge path refuses with MERGE_IN_PROGRESS. Always release
 *   in a finally.
 */

export const FAILED_SCOPE_STATUSES = new Set(["failed", "cancelled", "blocked", "error"]);
export const SUCCESS_SCOPE_STATUSES = new Set(["succeeded", "completed", "success", "ok"]);

const mergeLocks = new Set();

export function acquireScopeMergeLock(batchId) {
  if (!batchId) throw new Error("acquireScopeMergeLock requires batchId");
  if (mergeLocks.has(batchId)) return null;
  mergeLocks.add(batchId);
  return { batchId, release: () => releaseScopeMergeLock(batchId) };
}

export function releaseScopeMergeLock(batchId) {
  mergeLocks.delete(batchId);
}

export function isScopeMergeLocked(batchId) {
  return mergeLocks.has(batchId);
}

export function withScopeMergeLock(batchId, fn) {
  const lock = acquireScopeMergeLock(batchId);
  if (!lock) return { ok: false, code: "MERGE_IN_PROGRESS", conflicts: [], merged: null, parentUnchanged: true };
  try {
    return fn();
  } finally {
    lock.release();
  }
}

function childStatus(output) {
  const status = output?.status;
  return typeof status === "string" ? status : null;
}

function isFailedChild(output) {
  if (output?.ok === false) return true;
  const status = childStatus(output);
  if (status == null) return false;
  if (FAILED_SCOPE_STATUSES.has(status)) return true;
  return !SUCCESS_SCOPE_STATUSES.has(status);
}

export function mergeScopesAtomically(batchId, scopeOutputs, parentFiles, expectedTokens = {}, options = {}) {
  const outputs = Array.isArray(scopeOutputs) ? scopeOutputs : [];
  const parent = parentFiles && typeof parentFiles === "object" ? parentFiles : {};
  const opts = options && typeof options === "object" ? options : {};
  if (opts.cancelled === true || opts.batchCancelled === true) {
    return {
      ok: false,
      code: "BATCH_CANCELLED",
      conflicts: [],
      merged: null,
      parentUnchanged: true,
      reason: "the batch was cancelled; its outputs are never merged.",
    };
  }
  if (batchId && isScopeMergeLocked(batchId) && opts.holdLock !== true) {
    return {
      ok: false,
      code: "MERGE_IN_PROGRESS",
      conflicts: [],
      merged: null,
      parentUnchanged: true,
      reason: "another merge owns this batch; concurrent merges never interleave.",
    };
  }
  const failed = outputs
    .filter((output) => isFailedChild(output))
    .map((output) => ({ scope: output?.scopeId ?? "?", status: childStatus(output) ?? "failed" }));
  if (failed.length > 0) {
    return {
      ok: false,
      code: "SCOPE_FAILED",
      conflicts: failed,
      merged: null,
      parentUnchanged: true,
      reason: "failed children are filtered before the merge; their output is never applied.",
    };
  }
  const seen = new Map();
  const conflicts = [];
  for (const output of outputs) {
    const files = output?.files && typeof output.files === "object" ? output.files : {};
    for (const path of Object.keys(files)) {
      if (seen.has(path)) {
        conflicts.push({ file: path, scopes: [seen.get(path), output?.scopeId ?? "?"] });
      } else {
        seen.set(path, output?.scopeId ?? "?");
      }
    }
  }
  if (conflicts.length > 0) {
    return { ok: false, code: "MERGE_CONFLICT", conflicts, merged: null, parentUnchanged: true };
  }
  const stale = [];
  for (const output of outputs) {
    const scopeId = output?.scopeId;
    if (scopeId && Object.hasOwn(expectedTokens, scopeId)) {
      if (output?.fencingToken !== expectedTokens[scopeId]) {
        stale.push({ scope: scopeId, expected: expectedTokens[scopeId], actual: output?.fencingToken ?? null });
      }
    }
  }
  if (stale.length > 0) {
    return { ok: false, code: "FENCING_STALE", conflicts: stale, merged: null, parentUnchanged: true };
  }
  const merged = { ...parent };
  for (const output of outputs) {
    const files = output?.files && typeof output.files === "object" ? output.files : {};
    for (const [path, content] of Object.entries(files)) merged[path] = content;
  }
  return { ok: true, code: "MERGED", conflicts: [], merged, batchId, parentUnchanged: false };
}

export function verifyParentMerge(batchId, verification, mergeCommit) {
  if (!verification || typeof verification !== "object") {
    return { ok: false, code: "VERIFICATION_MISSING", reason: "parent-verification.json is absent; success is refused." };
  }
  if (verification.batchId !== batchId) {
    return { ok: false, code: "VERIFICATION_STALE", reason: "verification names a different batch; success is refused." };
  }
  if (mergeCommit && verification.mergeCommit !== mergeCommit) {
    return { ok: false, code: "VERIFICATION_STALE", reason: "verification predates the current merge commit; success is refused." };
  }
  const verifiedAt = Number(verification.verifiedAt ?? NaN);
  const mergeAt = Number(verification.mergeAt ?? 0);
  if (!Number.isFinite(verifiedAt) || verifiedAt < mergeAt) {
    return { ok: false, code: "VERIFICATION_STALE", reason: "verification timestamp is not newer than the merge; success is refused." };
  }
  return { ok: true, code: "VERIFIED" };
}

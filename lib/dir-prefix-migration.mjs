import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { workflowEntryForOwner, workflowStateRelativeDir } from "./workflow-state-identity.mjs";

// One-pass pw- → sw- migration (v0.6.0 standardization). Stored state identity
// moved from the `pw-` (per-workflow) prefix to `sw-` (stelow workflow) in
// both generators — the owner-derived hash in workflow-state-identity and the
// random hash in upstream scripts/stelow. Directories already on disk keep
// working until this runs: resolution always goes through the stored
// `dirHash`, never by pattern, so the rename below is the only move needed.
//
// The planner is pure (unit-tested); the runner applies it with real I/O and
// is idempotent — a second boot finds no `pw-` hashes and moves nothing.

function text(value) {
  return typeof value === "string" ? value : "";
}

/** `pw-abc` → `sw-abc`; anything else (already migrated, empty) unchanged. */
export function swDirHash(dirHash) {
  const hash = text(dirHash);
  return hash.startsWith("pw-") ? `sw-${hash.slice(3)}` : hash;
}

export function needsPrefixMigration(dirHash) {
  return text(dirHash).startsWith("pw-");
}

/**
 * Legacy fallback: entries seeded before the immutable-owner scheme carry
 * no `workflowId` (name/cwd keying, nested stage object). Match those by
 * their stored hash alone — the hash was unique per seed, so a dirHash
 * match is still an identity match. Owner-keyed entries never reach this
 * (the owner lookup runs first), so live cards keep the strict path.
 */
export function legacyEntryForHash(workflows, dirHash) {
  const hash = text(dirHash);
  if (!hash) return null;
  const list = Array.isArray(workflows) ? workflows : [];
  return list.find((raw) => {
    const entry = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return text(entry.dirHash) === hash && !text(entry.workflowId);
  }) ?? null;
}

/**
 * Resolve the on-disk relatives for one stored entry. Returns null when the
 * entry carries no pw- hash (nothing to do) or no resolvable state dir.
 */
export function planDirRename(entry) {
  const raw = entry !== null && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
  const fromHash = text(raw.dirHash);
  if (!needsPrefixMigration(fromHash)) return null;
  const toHash = swDirHash(fromHash);
  const fromStateRel = workflowStateRelativeDir(raw);
  if (!fromStateRel) return null;
  // The date segment is pinned by `created`: swap only the trailing hash.
  const toStateRel = fromStateRel.endsWith(`/${fromHash}`) ? `${fromStateRel.slice(0, -fromHash.length)}${toHash}` : null;
  if (!toStateRel) return null;
  return {
    workflowId: text(raw.workflowId),
    fromHash,
    toHash,
    fromStateRel,
    toStateRel,
    fromApprovalsRel: `.stelow/approvals/${fromHash}`,
    toApprovalsRel: `.stelow/approvals/${toHash}`,
  };
}

/**
 * Apply one plan under a workspace root. Returns what moved. Never throws
 * for missing sources (a hash with no directory is metadata-only); refuses
 * to overwrite an existing `sw-` target instead of merging.
 */
export function applyDirRename(rootPath, plan) {
  const moved = [];
  const move = (fromRel, toRel) => {
    const from = join(rootPath, fromRel);
    const to = join(rootPath, toRel);
    if (!existsSync(from)) return "missing";
    if (existsSync(to)) return "collision";
    renameSync(from, to);
    moved.push({ from: fromRel, to: toRel });
    return "moved";
  };
  return {
    state: move(plan.fromStateRel, plan.toStateRel),
    approvals: move(plan.fromApprovalsRel, plan.toApprovalsRel),
    moved,
  };
}

/** Rewrite the stored hash in a parsed stelow.json workflows array. */
export function migrateTrackingHashes(workflows, renames) {
  const byFrom = new Map(renames.map((entry) => [entry.fromHash, entry.toHash]));
  let changed = 0;
  const next = (Array.isArray(workflows) ? workflows : []).map((raw) => {
    const entry = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : raw;
    const hash = entry !== null && typeof entry === "object" && !Array.isArray(entry) ? text(entry.dirHash) : "";
    if (entry !== null && typeof entry === "object" && !Array.isArray(entry) && byFrom.has(hash)) {
      entry.dirHash = byFrom.get(hash);
      changed += 1;
    }
    return entry;
  });
  return { workflows: next, changed };
}

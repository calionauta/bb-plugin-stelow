/**
 * Scope claims: one holder per (workspace, file) among the scopes of a batch.
 *
 * Upstream scope locks live inside each card's own state dir, so two scopes of
 * one card — and two cards on one checkout — never see each other's
 * reservations. `card-claims.mjs` owns the table and the workspace-card flow;
 * this is the scope-shaped door into it: a holder tag of `batchId::scopeId`,
 * all-or-nothing acquisition across one scope's files, and a parked waiter when
 * a sibling scope or a foreign card already holds one of them.
 *
 * Semantics, which are the registry's (Chubby-style advisory lease) read
 * through a narrower key:
 * - The holder is (card, scope), never the bare card, so sibling scopes of one
 *   card contend with each other like any other two strangers.
 * - A live row held by the same (card, scope) is a re-acquire, not a conflict:
 *   the upsert extends it, which is how a worker heartbeats by asking again.
 * - A lapsed row belonging to someone else is taken over and REPORTED: the
 *   previous holder and its scope come back in `stolen[]`. It used to be
 *   overwritten and returned as an ordinary acquisition, so nothing downstream
 *   could tell a takeover from a clean claim and the card that lost the file
 *   heard about it only by failing later.
 */

import {
  CLAIM_TTL_MS,
  addClaimWaiters,
  nextFencing,
  uniqueFiles,
} from "./card-claims.mjs";

/**
 * Scope-scoped claim tag: batchId namespaces sibling scopes of one card so
 * the holder is always (card, scope), never the bare card.
 */
export function scopeClaimTag(batchId, scopeId) {
  if (batchId && scopeId) return `${batchId}::${scopeId}`;
  return scopeId ?? batchId ?? null;
}

/**
 * The checkout a scope is claiming in, first name wins.
 *
 * The five names are historical (each caller was written against a different
 * layer of the workspace story); they are resolved in one place so a sixth
 * spelling cannot appear at a call site and be silently ignored. Returns null
 * when none of them names anything — `acquireScopeClaims` then refuses with
 * CLAIM_REQUIRED rather than inventing a workspace.
 */
function scopeWorkspace(options) {
  const names = ["effectiveCheckout", "workspacePath", "checkoutPath", "worktreePath", "sourcePath"];
  for (const name of names) {
    const value = options[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * One pass over a scope's files: who refuses it, and whose lapsed row it takes.
 *
 * Both answers come from the same read, so a file can never be reported as both
 * refused and taken over — that would be two holders in one result.
 */
function scanScopeTargets(select, workspace, targets, { cardId, tag, nowMs }) {
  const conflicts = [];
  const lapsed = new Map();
  for (const file of targets) {
    const existing = select.get(workspace, file);
    if (!existing || existing.expires_at <= nowMs) {
      // Taking over a row is only a steal when somebody else held it: a lapsed
      // row of this same card is its own forgotten lease, not news.
      if (existing && existing.card_id !== cardId) lapsed.set(file, existing);
      continue;
    }
    if (existing.card_id === cardId && existing.scope === tag) continue;
    conflicts.push({
      file,
      heldBy: existing.card_id,
      heldScope: existing.scope,
      holder: `${existing.card_id}::${existing.scope ?? "unscoped"}`,
      expiresAt: existing.expires_at,
    });
  }
  return { conflicts, lapsed };
}

/**
 * Park the loser: one waiter row per contested file, and the payload the worker
 * reads. Agent-only and deduped per card per file — the host nudges on release,
 * so the worker parks this scope instead of polling for the file to free.
 */
function parkScopeConflicts(db, { cardId, workspace, tag, conflicts, nowMs }) {
  addClaimWaiters(db, {
    cardId,
    workspacePath: workspace,
    files: conflicts.map((entry) => entry.file),
    scope: tag,
    nowMs,
  });
  return conflicts.map((entry) => ({
    file: entry.file,
    stderr: `BB-LOCK-BLOCKED file=${entry.file} heldBy=${entry.holder} expiresAt=${entry.expiresAt}; park this scope, do not retry in a loop`,
    dedupeKey: `lock-blocked:${cardId}:${entry.file}`,
    visibility: "agent-only",
  }));
}

/**
 * Write every target in one transaction, and say which of them were taken over.
 *
 * All-or-nothing is the point: a scope either holds its whole file set or
 * nothing, because a partial hold is a scope that will write half its files
 * under someone else's claim.
 */
function writeScopeClaims(db, { cardId, workspace, tag, targets, lapsed, ttlMs, nowMs }) {
  const upsert = db.prepare(
    "INSERT INTO card_claims (workspace_path, file_path, card_id, scope, acquired_at, expires_at, fencing) VALUES (?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(workspace_path, file_path) DO UPDATE SET " +
    "card_id = excluded.card_id, scope = excluded.scope, " +
    "acquired_at = excluded.acquired_at, expires_at = excluded.expires_at, " +
    "fencing = excluded.fencing",
  );
  const acquired = [];
  const stolen = [];
  const transact = db.transaction(() => {
    for (const file of targets) {
      const fencing = nextFencing(db, workspace);
      upsert.run(workspace, file, cardId, tag, nowMs, nowMs + ttlMs, fencing);
      const previous = lapsed.get(file);
      if (previous) {
        stolen.push({
          file,
          previousHolder: previous.card_id,
          previousScope: previous.scope ?? null,
          fencing,
        });
        continue;
      }
      acquired.push({ file, fencing, holder: `${cardId}::${tag}` });
    }
  });
  transact();
  return { acquired, stolen };
}

/**
 * Per-scope claim acquire: all-or-nothing across every file.
 *
 * A live foreign holder — including a sibling scope of the same card, which is
 * a distinct holder — refuses the whole acquire with CONFLICT naming the
 * holder. The waiter parks with a BB-LOCK-BLOCKED payload and a
 * lock-blocked:<card>:<file> dedupe key; the host nudges agent-only on release.
 * No retry loop lives here.
 */
export function acquireScopeClaims(db, options = {}) {
  const { cardId, batchId = null, scopeId, files, ttlMs = CLAIM_TTL_MS, nowMs = Date.now() } = options;
  const workspace = scopeWorkspace(options);
  const tag = scopeClaimTag(batchId, scopeId);
  const targets = uniqueFiles(files);
  if (!cardId || !tag || targets.length === 0 || !workspace) {
    return { ok: false, code: "CLAIM_REQUIRED", acquired: [], stolen: [], conflicts: [], park: [] };
  }
  const select = db.prepare(
    "SELECT card_id, scope, expires_at, fencing FROM card_claims WHERE workspace_path = ? AND file_path = ?",
  );
  const { conflicts, lapsed } = scanScopeTargets(select, workspace, targets, { cardId, tag, nowMs });
  if (conflicts.length > 0) {
    const park = parkScopeConflicts(db, { cardId, workspace, tag, conflicts, nowMs });
    return { ok: false, code: "CONFLICT", acquired: [], stolen: [], conflicts, park };
  }
  const { acquired, stolen } = writeScopeClaims(db, { cardId, workspace, tag, targets, lapsed, ttlMs, nowMs });
  return { ok: true, code: "ACQUIRED", acquired, stolen, conflicts: [], park: [] };
}

/**
 * Workspace-level file claims: cross-card coordination for cards that share
 * one checkout.
 *
 * Upstream scope locks (`bb stelow lock acquire|release|check`) live inside
 * each card's own state dir, so two cards on the same workspace never see
 * each other's reservations — the exact silent-overwrite case AgentRoom
 * (arXiv Aug 2026) measures as worse than solo. This registry is keyed by
 * workspace path, so concurrent cards on one checkout coordinate through
 * the host instead of relying on worker obedience.
 *
 * Semantics (Chubby-style advisory leases):
 * - One live holder per (workspace, file). Acquire is idempotent for the
 *   same card (renews the lease — cheap heartbeat).
 * - Expired claims are stolen silently on next acquire (crashed workers
 *   self-heal; the steal is surfaced in the acquire result).
 * - Every acquire hands out a monotonic fencing token per workspace; waiters
 *   ignore notifications that predate the token they blocked on, so a stale
 *   release nudge can never resurrect an older epoch.
 * - Pure DB operations (no BB host dependency) so the lifecycle is
 *   exercised against a real SQLite database in node tests.
 */

export const CLAIM_TTL_MS = 30 * 60 * 1000;

export function ensureCardClaimsTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS card_claims (
      workspace_path TEXT NOT NULL,
      file_path TEXT NOT NULL,
      card_id TEXT NOT NULL,
      scope TEXT,
      acquired_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      fencing INTEGER NOT NULL,
      PRIMARY KEY (workspace_path, file_path)
    );
    CREATE INDEX IF NOT EXISTS idx_card_claims_card ON card_claims(card_id);
    CREATE TABLE IF NOT EXISTS card_claim_waiters (
      card_id TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      file_path TEXT NOT NULL,
      scope TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (card_id, workspace_path, file_path)
    );
    CREATE INDEX IF NOT EXISTS idx_card_claim_waiters_ws ON card_claim_waiters(workspace_path, file_path);
  `);
}

/**
 * Normalize a worker-supplied path to a registry key. Returns null when the
 * path escapes the workspace (`..`) or is empty — callers skip nulls so a
 * malicious or sloppy `--file` can never claim outside the checkout.
 */
export function normalizeClaimPath(raw) {
  if (typeof raw !== "string") return null;
  let text = raw.trim().replace(/\\/g, "/");
  if (!text) return null;
  // Strip leading ./ and / (claims are workspace-relative by construction).
  while (text.startsWith("./")) text = text.slice(2);
  while (text.startsWith("/")) text = text.slice(1);
  const parts = [];
  for (const segment of text.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  if (parts.length === 0) return null;
  return parts.join("/");
}

function uniqueFiles(files) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(files) ? files : []) {
    const normalized = normalizeClaimPath(raw);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
}

function nextFencing(db, workspacePath) {
  const row = db.prepare("SELECT COALESCE(MAX(fencing), 0) AS top FROM card_claims WHERE workspace_path = ?").get(workspacePath);
  return (row?.top ?? 0) + 1;
}

/**
 * Acquire workspace claims for a card. Live foreign holders refuse with a
 * conflict entry naming the holder; expired foreign claims are stolen and
 * reported as stolen. Own claims renew the lease (heartbeat).
 */
export function acquireWorkspaceClaims(db, { cardId, workspacePath, files, scope = null, ttlMs = CLAIM_TTL_MS, nowMs = Date.now() }) {
  const targets = uniqueFiles(files);
  const acquired = [];
  const renewed = [];
  const stolen = [];
  const conflicts = [];
  if (targets.length === 0 || !cardId || !workspacePath) return { acquired, renewed, stolen, conflicts };
  const select = db.prepare("SELECT card_id, scope, expires_at FROM card_claims WHERE workspace_path = ? AND file_path = ?");
  const upsert = db.prepare(
    "INSERT INTO card_claims (workspace_path, file_path, card_id, scope, acquired_at, expires_at, fencing) VALUES (?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(workspace_path, file_path) DO UPDATE SET card_id = excluded.card_id, scope = excluded.scope, acquired_at = excluded.acquired_at, expires_at = excluded.expires_at, fencing = excluded.fencing",
  );
  const touch = db.prepare("UPDATE card_claims SET expires_at = ?, scope = COALESCE(?, scope) WHERE workspace_path = ? AND file_path = ? AND card_id = ?");
  const transact = db.transaction(() => {
    for (const file of targets) {
      const existing = select.get(workspacePath, file);
      if (!existing || existing.expires_at <= nowMs) {
        const fencing = nextFencing(db, workspacePath);
        upsert.run(workspacePath, file, cardId, scope, nowMs, nowMs + ttlMs, fencing);
        if (existing && existing.card_id !== cardId) {
          stolen.push({ file, previousHolder: existing.card_id, fencing });
        } else {
          acquired.push({ file, fencing });
        }
      } else if (existing.card_id === cardId) {
        touch.run(nowMs + ttlMs, scope, workspacePath, file, cardId);
        renewed.push({ file });
      } else {
        conflicts.push({ file, heldBy: existing.card_id, heldScope: existing.scope, expiresAt: existing.expires_at });
      }
    }
  });
  transact();
  return { acquired, renewed, stolen, conflicts };
}

/**
 * Read-only room check (AgentRoom `room_state` equivalent): which of these
 * files are free for this card, which are held by others. Renews the
 * caller's own leases as a heartbeat side effect.
 */
export function checkWorkspaceClaims(db, { cardId, workspacePath, files, ttlMs = CLAIM_TTL_MS, nowMs = Date.now() }) {
  const targets = uniqueFiles(files);
  const free = [];
  const conflicts = [];
  if (targets.length === 0 || !workspacePath) return { free, conflicts };
  const select = db.prepare("SELECT card_id, scope, expires_at FROM card_claims WHERE workspace_path = ? AND file_path = ?");
  const touch = db.prepare("UPDATE card_claims SET expires_at = ? WHERE workspace_path = ? AND file_path = ? AND card_id = ?");
  const transact = db.transaction(() => {
    for (const file of targets) {
      const existing = select.get(workspacePath, file);
      if (!existing || existing.expires_at <= nowMs) {
        free.push(file);
      } else if (cardId && existing.card_id === cardId) {
        touch.run(nowMs + ttlMs, workspacePath, file, cardId);
        free.push(file);
      } else {
        conflicts.push({ file, heldBy: existing.card_id, heldScope: existing.scope, expiresAt: existing.expires_at });
      }
    }
  });
  transact();
  return { free, conflicts };
}

/** Release claims held by a card (all of them, or one workspace, or files). */
export function releaseWorkspaceClaims(db, { cardId, workspacePath = null, files = null, nowMs = Date.now() }) {
  void nowMs;
  if (!cardId) return [];
  const targets = files == null ? null : uniqueFiles(files);
  let rows;
  if (workspacePath && targets) {
    if (targets.length === 0) return [];
    rows = db.prepare(
      `SELECT workspace_path, file_path FROM card_claims WHERE card_id = ? AND workspace_path = ? AND file_path IN (${targets.map(() => "?").join(",")})`,
    ).all(cardId, workspacePath, ...targets);
  } else if (workspacePath) {
    rows = db.prepare("SELECT workspace_path, file_path FROM card_claims WHERE card_id = ? AND workspace_path = ?").all(cardId, workspacePath);
  } else {
    rows = db.prepare("SELECT workspace_path, file_path FROM card_claims WHERE card_id = ?").all(cardId);
  }
  const del = db.prepare("DELETE FROM card_claims WHERE card_id = ? AND workspace_path = ? AND file_path = ?");
  const transact = db.transaction(() => {
    for (const row of rows) del.run(cardId, row.workspace_path, row.file_path);
  });
  transact();
  return rows.map((row) => ({ workspacePath: row.workspace_path, file: row.file_path }));
}

/** Terminal-state release: drop everything a card holds, wherever it is. */
export function releaseAllCardClaims(db, cardId) {
  return releaseWorkspaceClaims(db, { cardId });
}

export function addClaimWaiters(db, { cardId, workspacePath, files, scope = null, nowMs = Date.now() }) {
  const targets = uniqueFiles(files);
  if (targets.length === 0 || !cardId || !workspacePath) return 0;
  const insert = db.prepare(
    "INSERT OR IGNORE INTO card_claim_waiters (card_id, workspace_path, file_path, scope, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const transact = db.transaction(() => {
    for (const file of targets) insert.run(cardId, workspacePath, file, scope, nowMs);
  });
  transact();
  return targets.length;
}

export function clearClaimWaiters(db, { cardId, workspacePath = null, files = null }) {
  if (!cardId) return 0;
  const targets = files == null ? null : uniqueFiles(files);
  if (targets && targets.length === 0) return 0;
  if (workspacePath && targets) {
    return db.prepare(
      `DELETE FROM card_claim_waiters WHERE card_id = ? AND workspace_path = ? AND file_path IN (${targets.map(() => "?").join(",")})`,
    ).run(cardId, workspacePath, ...targets).changes;
  }
  if (workspacePath) {
    return db.prepare("DELETE FROM card_claim_waiters WHERE card_id = ? AND workspace_path = ?").run(cardId, workspacePath).changes;
  }
  return db.prepare("DELETE FROM card_claim_waiters WHERE card_id = ?").run(cardId).changes;
}

/** Distinct waiter cards blocked on any of these workspace files. */
export function waitersForFiles(db, { workspacePath, files }) {
  const targets = uniqueFiles(files);
  if (targets.length === 0 || !workspacePath) return [];
  return db.prepare(
    `SELECT DISTINCT card_id, scope FROM card_claim_waiters WHERE workspace_path = ? AND file_path IN (${targets.map(() => "?").join(",")})`,
  ).all(workspacePath, ...targets);
}

/**
 * Reap expired claims (reconcile sweep / crash recovery). Returns the
 * reaped rows so the host can notify waiters exactly once per file.
 */
export function sweepExpiredClaims(db, nowMs = Date.now()) {
  const rows = db.prepare("SELECT workspace_path, file_path, card_id FROM card_claims WHERE expires_at <= ?").all(nowMs);
  const del = db.prepare("DELETE FROM card_claims WHERE workspace_path = ? AND file_path = ? AND expires_at <= ?");
  const transact = db.transaction(() => {
    for (const row of rows) del.run(row.workspace_path, row.file_path, nowMs);
  });
  transact();
  return rows.map((row) => ({ workspacePath: row.workspace_path, file: row.file_path, previousHolder: row.card_id }));
}

/** Live claims in a workspace (host-side room state for check output). */
export function liveClaimsForWorkspace(db, { workspacePath, nowMs = Date.now() }) {
  if (!workspacePath) return [];
  return db.prepare(
    "SELECT file_path, card_id, scope, expires_at, fencing FROM card_claims WHERE workspace_path = ? AND expires_at > ? ORDER BY file_path",
  ).all(workspacePath, nowMs);
}

/**
 * Lapsed-claim signal (read-only): the card held this scope's files (by
 * scope tag or file overlap) but every matching row expired with no live
 * replacement. Distinguishes a stalled worker (was here, lease died) from
 * one that never claimed — the strongest scope-level liveness signal the
 * host can observe without thread file-telemetry.
 */
export function lapsedScopeClaims(db, { cardId, workspacePath, scope = null, files = [], nowMs = Date.now() }) {
  if (!cardId || !workspacePath) return false;
  const targets = uniqueFiles(files);
  const rows = db.prepare(
    "SELECT file_path, scope, expires_at FROM card_claims WHERE workspace_path = ? AND card_id = ?",
  ).all(workspacePath, cardId);
  let held = false;
  for (const row of rows) {
    const matches = (scope && row.scope === scope) || (targets.length > 0 && targets.includes(row.file_path));
    if (!matches) continue;
    if (row.expires_at > nowMs) return false;
    held = true;
  }
  return held;
}

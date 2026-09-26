/**
 * Idempotent per-scope retry: (batchId, scopeId, retryKey) executes its
 * effect at most once. Replays return the prior outcome without touching
 * the workspace or state.md again.
 *
 * Single-effect protocol (all ledger mutations are transactional):
 * - The (batchId, scopeId, retryKey) row is claimed as `inflight` with
 *   INSERT OR IGNORE inside a transaction. The loser's `.changes === 0`
 *   is honored: a concurrent or re-entrant same-key claim returns the
 *   in-flight refusal instead of executing a second effect.
 * - The effect runs exactly once, outside the claim transaction (a
 *   workspace write cannot live inside a SQLite transaction). Its outcome
 *   — success OR throw — is then recorded transactionally. A throwing
 *   effect writes a `failed` row before the error propagates, so a
 *   same-key replay returns the recorded failure instead of re-executing.
 * - An optional `revalidate` probe runs after the claim and before the
 *   effect: it re-reads fresh state (claims, batch cancellation) and may
 *   refuse a stale retry without executing the effect. The refusal is
 *   recorded as a `failed` row so replays stay single-effect.
 */

export function ensureScopeRetryTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scope_retry_ledger (
      batch_id TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      retry_key TEXT NOT NULL,
      outcome TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (batch_id, scope_id, retry_key)
    );
  `);
  const columns = new Set(
    db.prepare("PRAGMA table_info(scope_retry_ledger)").all().map((column) => column.name),
  );
  if (!columns.has("status")) {
    db.exec("ALTER TABLE scope_retry_ledger ADD COLUMN status TEXT NOT NULL DEFAULT 'ok'");
  }
  if (!columns.has("updated_at")) {
    db.exec("ALTER TABLE scope_retry_ledger ADD COLUMN updated_at INTEGER");
  }
}

function parseOutcome(row) {
  if (!row) return null;
  try {
    return JSON.parse(row.outcome);
  } catch {
    return null;
  }
}

function readRow(db, batchId, scopeId, retryKey) {
  return db.prepare(
    "SELECT outcome, status FROM scope_retry_ledger WHERE batch_id = ? AND scope_id = ? AND retry_key = ?",
  ).get(batchId, scopeId, retryKey);
}

export function claimScopeRetry(
  db,
  { batchId, scopeId, retryKey, run, revalidate = null, nowMs = Date.now() } = {},
) {
  if (!batchId || !scopeId || !retryKey) throw new Error("claimScopeRetry requires batchId, scopeId, retryKey");
  if (typeof run !== "function") throw new Error("claimScopeRetry requires a run effect");
  if (revalidate != null && typeof revalidate !== "function") {
    throw new Error("claimScopeRetry revalidate must be a function");
  }
  ensureScopeRetryTables(db);
  const existing = readRow(db, batchId, scopeId, retryKey);
  if (existing) {
    if (existing.status === "inflight") {
      return { duplicate: true, code: "RETRY_INFLIGHT", outcome: null };
    }
    return { duplicate: true, outcome: parseOutcome(existing), failed: existing.status === "failed" };
  }
  const claim = db.transaction(() => db.prepare(
    "INSERT OR IGNORE INTO scope_retry_ledger (batch_id, scope_id, retry_key, outcome, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'inflight', ?, ?)",
  ).run(batchId, scopeId, retryKey, JSON.stringify(null), nowMs, nowMs));
  const claimed = claim();
  if (claimed.changes === 0) {
    const raced = readRow(db, batchId, scopeId, retryKey);
    if (!raced || raced.status === "inflight") {
      return { duplicate: true, code: "RETRY_INFLIGHT", outcome: null };
    }
    return { duplicate: true, outcome: parseOutcome(raced), failed: raced.status === "failed" };
  }
  const recordOutcome = (outcome, status) => db.transaction(() => db.prepare(
    "UPDATE scope_retry_ledger SET outcome = ?, status = ?, updated_at = ? WHERE batch_id = ? AND scope_id = ? AND retry_key = ?",
  ).run(JSON.stringify(outcome ?? null), status, Date.now(), batchId, scopeId, retryKey))();
  if (revalidate) {
    let verdict;
    try {
      verdict = revalidate();
    } catch (error) {
      const outcome = { ok: false, code: "RETRY_STALE", error: error instanceof Error ? error.message : String(error) };
      recordOutcome(outcome, "failed");
      return { duplicate: false, outcome, failed: true, code: "RETRY_STALE" };
    }
    if (verdict === false || (verdict && typeof verdict === "object" && verdict.ok === false)) {
      const reason = typeof verdict === "object" && verdict !== null && "reason" in verdict
        ? String(verdict.reason ?? "stale retry state")
        : "stale retry state";
      const outcome = { ok: false, code: "RETRY_STALE", reason };
      recordOutcome(outcome, "failed");
      return { duplicate: false, outcome, failed: true, code: "RETRY_STALE" };
    }
  }
  let outcome;
  try {
    outcome = run();
  } catch (error) {
    const failure = { ok: false, code: "RETRY_FAILED", error: error instanceof Error ? error.message : String(error) };
    recordOutcome(failure, "failed");
    throw error;
  }
  recordOutcome(outcome, "ok");
  const stored = readRow(db, batchId, scopeId, retryKey);
  return { duplicate: false, outcome: parseOutcome(stored) };
}

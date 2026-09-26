/**
 * Whole-batch cancellation for the scope-batch topology: ONE card running
 * N scopes. Cancelling the batch aborts the card's in-flight execution
 * run, releases every claim the card holds (batch-tagged, unscoped, and
 * workspace claims — a LIKE sweep on `batchId::%` misses all of those),
 * clears the card's own parked waiters, and returns the notify list so
 * the host can nudge every waiter exactly once. Completion dedupe
 * prevents resurrection — a second cancel returns the recorded receipt.
 */
import {
  ensureCardClaimsTables,
  waitersForFiles,
} from "./card-claims.mjs";
import { cancelExecutionRuns, ensureExecutionRunTable } from "./execution-run-ledger.mjs";

export function ensureScopeBatchCancelTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scope_batch_cancel_ledger (
      batch_id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL DEFAULT '',
      cancelled_at INTEGER NOT NULL,
      scopes INTEGER NOT NULL,
      released INTEGER NOT NULL
    );
  `);
  const columns = new Set(
    db.prepare("PRAGMA table_info(scope_batch_cancel_ledger)").all().map((column) => column.name),
  );
  if (!columns.has("card_id")) {
    db.exec("ALTER TABLE scope_batch_cancel_ledger ADD COLUMN card_id TEXT NOT NULL DEFAULT ''");
  }
}

function scopeIds(scopes) {
  const out = [];
  const seen = new Set();
  for (const scope of Array.isArray(scopes) ? scopes : []) {
    const id = typeof scope === "string" ? scope : scope?.scopeId ?? scope?.id;
    if (typeof id === "string" && id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export function cancelBatch(
  db,
  { batchId, cardId = null, cardIds = [], scopes = [], reason = "batch-cancelled", nowMs = Date.now() } = {},
) {
  if (!batchId) throw new Error("cancelBatch requires batchId");
  const legacy = [...new Set([...cardIds, ...scopes.map((scope) => scope?.cardId).filter(Boolean)])];
  const owner = cardId ?? (legacy.length === 1 ? legacy[0] : null);
  if (!owner) {
    throw new Error(
      "cancelBatch requires cardId: scope-batch is one card running N scopes, so a batch cancel owns exactly one card",
    );
  }
  ensureExecutionRunTable(db);
  ensureCardClaimsTables(db);
  ensureScopeBatchCancelTables(db);
  const recorded = db.prepare("SELECT * FROM scope_batch_cancel_ledger WHERE batch_id = ?").get(batchId);
  if (recorded) {
    return {
      duplicate: true,
      batchId,
      cardId: recorded.card_id || owner,
      cancelledScopes: recorded.scopes,
      releasedClaims: recorded.released,
      clearedWaiters: 0,
      notified: [],
    };
  }
  const runsCancelled = cancelExecutionRuns(db, owner, reason);
  const inFlight = scopeIds(scopes);
  const cancelledScopes = Math.max(runsCancelled, inFlight.length);
  const held = db.prepare(
    "SELECT workspace_path, file_path, scope FROM card_claims WHERE card_id = ?",
  ).all(owner);
  const waiterRows = db.prepare(
    "SELECT workspace_path, file_path, scope FROM card_claim_waiters WHERE card_id = ?",
  ).all(owner);
  const notified = new Map();
  for (const row of held) {
    for (const waiter of waitersForFiles(db, { workspacePath: row.workspace_path, files: [row.file_path] })) {
      if (waiter.card_id === owner) continue;
      const key = `${waiter.card_id}::${waiter.scope ?? ""}::${row.workspace_path}::${row.file_path}`;
      if (!notified.has(key)) {
        notified.set(key, {
          cardId: waiter.card_id,
          scope: waiter.scope,
          workspacePath: row.workspace_path,
          file: row.file_path,
          visibility: "agent-only",
        });
      }
    }
  }
  const transact = db.transaction(() => {
    db.prepare("DELETE FROM card_claims WHERE card_id = ?").run(owner);
    db.prepare("DELETE FROM card_claim_waiters WHERE card_id = ?").run(owner);
  });
  transact();
  db.prepare(
    "INSERT INTO scope_batch_cancel_ledger (batch_id, card_id, cancelled_at, scopes, released) VALUES (?, ?, ?, ?, ?)",
  ).run(batchId, owner, nowMs, cancelledScopes, held.length);
  return {
    duplicate: false,
    batchId,
    cardId: owner,
    runsCancelled,
    cancelledScopes,
    inFlightScopes: inFlight,
    releasedClaims: held.map((row) => ({
      workspacePath: row.workspace_path,
      file: row.file_path,
      scope: row.scope,
    })),
    clearedWaiters: waiterRows.length,
    notified: [...notified.values()],
  };
}

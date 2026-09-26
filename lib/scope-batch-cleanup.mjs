/**
 * Deterministic per-scope cleanup: finishScope releases exactly one scope's
 * claims and notifies its waiters once. Blocked is terminal — a
 * blocked-terminal holder must never leak a claim. No TTL-sweep reliance.
 */
import { ensureCardClaimsTables, scopeClaimTag, waitersForFiles } from "./card-claims.mjs";

export const TERMINAL_SCOPE_OUTCOMES = ["succeeded", "failed", "cancelled", "completed", "blocked", "archived"];

export function isScopeTerminal(outcome) {
  return typeof outcome === "string" && TERMINAL_SCOPE_OUTCOMES.includes(outcome);
}

export function finishScope(db, { batchId = null, scopeId, cardId = null, outcome = "succeeded", nowMs = Date.now() } = {}) {
  void nowMs;
  if (!scopeId) throw new Error("finishScope requires scopeId");
  ensureCardClaimsTables(db);
  const tag = scopeClaimTag(batchId, scopeId);
  let rows;
  if (cardId) {
    rows = db.prepare(
      "SELECT workspace_path, file_path, fencing FROM card_claims WHERE card_id = ? AND scope = ?",
    ).all(cardId, tag);
  } else {
    rows = db.prepare("SELECT workspace_path, file_path, card_id, fencing FROM card_claims WHERE scope = ?").all(tag);
  }
  const waiters = new Map();
  for (const row of rows) {
    const found = waitersForFiles(db, { workspacePath: row.workspace_path, files: [row.file_path] });
    for (const waiter of found) {
      const key = `${waiter.card_id}::${waiter.scope ?? ""}`;
      if (!waiters.has(key)) waiters.set(key, waiter);
    }
  }
  const del = cardId
    ? db.prepare("DELETE FROM card_claims WHERE card_id = ? AND scope = ? AND workspace_path = ? AND file_path = ?")
    : db.prepare("DELETE FROM card_claims WHERE scope = ? AND workspace_path = ? AND file_path = ?");
  const clearWaiter = db.prepare(
    "DELETE FROM card_claim_waiters WHERE workspace_path = ? AND file_path = ? AND (card_id = ? OR scope = ?)",
  );
  const transact = db.transaction(() => {
    for (const row of rows) {
      if (cardId) del.run(cardId, tag, row.workspace_path, row.file_path);
      else del.run(tag, row.workspace_path, row.file_path);
      for (const waiter of waiters.values()) {
        clearWaiter.run(row.workspace_path, row.file_path, waiter.card_id, waiter.scope);
      }
    }
  });
  transact();
  const notified = [...waiters.values()].map((waiter) => ({
    cardId: waiter.card_id,
    scope: waiter.scope,
    visibility: "agent-only",
  }));
  return {
    scopeId,
    batchId,
    outcome,
    terminal: isScopeTerminal(outcome),
    released: rows.map((row) => ({ workspacePath: row.workspace_path, file: row.file_path, fencing: row.fencing })),
    notified,
  };
}

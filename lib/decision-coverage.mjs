/**
 * Decision coverage. A worker starting work on scopes must read the past
 * decisions that touch those scopes — served at the point of work, not left
 * to discovery. This module selects which receipts a scope set pulls in, with
 * no I/O, so the selection is unit-testable and the caller owns the loading.
 *
 * Fail-closed: a receipt with no `scopeIds` covers everything (it may be a
 * legacy receipt that predates coverage), so it is always served rather than
 * silently skipped.
 */

export const DECISION_READS_CAP = 5;

/**
 * @param {Array<{ id: string, scopeIds?: unknown, kind?: unknown }>} receipts
 * @param {string[]} scopes scope ids the work touches
 * @returns {Array<object>} receipts covering at least one scope, stable order
 */
export function receiptsForScopes(receipts, scopes) {
  const wanted = new Set((Array.isArray(scopes) ? scopes : []).filter((id) => typeof id === "string" && id));
  const list = Array.isArray(receipts) ? receipts : [];
  return list.filter((receipt) => covers(receipt, wanted));
}

function covers(receipt, wanted) {
  if (!receipt || typeof receipt.id !== "string" || !receipt.id) return false;
  if (wanted.size === 0) return true;
  if (!Array.isArray(receipt.scopeIds)) return true;
  return receipt.scopeIds.some((id) => wanted.has(id));
}

/**
 * Cap the served set and name what was left out. A truncation nobody names
 * is a decision silently unread — the note lists omitted ids so the worker
 * (or a reviewer) can ask for them.
 *
 * @param {Array<object>} selected already coverage-filtered receipts
 * @param {number} cap maximum receipts to serve
 * @returns {{ served: Array<object>, omittedIds: string[] }}
 */
export function capReads(selected, cap = DECISION_READS_CAP) {
  const list = Array.isArray(selected) ? selected : [];
  const limit = typeof cap === "number" && cap > 0 ? Math.floor(cap) : DECISION_READS_CAP;
  if (list.length <= limit) return { served: [...list], omittedIds: [] };
  const served = list.slice(0, limit);
  const servedIds = new Set(served.map((receipt) => receipt.id));
  const omittedIds = list.filter((receipt) => !servedIds.has(receipt.id)).map((receipt) => receipt.id);
  return { served, omittedIds };
}

/**
 * Render the `reads:` block appended to a worker start context. Empty input
 * renders an empty string so callers stay additive: no receipts, no text.
 */
export function formatDecisionReads(served, omittedIds) {
  const list = Array.isArray(served) ? served : [];
  if (list.length === 0) return "";
  const lines = list.map((receipt) => `- ${receipt.id} (${receipt.kind ?? "decision"})`);
  const omitted = Array.isArray(omittedIds) && omittedIds.length > 0
    ? `\n(+${omittedIds.length} more not shown: ${omittedIds.join(", ")})`
    : "";
  return `Decision receipts you must read before proposing anything in these scopes:\n${lines.join("\n")}${omitted}`;
}

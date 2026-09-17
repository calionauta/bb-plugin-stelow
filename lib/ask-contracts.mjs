/**
 * Ask-to-contract linkage for provenance. A worker may declare which
 * question contract an ask answers (`--contract <id>` per --question
 * group); when the human answers, the matching declaration is consumed and
 * the trail names the contract. Pure DB helpers (no BB host dependency),
 * following the worker-ledger precedent.
 *
 * Matching is by normalized question text, not interaction id: the host
 * interaction service returns no synchronous id at ask time, and the
 * duplicate guard serializes asks per card (at most one open set), so an
 * earliest-unconsumed text match is exact in practice. Re-asking identical
 * text with a different contract is already banned worker discipline.
 * Nothing here enforces advance acceptance — undeclared flows behave
 * byte-identically to before.
 */

/** Canonical form shared by writers and matchers. */
export function normalizeQuestionText(text) {
  return String(text ?? "").trim().replace(/\s+/g, " ");
}

/**
 * Validate declared contract ids against the stage checklist (from
 * requiredForStage, or null when unreadable). Unknown ids with a readable
 * checklist refuse, naming the valid ids; without one the ask records raw
 * (fail-open — a stale mirror must never deadlock a worker).
 */
export function validateAskContracts(declarations, checklist) {
  const ids = [...new Set(
    (Array.isArray(declarations) ? declarations : [])
      .map((entry) => entry?.contractId)
      .filter((id) => typeof id === "string" && id),
  )];
  if (ids.length === 0) return { ok: true, error: null };
  if (!Array.isArray(checklist)) return { ok: true, error: null };
  const known = new Map();
  for (const entry of checklist) {
    if (entry && typeof entry.id === "string" && typeof entry.kind === "string") known.set(entry.id, entry.kind);
  }
  for (const id of ids) {
    const kind = known.get(id);
    if (kind === "agent-receipt") {
      return { ok: false, error: `"${id}" is resolved by its file receipt, not by asking — write the receipt instead.` };
    }
    if (kind === undefined && known.size > 0) {
      return { ok: false, error: `Unknown contract "${id}" for this stage. Valid ids: ${[...known.keys()].join(", ")}.` };
    }
  }
  return { ok: true, error: null };
}

/** Persist declarations ({ id, cardId, question, contractId, askedAt }). */
export function recordAskContracts(db, rows) {
  let count = 0;
  const insert = db.prepare("INSERT INTO ask_contracts (id, card_id, question_text, contract_id, asked_at, consumed_at) VALUES (?, ?, ?, ?, ?, NULL)");
  db.transaction(() => {
    for (const row of rows ?? []) {
      const question = normalizeQuestionText(row?.question);
      if (!row?.id || !row?.cardId || !question || !row?.contractId) continue;
      insert.run(row.id, row.cardId, question, row.contractId, row.askedAt ?? Date.now());
      count++;
    }
  })();
  return count;
}

/**
 * Consume the earliest unconsumed declaration matching the answered
 * question text. Returns the contract id, or null when nothing matches
 * (normal path for undeclared asks — no behavior change there).
 */
export function consumeAskContract(db, cardId, questionText, consumedAt = Date.now()) {
  const text = normalizeQuestionText(questionText);
  if (!text) return null;
  const row = db.prepare("SELECT id, contract_id AS contractId FROM ask_contracts WHERE card_id = ? AND consumed_at IS NULL AND question_text = ? ORDER BY asked_at ASC, id ASC LIMIT 1").get(cardId, text);
  if (!row || typeof row.contractId !== "string") return null;
  db.prepare("UPDATE ask_contracts SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL").run(consumedAt, row.id);
  return row.contractId;
}

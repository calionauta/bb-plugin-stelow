import { validateScopeMap } from "./scope-map.mjs";

/**
 * Pure question-contract check for an advance. The server owns all I/O; this
 * module only decides whether known, readable evidence is sufficient.
 */

function receiptMatches(pattern, path) {
  if (typeof pattern !== "string" || typeof path !== "string") return false;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(path);
}

function markerFor(contractId) {
  if (contractId.startsWith("assumptions-")) return /^assumptions_resolved:/m;
  if (contractId.startsWith("scope-adjustment-")) return /^scope_adjustment:/m;
  if (contractId === "critique-report") return /^gap_verdict:/m;
  return null;
}

function fresh(receipt, enteredAt) {
  return typeof receipt.modifiedAtMs === "number"
    && Number.isFinite(receipt.modifiedAtMs)
    && receipt.modifiedAtMs >= enteredAt;
}

function scopeMapReceiptValid(contract, receipt) {
  if (!contract.id.startsWith("scope-adjustment-") || !contract.receipt.endsWith(".json")) return null;
  try {
    return validateScopeMap(JSON.parse(receipt.content)).length === 0;
  } catch {
    return false;
  }
}

function receiptRefusal(contract, stage) {
  return `Refused: complete \`${contract.id}\` for \`${stage}\` — write the fresh receipt \`${contract.receipt}\` after entering this stage, then advance again.`;
}

/**
 * Return a named refusal, or null when the known contract is satisfied.
 * Missing configuration/evidence metadata is deliberately fail-open: callers
 * must never turn an unreadable state into a false workflow deadlock.
 */
export function checkAdvanceContracts({ stage, enteredAt, contracts, receipts, answered } = {}) {
  if (typeof stage !== "string" || !stage || typeof enteredAt !== "number" || !Number.isFinite(enteredAt)) return null;
  if (!Array.isArray(contracts) || !Array.isArray(receipts) || typeof answered !== "boolean") return null;

  for (const contract of contracts) {
    if (!contract || typeof contract.id !== "string" || typeof contract.kind !== "string" || typeof contract.receipt !== "string") return null;
    if (contract.kind === "skip") continue;
    if (contract.kind !== "agent-receipt" && contract.kind !== "human-ask") return null;

    if (contract.kind === "human-ask") {
      // A critique report stating that no gaps exist is the receipt for the
      // contingent resolution question. Otherwise, human contracts are met by
      // a recorded answer, not by making a duplicate artifact mandatory.
      if (contract.id === "critique-gap-resolution") {
        const report = receipts.find((entry) => entry && receiptMatches(contract.receipt, entry.path));
        if (report && (typeof report.content !== "string" || report.modifiedAtMs === null)) return null;
        if (report && fresh(report, enteredAt) && /gap_verdict:\s*["']?0 gaps/i.test(report.content)) continue;
      }
      if (!answered) return `Refused: answer the required \`${contract.id}\` question for \`${stage}\` (or record its required receipt), then advance again.`;
      continue;
    }

    const receipt = receipts.find((entry) => entry && receiptMatches(contract.receipt, entry.path));
    if (!receipt) return receiptRefusal(contract, stage);
    // A host that cannot read modification metadata cannot safely distinguish
    // old evidence from fresh evidence, so it leaves the workflow unblocked.
    if (typeof receipt.content !== "string" || receipt.modifiedAtMs === null || !fresh(receipt, enteredAt)) {
      return receipt.modifiedAtMs === null || typeof receipt.content !== "string" ? null : receiptRefusal(contract, stage);
    }

    const structuredScopeReceipt = scopeMapReceiptValid(contract, receipt);
    if (structuredScopeReceipt === false) return receiptRefusal(contract, stage);
    if (structuredScopeReceipt === true) continue;
    const marker = markerFor(contract.id);
    if (marker && !marker.test(receipt.content)) return receiptRefusal(contract, stage);
    // P0's automatic interface selection needs only a fresh selected file.
    if (contract.id === "interface-pick-auto") continue;
  }
  return null;
}

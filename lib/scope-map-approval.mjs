/**
 * Approving a scope map, decided once.
 *
 * Context: an approved scope map must carry `status: "approved"` plus
 * `approval.receiptId` and `approval.approvedBy`, or the X-ray refuses to
 * project it. Nothing in the system wrote those fields — the skill delegated
 * it to the agent's prose and the agent did not, so the map could only be
 * approved by hand. That made the whole read-only view unreachable from the
 * real workflow, and the only way through was editing an artifact by hand,
 * which is exactly the kind of bypass the product forbids.
 *
 * The approval is a decision, so it lives in `lib/`: pure, testable, and the
 * one place that knows what "approved" means. Callers supply the who and the
 * receipt; this owns the shape and refuses everything else.
 */

import { validateScopeMap } from "./scope-map.mjs";

/**
 * Stamp an approval onto a scope map, or explain why it cannot be approved.
 *
 * Fail-closed on every axis: the map must already be contract-valid, it must
 * not already be approved (a second approval would silently rewrite who
 * signed it), and both the receipt and the approver must be named. An
 * approval nobody can attribute is not an approval.
 *
 * @param {unknown} map parsed scope map
 * @param {{ receiptId: string, approvedBy: string }} approval
 * @returns {{ ok: true, map: object } | { ok: false, reason: string }}
 */
export function approveScopeMap(map, approval) {
  const issues = validateScopeMap(map);
  if (issues.length > 0) {
    return { ok: false, reason: `the scope map does not satisfy its contract yet: ${issues.join("; ")}` };
  }
  if (map.status === "approved") {
    return { ok: false, reason: "this scope map is already approved; approving again would rewrite who signed it" };
  }
  const receiptId = typeof approval?.receiptId === "string" ? approval.receiptId.trim() : "";
  const approvedBy = typeof approval?.approvedBy === "string" ? approval.approvedBy.trim() : "";
  if (receiptId.length === 0 || approvedBy.length === 0) {
    return { ok: false, reason: "approval needs both a receipt id and who approved it" };
  }
  // Re-validate the stamped result: a map that cannot still be read after
  // approval is worse than one that was never approved.
  const approved = { ...map, status: "approved", approval: { receiptId, approvedBy } };
  const after = validateScopeMap(approved);
  if (after.length > 0) {
    return { ok: false, reason: `the approved scope map would not satisfy its contract: ${after.join("; ")}` };
  }
  return { ok: true, map: approved };
}

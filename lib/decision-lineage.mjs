/**
 * Decision lineage. A new decision retires the old one by naming it — it
 * never leaves two truths standing. `supersededBy`/`supersedes` is the chain;
 * this module resolves it. Two live receipts contradicting on overlapping
 * scopes surface as conflicts, because contradictory live truths make the next
 * agent pick arbitrarily — and an arbitrary pick is a silent revisit.
 *
 * Automation may mark stale (see decision-freshness); only a human (or an
 * authorized agent receipt) marks superseded. This module resolves the chain
 * either way — it does not grant the authority to write it.
 */

/**
 * @param {Array<object>} receipts all known receipts for a card
 * @returns {{ live: Array<object>, superseded: Array<object>, conflicts: Array<{ a: string, b: string, scopeIds: string[] }> }}
 */
export function resolveLive(receipts) {
  const list = (Array.isArray(receipts) ? receipts : []).filter((r) => r && typeof r.id === "string" && r.id);
  const byId = new Map(list.map((r) => [r.id, r]));
  const supersededIds = new Set();
  for (const receipt of list) {
    for (const older of asIds(receipt.supersedes)) {
      if (byId.has(older)) supersededIds.add(older);
    }
    if (typeof receipt.supersededBy === "string" && receipt.supersededBy && byId.has(receipt.supersededBy)) {
      supersededIds.add(receipt.id);
    }
  }
  const live = list.filter((r) => !supersededIds.has(r.id));
  const superseded = list.filter((r) => supersededIds.has(r.id));
  return { live, superseded, conflicts: findConflicts(live) };
}

function asIds(value) {
  if (typeof value === "string" && value) return [value];
  if (Array.isArray(value)) return value.filter((id) => typeof id === "string" && id);
  return [];
}

function findConflicts(live) {
  const out = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const overlap = overlapIds(live[i], live[j]);
      if (overlap.length > 0 && contradicts(live[i], live[j])) {
        out.push({ a: live[i].id, b: live[j].id, scopeIds: overlap });
      }
    }
  }
  return out;
}

function overlapIds(a, b) {
  if (!Array.isArray(a.scopeIds) || !Array.isArray(b.scopeIds)) return [];
  if (a.scopeIds.length === 0 || b.scopeIds.length === 0) return [];
  return a.scopeIds.filter((id) => b.scopeIds.includes(id));
}

function contradicts(a, b) {
  if (typeof a.selectedId === "string" && a.selectedId
    && typeof b.selectedId === "string" && b.selectedId
    && a.selectedId !== b.selectedId) return true;
  const aRej = new Set(Array.isArray(a.rejectedOptionIds) ? a.rejectedOptionIds : []);
  const bRej = new Set(Array.isArray(b.rejectedOptionIds) ? b.rejectedOptionIds : []);
  if (typeof a.selectedId === "string" && a.selectedId && bRej.has(a.selectedId)) return true;
  if (typeof b.selectedId === "string" && b.selectedId && aRej.has(b.selectedId)) return true;
  return false;
}

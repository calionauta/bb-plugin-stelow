/**
 * The room as ONE scope sees it.
 *
 * Split out of lib/card-claims.mjs, which owns the WRITES — acquire, release,
 * reap, waiters — and had grown past its file budget because the READ side got
 * a second question. A claim registry that only knows how to mutate answers
 * "do I hold this file?" and nothing about the file I could not have, which is
 * the half a card needs: the panel has to name both, or it shows a scope
 * holding a file it is also waiting on.
 *
 * Single owner of the matching rule. The claimed projection, the card's lock
 * line, and the card-level wait all read it, so no two of them can disagree
 * about which file belongs to whom.
 */

import { normalizeClaimPath, scopeClaimTag } from "./card-claims.mjs";

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

/**
 * Whether a live row is this scope's own claim.
 *
 * A row is OURS only if its holder tag names this scope. `acquireScopeClaims`
 * writes `batchId::scopeId` (lib/card-claims.mjs, scopeClaimTag) while the
 * card detail asks about the BARE scope id, so a holder recognises itself by
 * the tail of its own tag. That same comparison is what stops scope-1 from
 * claiming a file its sibling scope-2 holds: the registry refuses that acquire
 * and parks the loser as BB-LOCK-BLOCKED, and an earlier version of this rule
 * — any same-card row on one of the scope's files — made scope-1 render
 * "Holding 1 file: src/shared.ts" for it, with no amber line and no hero
 * contention. The Inbox said blocked and the card said holding: opposite
 * answers to one question, which is the failure this module exists to stop.
 *
 * A row with NO tag is the unscoped `bb stelow lock acquire` flow, where the
 * card is the holder and the file is the identity. Those match on overlap, as
 * they must — there is no scope to match.
 */
export function rowIsOwnScopeClaim(row, { ownerId, scopeId, targets }) {
  if (row.card_id !== ownerId) return false;
  if (row.scope == null || row.scope === "") {
    // Untagged: the card is the holder, so the file is the identity.
    return targets.length > 0 && targets.includes(row.file_path);
  }
  // A tagged row is THIS scope's only when the tag names this scope, exactly
  // or as the tail of a batch tag. The registry writes `batchId::scopeId`
  // (scopeClaimTag) while the card detail asks about the bare scope id, so
  // comparing the tails is what makes the holder recognise itself — and it is
  // equally what stops scope-1 from claiming scope-2's file. A tag that
  // belongs to a DIFFERENT scope is that scope's claim, even on the same card.
  return row.scope === scopeId || row.scope.endsWith(`::${scopeId}`);
}

/**
 * What a scope holds, and what it cannot have because another live card or a
 * sibling scope holds it. One pass, so the two halves are disjoint by
 * construction.
 *
 * `blocked` therefore includes a same-card sibling scope, and its `heldBy`
 * stays the card id while `heldScope` names the holder. The Inbox already
 * reports this case as contention (`acquireScopeClaims` parks it), so the card
 * reading it as anything else is the two-representation failure this module
 * exists to prevent.
 *
 * Junk in resolves empty, never a throw: a claim read that fails has to leave
 * the card silent, not broken.
 */
export function scopeClaimRoom(rows, { ownerId, scopeId, files = [], nowMs = Date.now() } = {}) {
  const targets = uniqueFiles(files);
  const held = [];
  const blocked = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object" || !(row.expires_at > nowMs)) continue;
    if (rowIsOwnScopeClaim(row, { ownerId, scopeId, targets })) {
      held.push(row);
      continue;
    }
    if (targets.includes(row.file_path)) {
      blocked.push({
        file: row.file_path,
        heldBy: row.card_id,
        heldScope: row.scope ?? null,
        // A holder on the same card is a sibling scope, not another card; the
        // card has to say so, or it points the reader at its own card name.
        holderLabel: row.card_id === ownerId ? "another scope on this card" : null,
        expiresAt: row.expires_at,
      });
    }
  }
  return { held, blocked };
}

/** Live rows held by one card for one scope: exact scope tag or target-file overlap, unexpired. */
export function matchScopeClaims(rows, options = {}) {
  return scopeClaimRoom(rows, options).held;
}

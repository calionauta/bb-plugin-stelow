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

import { normalizeClaimPath } from "./card-claims.mjs";

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
 * What a scope holds, and what it cannot have because another live card holds
 * it. One pass, so the two halves are disjoint by construction.
 *
 * `blocked` is deliberately narrower than "not mine". A same-card row tagged
 * with a DIFFERENT scope is a sibling scope's claim, and the batch tag
 * namespace (`batch::scope`) does not line up with the scope id the card
 * detail asks about — so file overlap is the only sound ownership test, and a
 * same-card row on one of this scope's files resolves as held. What is left is
 * cross-card, which is unambiguous, and cross-card is the only thing the card
 * is allowed to assert out loud.
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
    if (row.card_id === ownerId
      && (row.scope === scopeId || (targets.length > 0 && targets.includes(row.file_path)))) {
      held.push(row);
      continue;
    }
    if (targets.includes(row.file_path)) {
      blocked.push({ file: row.file_path, heldBy: row.card_id, expiresAt: row.expires_at });
    }
  }
  return { held, blocked };
}

/** Live rows held by one card for one scope: exact scope tag or target-file overlap, unexpired. */
export function matchScopeClaims(rows, options = {}) {
  return scopeClaimRoom(rows, options).held;
}

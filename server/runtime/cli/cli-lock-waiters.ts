/**
 * Claim contention: what happens to a card parked on a file it cannot have.
 *
 * Split out of cli-lock because it is a different question from the rest of
 * that file. `cli-lock` answers what the COMMAND should do — acquire, release,
 * check, and say so. This answers what happens to everyone ELSE: reap holders
 * whose cards are gone, and record the notification for the card that lost the
 * race. The two are read for different reasons and change for different
 * reasons, which is the test for whether they belong in one file.
 */
import type { CliDeps } from "./cli-deps.js";
import { isClaimTerminal } from "../../../lib/card-terminal.mjs";
import {
  CLAIM_TTL_MS,
  acquireWorkspaceClaims,
  addClaimWaiters,
} from "../../../lib/card-claims.mjs";
import { lockBlockEvent } from "../../../lib/lock-blocked.mjs";
import type { ClaimConflict, ClaimOutcome, LockTarget } from "./cli-lock-types.js";

export function reapDeadHolders(
  deps: CliDeps,
  target: LockTarget,
  outcome: NonNullable<ClaimOutcome>,
): NonNullable<ClaimOutcome> {
  const dead = outcome.conflicts.filter((entry) => !isLiveHolder(deps, entry));
  if (dead.length === 0) return outcome;
  try {
    const del = deps.db.prepare(
      "DELETE FROM card_claims WHERE workspace_path = ? AND file_path = ? AND card_id = ?",
    );
    for (const entry of dead) del.run(target.claimRoot, entry.file, entry.heldBy);
    return acquireWorkspaceClaims(deps.db, {
      cardId: target.card!.id,
      workspacePath: target.claimRoot,
      files: target.claimFiles,
      scope: target.claimScope,
      ttlMs: CLAIM_TTL_MS,
      nowMs: target.at,
    });
  } catch {
    /* advisory */
    return outcome;
  }
}

export function queueWaiters(
  deps: CliDeps,
  target: LockTarget,
  live: ClaimConflict[],
): void {
  try {
    addClaimWaiters(deps.db, {
      cardId: target.card!.id,
      workspacePath: target.claimRoot,
      files: live.map((entry) => entry.file),
      scope: target.claimScope,
      nowMs: target.at,
    });
  } catch {
    /* advisory */
  }
  for (const entry of live) {
    const holder = deps.getCard(entry.heldBy);
    // One record, so the sentence and the affordance cannot name different
    // cards. This used to format a summary from a display name and drop
    // `entry.heldBy` on the floor, which is why a reader who wanted to know
    // WHICH card was holding the file had nothing to click.
    const block = lockBlockEvent({
      cardId: target.card!.id,
      file: entry.file,
      holderCardId: entry.heldBy,
      holderName: holder?.display_name ?? holder?.name ?? entry.heldBy,
      expiresAt: entry.expiresAt,
    });
    deps.recordInboxEvent(
      target.card!,
      "paused",
      block.summary,
      block.dedupeKey,
      target.at,
      { cardId: block.holderCardId, file: block.holderFile },
    );
  }
}

/**
 * A conflict is live while its holder is a card that still exists and has not
 * reached a terminal column. A holder that was archived or deleted is not
 * "working on the file" — the conflict is dead, and the file is free.
 */
export function isLiveHolder(deps: CliDeps, entry: ClaimConflict): boolean {
  const holder = deps.getCard(entry.heldBy);
  return holder !== undefined && !isClaimTerminal(holder.status);
}

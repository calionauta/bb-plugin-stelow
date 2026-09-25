/**
 * Workspace claim coordination (lib/card-claims).
 *
 * A card that hits a file held by another live card parks that scope, not the
 * thread: the worker gets a BB-LOCK-BLOCKED stderr, the user gets a paused
 * inbox event naming the holder and the automatic unlock condition (release
 * or TTL expiry), and the waiter row lets the host resume exactly the blocked
 * cards when the files free up. Advisory-plus-apology: a stale claim is
 * stolen, and the steal is trailed on the card instead of blocking work.
 */
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import {
  refreshEventSeverity,
  refreshStalledPaused,
} from "../../lib/inbox-events.mjs";
import { releaseAllCardClaims } from "../../lib/card-claims.mjs";
import type { WorkerCard } from "../workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export type ClaimCoordinationDeps = {
  bb: BbPluginApi;
  db: Db;
  getCard: (cardId: string) => WorkerCard | undefined;
  notifyClaimWaiters: (
    workspacePath: string,
    files: string[],
  ) => Promise<void>;
  now: () => number;
};

export function createClaimCoordination(deps: ClaimCoordinationDeps) {
  /** What a waiting card is told: who holds the file, and what frees it. */
  function lockBlockedSummary(
    file: string,
    holderName: string,
    expiresAt: number,
  ): string {
    const when = new Date(expiresAt).toLocaleString();
    const resumeNotice = "no action needed; the host resumes this card on release.";
    return `Waiting on ${file} (held by card "${holderName}"). Releases automatically when that card finishes the file or by ${when} — ${resumeNotice}`;
  }

  /**
   * Release everything a finished card held and wake exactly the cards that
   * were parked on those files. A failed release is a no-op: the TTL still
   * frees the claims, and a half-released workspace must not page anyone.
   */
  async function releaseCardClaimsAndNotify(cardId: string): Promise<void> {
    let released: Array<{ workspacePath: string; file: string }>;
    try {
      released = releaseAllCardClaims(deps.db, cardId);
    } catch {
      return;
    }
    if (released.length === 0) return;
    const byWorkspace = new Map<string, string[]>();
    for (const row of released) {
      const list = byWorkspace.get(row.workspacePath) ?? [];
      list.push(row.file);
      byWorkspace.set(row.workspacePath, list);
    }
    for (const [workspacePath, files] of byWorkspace) {
      await deps.notifyClaimWaiters(workspacePath, files);
    }
  }

  /**
   * Stalled cards keep their column; their open paused event carries the age
   * instead. Shared by all three track syncs so paused means paused
   * everywhere. Guarded to idle cards and wrapped: escalation is advisory and
   * must never break a sync (e.g. dispose closing the DB mid-poll).
   */
  function escalateIfStalled(cardId: string): void {
    const fresh = deps.getCard(cardId);
    if (!fresh || fresh.activity !== "idle") return;
    try {
      const touched =
        refreshStalledPaused(deps.db, { cardId, nowMs: deps.now() }) +
        refreshEventSeverity(deps.db, { cardId, nowMs: deps.now() });
      if (touched > 0) deps.bb.realtime.publish("inbox-changed", { cardId });
    } catch {
      /* advisory only */
    }
  }

  return { lockBlockedSummary, releaseCardClaimsAndNotify, escalateIfStalled };
}

export type ClaimCoordination = ReturnType<typeof createClaimCoordination>;

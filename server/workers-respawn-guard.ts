/**
 * One card, one coordinator thread.
 *
 * A card owns exactly one `worker_thread_id`, and replacing that worker spawns
 * the new thread BEFORE stopping the old one — the right order, because a
 * failure mid-replacement must not leave a card with no worker at all. It also
 * means two threads are briefly live for every respawn, and that window is only
 * safe if two respawns cannot overlap.
 *
 * They could. A band swap on a stage advance, an automatic spawn retry, and a
 * manual Restart Worker are three independent callers of `respawn`, and none of
 * them was locked against the others — each spawns a thread. Two overlapping
 * respawns leave the FIRST replacement orphaned: not the card's
 * `worker_thread_id`, so nothing that stops a card's worker can reach it, not in
 * `card_threads` under any other id, and still holding a workspace. The reader
 * sees one card and two live threads.
 *
 * (This is the failure the earlier report guessed at from the two
 * `stelow-interface-contrast` threads a user saw. Those turned out to be host
 * fan-out children — `originPluginId: workflows`, `lifecycleOwnerThreadId`
 * pointing at the coordinator, one per recipe task, both archived when the run
 * ended. No orphan. The race is still real, so the guard is still worth having;
 * it just was not that.)
 *
 * A caller arriving while a respawn is running is REFUSED, not queued. Queueing
 * would let a double-click produce a second thread a few hundred milliseconds
 * later, which is the same orphan by another route. The refusal names the card
 * and says to try again once it settles, because a guard with no door is a
 * deadlock with a good error message.
 */
const inFlight = new Set<string>();

export function beginRespawn(cardId: string, reason: string): string | null {
  if (inFlight.has(cardId)) {
    return `This card is already replacing its worker thread (${reason}). Try again once it settles.`;
  }
  inFlight.add(cardId);
  return null;
}

export function endRespawn(cardId: string): void {
  inFlight.delete(cardId);
}

/** Whether a respawn is running for this card. Read by tests and diagnostics. */
export function respawnInFlight(cardId: string): boolean {
  return inFlight.has(cardId);
}

import type { BbPluginApi } from "@get-bb/plugin-sdk";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

/**
 * Crash-safe half of the guard. The Set above dies with the process — a
 * kill -9 between claim and release leaves no memory behind, but the card
 * may own an orphan thread nobody will stop. The table survives the crash
 * so the next boot can see the interrupted claim and say so on the card.
 */
export function ensureRespawnInflightTable(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS respawn_inflight (
    card_id TEXT PRIMARY KEY,
    reason TEXT NOT NULL DEFAULT '',
    started_at INTEGER NOT NULL
  )`);
}

/** True when this process now holds the durable claim. False: someone else does. */
export function claimRespawnRow(db: Db, cardId: string, reason: string, nowMs: number): boolean {
  ensureRespawnInflightTable(db);
  try {
    const existing = db.prepare("SELECT card_id FROM respawn_inflight WHERE card_id = ?").get(cardId);
    if (existing) return false;
    db.prepare("INSERT INTO respawn_inflight (card_id, reason, started_at) VALUES (?, ?, ?)")
      .run(cardId, reason, nowMs);
    return true;
  } catch {
    return false;
  }
}

export function releaseRespawnRow(db: Db, cardId: string): void {
  try {
    ensureRespawnInflightTable(db);
    db.prepare("DELETE FROM respawn_inflight WHERE card_id = ?").run(cardId);
  } catch {
    /* the claim is advisory; a stuck row is reaped by the recovery sweep */
  }
}

/**
 * Boot sweep: every row here outlived its holder — a live holder keeps its
 * memory guard, and memory never survives a restart. Each cleared claim
 * leaves a receipt comment naming the outage window, never a silent row
 * delete, so the card explains why its worker may have doubled.
 */
export function recoverInterruptedRespawns(
  db: Db,
  deps: {
    nowMs: number;
    getCard: (cardId: string) => { id: string } | undefined;
    comment: (cardId: string, body: string) => void;
  },
): string[] {
  ensureRespawnInflightTable(db);
  let rows: Array<Record<string, unknown>> = [];
  try {
    rows = db.prepare("SELECT card_id, reason, started_at FROM respawn_inflight").all() as unknown as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
  const recovered: string[] = [];
  for (const row of rows) {
    const cardId = String(row.card_id ?? "");
    if (!cardId) continue;
    try {
      db.prepare("DELETE FROM respawn_inflight WHERE card_id = ?").run(cardId);
    } catch {
      continue;
    }
    recovered.push(cardId);
    if (!deps.getCard(cardId)) continue;
    try {
      deps.comment(
        cardId,
        `A worker replacement (${String(row.reason ?? "unknown reason")}) was interrupted by a restart and never settled. `
        + "If two worker threads reply, keep the one named by the latest receipt and archive the other.",
      );
    } catch {
      /* the receipt is owed, never load-bearing */
    }
  }
  return recovered;
}

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

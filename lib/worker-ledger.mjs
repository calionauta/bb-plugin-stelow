/**
 * Worker-thread ledger + preset-staleness transitions. Pure DB helpers (no BB
 * host dependency) so the lifecycle is exercised against real SQLite in tests.
 *
 * Background: provider/model are fixed at spawn, so a preset change only
 * lands on a fresh worker. Staleness is explicit state
 * (`preset_restart_pending`), not id inference — ids can lie when a stored
 * preset id claims an override the running thread predates.
 */

export function recordWorkerThread(db, cardId, threadId, presetId, endedReason) {
  const ts = Date.now();
  const close = db.prepare("UPDATE card_threads SET ended_at = ?, ended_reason = ? WHERE card_id = ? AND ended_at IS NULL").run(ts, endedReason, cardId);
  db.prepare("INSERT INTO card_threads (thread_id, card_id, preset_id, started_at, ended_at, ended_reason) VALUES (?, ?, ?, ?, NULL, NULL)").run(threadId, cardId, presetId, ts);
  return close.changes;
}

export function stallCount(db, cardId) {
  try {
    return db.prepare("SELECT COUNT(*) AS count FROM inbox_events WHERE card_id = ? AND kind = 'paused'").get(cardId).count;
  } catch {
    return 0;
  }
}

/**
 * Recompute the restart-pending flag after an override assign/reset.
 * Returns the flag value written.
 */
export function refreshRestartPending(db, cardId, workerThreadId, workerPresetId, effectivePresetId) {
  const pending = workerThreadId != null && effectivePresetId !== workerPresetId ? 1 : 0;
  db.prepare("UPDATE cards SET preset_restart_pending = ? WHERE id = ?").run(pending, cardId);
  return pending;
}

/**
 * Self-heal for legacy rows: a thread born before the current override was
 * assigned provably predates it. Returns true when the flag was raised.
 * Never clears — only spawn paths clear, so a flagged card keeps offering
 * Restart until it actually happens.
 */
export function healPresetStaleness(db, cardId, threadBorn, flagSet) {
  if (flagSet) return false;
  if (typeof threadBorn !== "number") return false;
  const override = db.prepare("SELECT preset_id, assigned_at FROM card_presets WHERE card_id = ?").get(cardId);
  if (!override || !(threadBorn < override.assigned_at)) return false;
  db.prepare("UPDATE cards SET preset_restart_pending = 1 WHERE id = ?").run(cardId);
  return true;
}

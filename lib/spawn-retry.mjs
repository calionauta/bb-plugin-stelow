/**
 * Automatic spawn-retry policy for workers that die before starting.
 * Pure policy + SQLite claim helpers (no BB host dependency), exercised in
 * node tests following the worker-ledger precedent.
 *
 * Scope: start-phase failures ONLY — the worker never produced output
 * (card.last_assistant_text is null) and the cause names transient
 * infrastructure (skill-tree fetch race, thread.start failure, 502/503,
 * lost host session). Mid-workflow failures always need human eyes, and
 * refusals (reseed, unknown strategy) would fail identically on retry.
 *
 * Idempotency (a retry spawns a whole worker — duplicates would double
 * burn and race on state.md):
 * - one retry in flight per card (server-side pending map),
 * - attempts are claimed in the DB for the card's failure EPISODE, not for
 *   one thread id: an automatic retry spawns a replacement, and a replacement
 *   that dies before starting is the same episode. The budget ends when a
 *   worker actually starts (first output, `resetSpawnRetry`) or when a
 *   person starts/restarts the card — keying it to the failed thread instead
 *   reopened a fresh 3-attempt budget on every replacement and turned a
 *   permanent provider error into an endless spawn loop,
 * - every attempt re-validates fresh card state before spawning and aborts
 *   unless the same dead worker still owns the card.
 * Only the final exhaustion writes activity=error, so the inbox pings once.
 */

export const MAX_SPAWN_RETRIES = 3;

// Attempt is 1-based: 1–2s, 2–4s, 4–8s.
export function spawnRetryDelayMs(attempt, rand = Math.random) {
  const n = Math.min(Math.max(1, Math.floor(Number(attempt)) || 1), MAX_SPAWN_RETRIES);
  const base = 1000 * 2 ** (n - 1);
  const jitter = typeof rand === "function" ? rand() : Math.random();
  const clamped = Math.min(Math.max(0, jitter), 1);
  return Math.round(base * (1 + clamped));
}

const RETRYABLE_PATTERNS = [
  /skill[_\s-]?tree not found/i,
  /failed to fetch skill tree/i,
  /command thread\.start failed/i,
  /\b50[234]\b/,
  /bad gateway|service unavailable|gateway timeout/i,
  /timed? ?out/i,
  /econnreset|econnrefused|enotfound|eai_again|etimedout|socket hang up|network/i,
  /no active .* session/i,
  /temporar(y|ily) (unavailable|failure|overload)/i,
];

/**
 * Whether a worker failure cause is worth an automatic respawn. Matches
 * transient start-phase infrastructure only — provider errors, auth, and
 * host refusals fail fast to the card + inbox instead.
 */
export function isRetryableSpawnError(message) {
  const text = String(message ?? "");
  if (!text.trim()) return false;
  return RETRYABLE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Attempts already spent by the card's current failure episode. The episode
 * is active while `spawn_retry_thread` is set; it is cleared when a worker
 * actually starts (see `resetSpawnRetry`) or a person starts/restarts the
 * card. A thread id is recorded for the trail, not used as the scope.
 */
export function spawnRetryAttempts(card) {
  if (!card || card.spawn_retry_thread == null) return 0;
  return card.spawn_retry_count ?? 0;
}

/**
 * Claim retry attempt N (1-based) for this card's failure episode, or 0 when
 * the budget is exhausted. `threadId` is recorded as the episode's current
 * failed thread; it does not reset the budget, because the retry's own
 * replacement may fail before it starts.
 * Read-then-write is race-safe here: better-sqlite3 is synchronous, so no
 * await can interleave between the SELECT and the UPDATE.
 */
export function claimSpawnRetry(db, cardId, threadId, maxRetries = MAX_SPAWN_RETRIES) {
  const row = db.prepare("SELECT spawn_retry_count, spawn_retry_thread FROM cards WHERE id = ?").get(cardId);
  if (!row) return 0;
  const used = spawnRetryAttempts(row);
  if (used >= maxRetries) return 0;
  const attempt = used + 1;
  db.prepare("UPDATE cards SET spawn_retry_count = ?, spawn_retry_thread = ? WHERE id = ?").run(attempt, threadId, cardId);
  return attempt;
}

/** Clear the retry budget after a worker starts successfully. */
export function resetSpawnRetry(db, cardId) {
  // The guard keeps the common running-worker sync (first output, every tick)
  // from writing the card row just to write zeroes it already holds.
  db.prepare(`
    UPDATE cards SET spawn_retry_count = 0, spawn_retry_thread = NULL
    WHERE id = ? AND (spawn_retry_count != 0 OR spawn_retry_thread IS NOT NULL)
  `).run(cardId);
}

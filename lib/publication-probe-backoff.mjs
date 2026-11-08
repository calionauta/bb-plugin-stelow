/**
 * How often the publication reconciler may re-ask about one finished card.
 *
 * The pass asks the forge and the content proof about every completed card that
 * has no recorded integration. That is correct while the list is short and
 * pathological once the board accumulates finished cards that will never land
 * (abandoned, superseded, or simply parked): every 45 s it spends a git call and
 * a forge call per card, and the tick that should take milliseconds takes a
 * minute. Measured live: 59,728 ms in the publications step, one card after
 * another, with the host unresponsive while it ran.
 *
 * So a failed probe backs off per card — 5 min, 10, 20, … capped at 6 h — and a
 * success forgets the card entirely. The clock is injected so the schedule is
 * testable without waiting.
 */
export const PROBE_BASE_MS = 5 * 60 * 1000;
export const PROBE_MAX_MS = 6 * 60 * 60 * 1000;
/** How many cards one pass may probe, regardless of how many are due. */
export const PROBE_PASS_LIMIT = 5;
/** How long one pass may spend probing before it yields to the next tick. */
export const PROBE_PASS_BUDGET_MS = 10_000;

export function probeDelay(attempts) {
  if (!Number.isFinite(attempts) || attempts <= 0) return PROBE_BASE_MS;
  return Math.min(PROBE_MAX_MS, PROBE_BASE_MS * 2 ** (attempts - 1));
}

export function createProbeBackoff() {
  const state = new Map();
  return {
    due(cardId, at) {
      const entry = state.get(cardId);
      return !entry || at >= entry.nextAt;
    },
    failed(cardId, at) {
      const attempts = (state.get(cardId)?.attempts ?? 0) + 1;
      state.set(cardId, { attempts, nextAt: at + probeDelay(attempts) });
      return probeDelay(attempts);
    },
    succeeded(cardId) {
      state.delete(cardId);
    },
  };
}

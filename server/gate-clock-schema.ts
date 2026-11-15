import { z } from "zod";

/**
 * The gate clock, declared once for every card payload that has to carry it.
 *
 * `stageEnteredAt` is when the card entered the stage it is in now; null when the
 * ledger has no entry for that stage, which is a fact about the trail rather than
 * about the card. `createdAt` is the fallback clock: a card with no entry can
 * have been in its gate for at most this long.
 *
 * It travels on the reads that already happen (`listCards`, `cardDetail`) so no
 * surface needs a second fetch, and it is spread into each card object rather
 * than repeated: one declaration, one place to change when the ledger grows a
 * second clock. The reading rules live in `runtime/gate-clock.ts`.
 */
export const gateClockFields = {
  stageEnteredAt: z.number().nullable(),
  createdAt: z.number().nullable(),
} as const;

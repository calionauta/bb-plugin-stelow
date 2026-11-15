import { stageEntriesByCard, type StageEntryTimes } from "./card-ledger.js";
import type { WorkerCard } from "../workers-types.js";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

/**
 * The two dates a card carries about its gate: when it entered the stage it is
 * in now, and when it was created.
 *
 * Both come from the card's own record -- `card_stage_events` for the entry,
 * `cards.created_at` for the fallback -- because `updated_at` moves on a sync
 * poll and an inbox event belongs to whichever stage it happened in. Neither can
 * date a gate wait, and a surface that uses them prints a number that is not the
 * wait it claims to be.
 */
export type GateClock = { stageEnteredAt: number | null; createdAt: number | null };

/** From an already-grouped entry map: `listCards` pays one query for the board. */
export function gateClockFrom(entries: StageEntryTimes, row: WorkerCard): GateClock {
  return {
    stageEnteredAt: entries.get(row.id)?.get(row.stage) ?? null,
    createdAt: typeof row.created_at === "number" ? row.created_at : null,
  };
}

/** For a single card: the detail read has one keyword and asks for one card. */
export function gateClockFor(db: Db, row: WorkerCard): GateClock {
  return gateClockFrom(stageEntriesByCard(db, [row.id]), row);
}

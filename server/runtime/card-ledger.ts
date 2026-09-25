/**
 * The card ledger: the DB-side facts every surface reports.
 *
 * Stage entries, the last verification HEAD, the card behind a worker thread,
 * and the conversation rows are read and written here so "when did this card
 * move?" has one answer. The stage trail is metrics-only — a failed write
 * degrades metrics to created_at/updated_at, so it never blocks the card
 * transition it annotates.
 */
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import { summarizeTimeline } from "../../lib/card-metrics.mjs";
import type { WorkerCard } from "../workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

/** Id with a prefix, the shape every Stelow row id uses. */
export function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createCardLedger(deps: {
  db: Db;
  now: () => number;
}) {
  /**
   * Append-only stage-entry ledger (lead/cycle-time source). Best-effort:
   * metrics degrade to created_at/updated_at when rows are missing, so a
   * failed write never blocks the card transition it annotates.
   */
  function recordStageEvent(cardId: string, stage: string): void {
    try {
      deps.db.prepare(
        "INSERT INTO card_stage_events (card_id, stage, entered_at) VALUES (?, ?, ?)",
      ).run(cardId, stage, deps.now());
    } catch {
      /* metrics-only; never block */
    }
  }

  function stageEvents(
    cardId: string,
  ): Array<{ stage: string; entered_at: number }> {
    try {
      return deps.db
        .prepare(
          "SELECT stage, entered_at FROM card_stage_events WHERE card_id = ? ORDER BY entered_at ASC, id ASC",
        )
        .all(cardId) as Array<{ stage: string; entered_at: number }>;
    } catch {
      return [];
    }
  }

  /**
   * Lead/cycle times for one card, mirroring the gap-summary convention: the
   * done stage event ends both clocks (unfinished cards have age, not lead —
   * the flow RPC only lists finished ones). One helper so every surface
   * reports the same numbers.
   */
  function flowTimesForCard(card: {
    id: string;
    created_at: number;
  }): { leadMs: number | null; cycleMs: number | null; doneAt: number | null } {
    const events = stageEvents(card.id);
    const doneEvent =
      [...events].reverse().find((event) => event.stage === "done") ?? null;
    if (!doneEvent) return { leadMs: null, cycleMs: null, doneAt: null };
    const timeline = summarizeTimeline(events, {
      createdAt: card.created_at,
      endAt: doneEvent.entered_at,
    });
    return {
      leadMs: timeline.leadMs,
      cycleMs: timeline.cycleMs,
      doneAt: doneEvent.entered_at,
    };
  }

  /**
   * Anchor a completed card to the tree it was verified at: Done cards keep
   * evolving checkouts honest by naming their own HEAD instead of implying
   * current dirt is card leftover.
   */
  function verifiedHeadShaForCard(cardId: string): string | null {
    try {
      const row = deps.db
        .prepare(
          "SELECT head_sha FROM verification_runs WHERE card_id = ? ORDER BY created_at DESC LIMIT 1",
        )
        .get(cardId) as { head_sha: string } | undefined;
      return typeof row?.head_sha === "string" && row.head_sha
        ? row.head_sha
        : null;
    } catch {
      return null;
    }
  }

  /** The card a worker thread belongs to. */
  function getCardByWorkerThread(threadId: string): WorkerCard | undefined {
    return deps.db
      .prepare("SELECT * FROM cards WHERE worker_thread_id = ?")
      .get(threadId) as WorkerCard | undefined;
  }

  /**
   * Single writer for card conversation rows (agent trail, user notes,
   * worker transitions). Returns the comment id for callers that reference it.
   */
  function logCardComment(
    cardId: string,
    target: string,
    targetId: string,
    author: "user" | "agent",
    body: string,
  ): string {
    const commentId = randomId("cmt");
    deps.db.prepare(
      "INSERT INTO comments (id, card_id, target, target_id, author, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(commentId, cardId, target, targetId, author, body, deps.now());
    return commentId;
  }

  return {
    recordStageEvent,
    stageEvents,
    flowTimesForCard,
    verifiedHeadShaForCard,
    getCardByWorkerThread,
    logCardComment,
  };
}

export type CardLedger = ReturnType<typeof createCardLedger>;

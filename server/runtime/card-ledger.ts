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

export type CardLedgerDeps = {
  db: Db;
  now: () => number;
};

function recordStageEvent(
  deps: CardLedgerDeps,
  cardId: string,
  stage: string,
): void {
  try {
    deps.db.prepare(
      "INSERT INTO card_stage_events (card_id, stage, entered_at) VALUES (?, ?, ?)",
    ).run(cardId, stage, deps.now());
  } catch {
    /* metrics-only; never block */
  }
}
function stageEvents(
  deps: CardLedgerDeps,
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
function flowTimesForCard(
  deps: CardLedgerDeps,
  card: {
    id: string;
    created_at: number;
  },
): { leadMs: number | null; cycleMs: number | null; doneAt: number | null } {
  const events = stageEvents(deps, card.id);
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
function verifiedHeadShaForCard(
  deps: CardLedgerDeps,
  cardId: string,
): string | null {
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
function getCardByWorkerThread(
  deps: CardLedgerDeps,
  threadId: string,
): WorkerCard | undefined {
  return deps.db
    .prepare("SELECT * FROM cards WHERE worker_thread_id = ?")
    .get(threadId) as WorkerCard | undefined;
}
function logCardComment(
  deps: CardLedgerDeps,
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

export function createCardLedger(deps: CardLedgerDeps) {
  return {
    recordStageEvent: recordStageEvent.bind(null, deps),
    stageEvents: stageEvents.bind(null, deps),
    flowTimesForCard: flowTimesForCard.bind(null, deps),
    verifiedHeadShaForCard: verifiedHeadShaForCard.bind(null, deps),
    getCardByWorkerThread: getCardByWorkerThread.bind(null, deps),
    logCardComment: logCardComment.bind(null, deps),
    // A comment on a card itself, which is what every surface writes. The
    // four-argument form stays available for the surfaces that comment on a
    // scope or an execution instead.
    commentCard: commentCard.bind(null, deps),
  };
}

/** The card-level comment, with the target fixed, that every trail uses. */
function commentCard(
  deps: CardLedgerDeps,
  cardId: string,
  body: string,
): string {
  return logCardComment(deps, cardId, "card", cardId, "agent", body);
}

export type CardLedger = ReturnType<typeof createCardLedger>;

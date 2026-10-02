import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { summarizeDurations, summarizeTimeline } from "../../lib/card-metrics.mjs";
import { hasPendingReview } from "../../lib/inbox-events.mjs";
import { attributeCardWait, reviewWaitMs } from "../../lib/wait-attribution.mjs";
import { normalizeKind } from "../../lib/tracks.mjs";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type Input = {
  projectId?: string | null;
  since?: number | null;
  until?: number | null;
  /** The clock for an open review wait. Injected so a caller (and a test) can
   * measure a card at a fixed instant instead of at whatever "now" happens to
   * be when the query runs. */
  now?: number | null;
};
type CompletedRow = { id: string; kind: string; name: string; created_at: number };
type StageEvent = { card_id: string; stage: string; entered_at: number };
type OpenRow = {
  id: string;
  kind: string;
  display_name: string | null;
  name: string;
  status: string;
  activity: string;
};

function completedRows(db: Db, projectId: string | null): CompletedRow[] {
  const sql = "SELECT id, kind, name, created_at FROM cards WHERE status = 'completed'";
  return projectId
    ? db.prepare(`${sql} AND project_id = ?`).all(projectId) as CompletedRow[]
    : db.prepare(sql).all() as CompletedRow[];
}

/** One batched pass over the ledger: done time and the full stage trail per
 * card. Per-card queries here would be a round trip per finished card for rows
 * the board always wants together. */
function completionEvents(db: Db, ids: string[]) {
  const doneByCard = new Map<string, number>();
  const eventsByCard = new Map<string, StageEvent[]>();
  if (ids.length === 0) return { doneByCard, eventsByCard };

  const placeholders = ids.map(() => "?").join(",");
  const doneSql = "SELECT card_id, MAX(entered_at) AS done_at FROM card_stage_events"
    + ` WHERE stage = 'done' AND card_id IN (${placeholders}) GROUP BY card_id`;
  const doneRows = db.prepare(doneSql).all(...ids) as Array<{ card_id: string; done_at: number }>;
  for (const row of doneRows) doneByCard.set(row.card_id, row.done_at);

  const eventSql = "SELECT card_id, stage, entered_at FROM card_stage_events"
    + ` WHERE card_id IN (${placeholders}) ORDER BY card_id ASC, entered_at ASC, id ASC`;
  const events = db.prepare(eventSql).all(...ids) as StageEvent[];
  for (const event of events) {
    const rows = eventsByCard.get(event.card_id) ?? [];
    rows.push(event);
    eventsByCard.set(event.card_id, rows);
  }
  return { doneByCard, eventsByCard };
}

/** One finished card: its lead/cycle times and where its wall-clock went.
 * The wait split ends at the card's own done time, so a finished card's
 * breakdown is a closed fact rather than a number that keeps growing. */
function finishedCard(
  db: Db,
  row: CompletedRow,
  doneAt: number,
  events: StageEvent[],
  now: number,
) {
  const timeline = summarizeTimeline(events, { createdAt: row.created_at, endAt: doneAt });
  return {
    cardId: row.id,
    kind: normalizeKind(row.kind),
    name: row.name,
    leadMs: timeline.leadMs,
    cycleMs: timeline.cycleMs,
    doneAt,
    wait: attributeCardWait(db, { cardId: row.id, startAt: row.created_at, endAt: doneAt }),
    reviewWaitMs: reviewWaitMs(db, { cardId: row.id, nowMs: now }),
  };
}

function finishedCards(db: Db, input: Input, now: number) {
  const rows = completedRows(db, input.projectId ?? null);
  const { doneByCard, eventsByCard } = completionEvents(db, rows.map((row) => row.id));
  const cards = [];
  for (const row of rows) {
    const doneAt = doneByCard.get(row.id);
    if (doneAt === undefined) continue;
    if (input.since != null && doneAt < input.since) continue;
    if (input.until != null && doneAt > input.until) continue;
    cards.push(finishedCard(db, row, doneAt, eventsByCard.get(row.id) ?? [], now));
  }
  return cards;
}

function attentionNow(db: Db, projectId: string | null, now: number) {
  const sql = "SELECT id, kind, display_name, name, status, activity"
    + " FROM cards WHERE status != 'archived'";
  const rows = projectId
    ? db.prepare(`${sql} AND project_id = ?`).all(projectId) as OpenRow[]
    : db.prepare(sql).all() as OpenRow[];
  const attention: Array<{
    cardId: string;
    kind: "build" | "research" | "explore";
    name: string;
    reason: "stuck" | "review";
    waitMs: number | null;
  }> = [];
  for (const row of rows) {
    const name = row.display_name ?? row.name;
    if (row.status === "blocked" || row.activity === "error") {
      attention.push({ cardId: row.id, kind: normalizeKind(row.kind), name, reason: "stuck", waitMs: null });
    } else if (row.status === "completed" && hasPendingReview(db, row.id)) {
      // The review wait is the one aging fact the strip can show: how long a
      // finished card has been waiting for a look. Stuck cards already carry
      // their own age in the card's hero; this is the gap the review column had.
      attention.push({
        cardId: row.id,
        kind: normalizeKind(row.kind),
        name,
        reason: "review",
        waitMs: reviewWaitMs(db, { cardId: row.id, nowMs: now }),
      });
    }
  }
  return attention;
}

type FinishedCard = ReturnType<typeof finishedCard>;

/**
 * The fleet-wide breakdown: the same split over every finished card in scope.
 *
 * Percentile-free on purpose. The per-card rows carry the spread, and a median
 * of parts that were themselves derived from per-card medians would be a second,
 * quieter source of truth for the same question. It is a plain sum of disjoint
 * parts, so the shares are exact.
 */
function waitSummary(cards: FinishedCard[]) {
  const total = { humanMs: 0, systemMs: 0, attributedMs: 0, unattributedMs: 0, totalMs: 0 };
  for (const card of cards) {
    total.humanMs += card.wait.humanMs;
    total.systemMs += card.wait.systemMs;
    total.attributedMs += card.wait.attributedMs;
    total.unattributedMs += card.wait.unattributedMs;
    total.totalMs += card.wait.totalMs;
  }
  const share = (part: number) => (total.totalMs > 0 ? Math.min(1, part / total.totalMs) : 0);
  return {
    ...total,
    humanShare: share(total.humanMs),
    systemShare: share(total.systemMs),
    unattributedShare: share(total.unattributedMs),
  };
}

export function flowMetrics(db: Db, input: Input) {
  const now = typeof input.now === "number" ? input.now : Date.now();
  const cards = finishedCards(db, input, now);
  const leads = summarizeDurations(cards.map((card) => card.leadMs));
  const cycles = summarizeDurations(cards.map((card) => card.cycleMs));
  return {
    items: cards,
    summary: {
      count: cards.length,
      leadP50Ms: leads.p50,
      leadP90Ms: leads.p90,
      cycleP50Ms: cycles.p50,
      cycleP90Ms: cycles.p90,
    },
    wait: waitSummary(cards),
    attention: attentionNow(db, input.projectId ?? null, now),
  };
}

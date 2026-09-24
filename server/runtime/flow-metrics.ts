import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { summarizeDurations, summarizeTimeline } from "../../lib/card-metrics.mjs";
import { hasPendingReview } from "../../lib/inbox-events.mjs";
import { normalizeKind } from "../../lib/tracks.mjs";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type Input = { projectId?: string | null; since?: number | null; until?: number | null };
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

function finishedCards(db: Db, input: Input) {
  const rows = completedRows(db, input.projectId ?? null);
  const { doneByCard, eventsByCard } = completionEvents(db, rows.map((row) => row.id));
  const cards = [];
  for (const row of rows) {
    const doneAt = doneByCard.get(row.id);
    if (doneAt === undefined) continue;
    if (input.since != null && doneAt < input.since) continue;
    if (input.until != null && doneAt > input.until) continue;
    const timeline = summarizeTimeline(eventsByCard.get(row.id) ?? [], {
      createdAt: row.created_at,
      endAt: doneAt,
    });
    cards.push({
      cardId: row.id,
      kind: normalizeKind(row.kind),
      name: row.name,
      leadMs: timeline.leadMs,
      cycleMs: timeline.cycleMs,
      doneAt,
    });
  }
  return cards;
}

function attentionNow(db: Db, projectId: string | null) {
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
  }> = [];
  for (const row of rows) {
    const name = row.display_name ?? row.name;
    if (row.status === "blocked" || row.activity === "error") {
      attention.push({ cardId: row.id, kind: normalizeKind(row.kind), name, reason: "stuck" });
    } else if (row.status === "completed" && hasPendingReview(db, row.id)) {
      attention.push({ cardId: row.id, kind: normalizeKind(row.kind), name, reason: "review" });
    }
  }
  return attention;
}

export function flowMetrics(db: Db, input: Input) {
  const cards = finishedCards(db, input);
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
    attention: attentionNow(db, input.projectId ?? null),
  };
}

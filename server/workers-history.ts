import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { attachChildTokenBreakdown, attachChildTokenUsage, shapeChildThreads } from "../lib/thread-children.mjs";
import { tokenBreakdownFromEvents, tokenUsageFromEvents } from "../lib/token-usage.mjs";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

type TokenBreakdown = ReturnType<typeof tokenBreakdownFromEvents>;
type ShapedChild = ReturnType<typeof shapeChildThreads>[number];
type ChildThread = ReturnType<typeof attachChildTokenBreakdown>[number];

type HistoryRow = {
  thread_id: string;
  preset_name: string | null;
  started_at: number;
  ended_at: number | null;
  ended_reason: string | null;
};

export type WorkerHistoryEntry = {
  threadId: string;
  presetName: string | null;
  startedAt: number;
  endedAt: number | null;
  endedReason: string | null;
  tokenUsage: number | null;
  tokenBreakdown: TokenBreakdown;
  children: ChildThread[];
};

const HISTORY_SELECT = `
  SELECT card_threads.thread_id, card_threads.preset_id,
    presets.name AS preset_name, card_threads.started_at,
    card_threads.ended_at, card_threads.ended_reason
  FROM card_threads
  LEFT JOIN presets ON presets.id = card_threads.preset_id
  WHERE card_threads.card_id = ?
  ORDER BY card_threads.started_at DESC
  LIMIT 6
`;
const THREAD_SELECT = `
  SELECT thread_id FROM card_threads
  WHERE card_id = ? ORDER BY started_at DESC LIMIT ?
`;
const OWNER_SELECT = `
  SELECT card_id FROM card_threads
  WHERE thread_id = ? ORDER BY started_at DESC LIMIT 1
`;

export function createWorkerHistory(db: Db, bb: BbPluginApi) {
  async function tokenReport(threadId: string): Promise<{ total: number | null; breakdown: TokenBreakdown }> {
    try {
      const events = await bb.sdk.threads.events.list({
        threadId,
        types: ["thread/tokenUsage/updated"],
        order: "desc",
        limit: "1",
      });
      return { total: tokenUsageFromEvents(events), breakdown: tokenBreakdownFromEvents(events) };
    } catch {
      return { total: null, breakdown: null };
    }
  }

  async function childThreads(threadId: string): Promise<ChildThread[]> {
    try {
      const listed = await bb.sdk.threads.list({ parentThreadId: threadId, limit: 10 });
      const shaped = shapeChildThreads(listed);
      const usages = await Promise.all(shaped.map(readChildUsage));
      const totals = attachChildTokenUsage(
        shaped,
        Object.fromEntries(usages.map(([id, total]) => [id, total])),
      );
      return attachChildTokenBreakdown(
        totals,
        Object.fromEntries(usages.map(([id, , breakdown]) => [id, breakdown])),
      );
    } catch {
      return [];
    }
  }

  async function readChildUsage(child: ShapedChild) {
    try {
      const events = await bb.sdk.threads.events.list({
        threadId: child.threadId,
        types: ["thread/tokenUsage/updated"],
        order: "desc",
        limit: "1",
      });
      return [child.threadId, tokenUsageFromEvents(events), tokenBreakdownFromEvents(events)] as const;
    } catch {
      return [child.threadId, null, null] as const;
    }
  }

  async function history(cardId: string): Promise<WorkerHistoryEntry[]> {
    const rows = db.prepare(HISTORY_SELECT).all(cardId) as HistoryRow[];
    return Promise.all(rows.map(async (row) => {
      const [report, children] = await Promise.all([
        tokenReport(row.thread_id),
        childThreads(row.thread_id),
      ]);
      return {
        threadId: row.thread_id,
        presetName: row.preset_name,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        endedReason: row.ended_reason,
        tokenUsage: report.total,
        tokenBreakdown: report.breakdown,
        children,
      };
    }));
  }

  return {
    history,
    ledgerRows(cardId: string) {
      return db.prepare(HISTORY_SELECT).all(cardId) as HistoryRow[];
    },
    ledgerThreadIds(cardId: string, limit = 20) {
      const rows = db.prepare(THREAD_SELECT).all(cardId, limit) as Array<{ thread_id: string }>;
      return rows.map((row) => row.thread_id);
    },
    ledgerCardId(threadId: string) {
      const row = db.prepare(OWNER_SELECT).get(threadId) as { card_id: string } | undefined;
      return row ? row.card_id : null;
    },
    deleteCard(cardId: string): void {
      db.prepare("DELETE FROM card_threads WHERE card_id = ?").run(cardId);
    },
  };
}

import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { attachChildTokenBreakdown, attachChildTokenUsage, shapeChildThreads } from "../lib/thread-children.mjs";
import { tokenBreakdownFromEvents, usageFromEvents } from "../lib/token-usage.mjs";
import type { UsageSource } from "../lib/token-usage.mjs";

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
  tokenUsageSource: UsageSource;
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

/**
 * One family's newest event, asked for on its own.
 *
 * A single request for both families with a small limit is NOT equivalent, and the
 * difference was measured: the two families interleave, and on 2 of the 148 threads
 * that report both, the newest two events are both context readings — so a
 * two-event page discarded a real provider total (1,125,141) in favour of an
 * estimate (329,821). Asking per family makes each family's own newest event
 * guaranteed rather than probable, whatever the traffic ratio.
 */
/** The two event families this module reads. Spelled as the SDK's own union so a
 * renamed event type fails the build rather than silently returning nothing. */
type EventType = "thread/tokenUsage/updated" | "thread/contextWindowUsage/updated";

async function latestOfType(bb: BbPluginApi, threadId: string, type: EventType) {
  try {
    return await bb.sdk.threads.events.list({ threadId, types: [type], order: "desc", limit: "1" });
  } catch {
    return [];
  }
}

async function tokenReport(
  bb: BbPluginApi,
  threadId: string,
): Promise<{ total: number | null; breakdown: TokenBreakdown; source: UsageSource }> {
  const [tokenEvents, contextEvents] = await Promise.all([
    latestOfType(bb, threadId, "thread/tokenUsage/updated"),
    latestOfType(bb, threadId, "thread/contextWindowUsage/updated"),
  ]);
  const usage = usageFromEvents([...tokenEvents, ...contextEvents]);
  // The breakdown comes from the token report alone: a context reading has no
  // input/output/cached split, and fabricating legs from a single number would
  // invent a measurement.
  return { total: usage.total, breakdown: tokenBreakdownFromEvents(tokenEvents), source: usage.source };
}

async function readChildUsage(bb: BbPluginApi, child: ShapedChild) {
  const [tokenEvents, contextEvents] = await Promise.all([
    latestOfType(bb, child.threadId, "thread/tokenUsage/updated"),
    latestOfType(bb, child.threadId, "thread/contextWindowUsage/updated"),
  ]);
  return [child.threadId, usageFromEvents([...tokenEvents, ...contextEvents]).total, tokenBreakdownFromEvents(tokenEvents)] as const;
}

async function childThreads(bb: BbPluginApi, threadId: string): Promise<ChildThread[]> {
  try {
    const listed = await bb.sdk.threads.list({ parentThreadId: threadId, limit: 10 });
    const shaped = shapeChildThreads(listed);
    const usages = await Promise.all(shaped.map((child) => readChildUsage(bb, child)));
    const totals = attachChildTokenUsage(shaped, Object.fromEntries(usages.map(([id, total]) => [id, total])));
    return attachChildTokenBreakdown(totals, Object.fromEntries(usages.map(([id, , breakdown]) => [id, breakdown])));
  } catch {
    return [];
  }
}

async function history(db: Db, bb: BbPluginApi, cardId: string): Promise<WorkerHistoryEntry[]> {
  const rows = db.prepare(HISTORY_SELECT).all(cardId) as HistoryRow[];
  return Promise.all(rows.map(async (row) => {
    const [report, children] = await Promise.all([tokenReport(bb, row.thread_id), childThreads(bb, row.thread_id)]);
    return {
      threadId: row.thread_id,
      presetName: row.preset_name,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      endedReason: row.ended_reason,
      tokenUsage: report.total,
      tokenUsageSource: report.source,
      tokenBreakdown: report.breakdown,
      children,
    };
  }));
}

export function createWorkerHistory(db: Db, bb: BbPluginApi) {
  return {
    history: (cardId: string) => history(db, bb, cardId),
    ledgerRows: (cardId: string) => db.prepare(HISTORY_SELECT).all(cardId) as HistoryRow[],
    ledgerThreadIds(cardId: string, limit = 20) {
      const rows = db.prepare(THREAD_SELECT).all(cardId, limit) as Array<{ thread_id: string }>;
      return rows.map((row) => row.thread_id);
    },
    ledgerCardId(threadId: string) {
      const row = db.prepare(OWNER_SELECT).get(threadId) as { card_id: string } | undefined;
      return row ? row.card_id : null;
    },
    deleteCard: (cardId: string) => {
      db.prepare("DELETE FROM card_threads WHERE card_id = ?").run(cardId);
    },
  };
}

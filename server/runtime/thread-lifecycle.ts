import type { BbPluginApi } from "@get-bb/plugin-sdk";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type ThreadEvent = { thread: { id: string } };

type ThreadLifecycleDeps = {
  db: Db;
  syncThreadState: (cardId: string) => Promise<void>;
  applyFailed: (cardId: string, threadId: string, error: string | null) => Promise<void>;
};

function liveCardId(db: Db, threadId: string): string | null {
  const row = db.prepare(
    "SELECT id FROM cards WHERE worker_thread_id = ? AND status != 'archived'",
  ).get(threadId) as { id: string } | undefined;
  return row?.id ?? null;
}

export function registerThreadLifecycle(bb: BbPluginApi, deps: ThreadLifecycleDeps) {
  const syncFromEvent = ({ thread }: ThreadEvent) => {
    const cardId = liveCardId(deps.db, thread.id);
    if (cardId) void deps.syncThreadState(cardId);
  };
  const failFromEvent = ({ thread, error }: ThreadEvent & { error?: unknown }) => {
    const cardId = liveCardId(deps.db, thread.id);
    if (!cardId) return;
    void deps.applyFailed(cardId, thread.id, typeof error === "string" ? error : null);
  };

  bb.events.on("thread.idle", syncFromEvent);
  bb.events.on("thread.active", syncFromEvent);
  bb.events.on("thread.failed", failFromEvent);

  return { syncFromEvent, failFromEvent };
}

export function reconcileLiveCardsOnStartup(db: Db, syncThreadState: (cardId: string) => Promise<void>) {
  const rows = db.prepare(
    "SELECT id FROM cards WHERE worker_thread_id IS NOT NULL AND status != 'archived'",
  ).all() as Array<{ id: string }>;
  for (const row of rows) void syncThreadState(row.id);
  return rows.length;
}

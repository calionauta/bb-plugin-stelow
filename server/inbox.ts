import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  ensureInboxResolvedReasonColumn,
  ensureInboxSeverityColumns,
  insertInboxEvent,
  listInboxEvents,
  markQuestionsAnswered,
  resolveActionInboxEvents,
  syncQuestionInboxEvents,
  type InboxEventInput,
  type InboxResolutionReason,
} from "../lib/inbox-events.mjs";
import { parseSeverityReasons } from "../lib/inbox-severity.mjs";
import { normalizeKind } from "../lib/tracks.mjs";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type Publish = (
  event: string,
  payload: Record<string, unknown>,
) => void;
type InboxKind = InboxEventInput["kind"];
type ActionKind = Exclude<InboxKind, "completed">;

type InboxEventRow = {
  id: string;
  card_id: string;
  kind: InboxKind;
  summary: string;
  occurred_at: number;
  read_at: number | null;
  archived_at: number | null;
  resolved_at: number | null;
  resolved_reason: string | null;
  severity: number | null;
  severity_reasons: string | null;
};

const RESOLUTION_REASONS = [
  "answered",
  "superseded",
  "resumed",
  "completed",
  "archived",
] as const;

const inboxEventSnapshotSchema = z.object({
  id: z.string(),
  kind: z.enum(["question", "error", "paused", "completed"]),
  summary: z.string(),
  occurredAt: z.number(),
  resolvedAt: z.number().nullable(),
  resolvedReason: z.enum(RESOLUTION_REASONS).nullable(),
  archivedAt: z.number().nullable(),
  severity: z.number(),
  severityReasons: z.array(z.string()),
});

export const inboxRpcContract = defineRpcContract({
  listNotifications: {
    experimental_description: "Inbox events: needs-attention first, then completions, history, archived",
    input: z.object({ includeArchived: z.boolean().default(false) }).strict(),
    output: z.object({
      notifications: z.array(inboxEventSnapshotSchema.extend({
        cardId: z.string(),
        cardName: z.string(),
        projectName: z.string(),
        cardKind: z.enum(["build", "research", "explore"]),
        readAt: z.number().nullable(),
      })),
    }),
  },
  markNotificationRead: {
    experimental_description: "Mark one inbox event read",
    input: z.object({ notificationId: z.string() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  markCardNotificationsRead: {
    experimental_description: "Mark a card's events of one kind read",
    input: z.object({
      cardId: z.string(),
      kind: z.enum(["question", "error", "paused", "completed"]),
    }).strict(),
    output: z.object({ marked: z.boolean() }),
  },
  archiveNotification: {
    experimental_description: "Archive one inbox event",
    input: z.object({ notificationId: z.string() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  restoreNotification: {
    experimental_description: "Restore an archived inbox event to history",
    input: z.object({ notificationId: z.string() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  getNotification: {
    experimental_description: "One inbox event for a card",
    input: z.object({ notificationId: z.string(), cardId: z.string() }).strict(),
    output: z.object({ notification: inboxEventSnapshotSchema.nullable() }),
  },
});

export function runInboxMigrations(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS inbox_events (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('question','error','paused','completed')),
    summary TEXT NOT NULL,
    dedupe_key TEXT NOT NULL UNIQUE,
    occurred_at INTEGER NOT NULL,
    read_at INTEGER,
    archived_at INTEGER,
    resolved_at INTEGER,
    resolved_reason TEXT,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_inbox_events_visible
    ON inbox_events(archived_at, occurred_at DESC);`);
  const columns = db.prepare("PRAGMA table_info(inbox_events)").all() as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === "resolved_at")) {
    db.exec("ALTER TABLE inbox_events ADD COLUMN resolved_at INTEGER");
  }
  ensureInboxResolvedReasonColumn(db);
  ensureInboxSeverityColumns(db);
  db.prepare(`
    DELETE FROM inbox_events
    WHERE kind = 'completed'
      AND summary = 'Completed. Review the final outcome.'
      AND card_id IN (SELECT id FROM cards WHERE kind = 'research')
  `).run();
}

function resolutionReason(value: string | null): InboxResolutionReason | null {
  return RESOLUTION_REASONS.includes(value as InboxResolutionReason)
    ? value as InboxResolutionReason
    : null;
}

function snapshot(row: InboxEventRow) {
  return {
    id: row.id,
    kind: row.kind,
    summary: row.summary,
    occurredAt: row.occurred_at,
    resolvedAt: row.resolved_at,
    resolvedReason: resolutionReason(row.resolved_reason),
    archivedAt: row.archived_at,
    severity: row.severity ?? 1,
    severityReasons: parseSeverityReasons(row.severity_reasons),
  };
}

export interface InboxServerDeps {
  db: Db;
  now: () => number;
  randomId: (prefix: string) => string;
  publish: Publish;
  listProjects: () => Promise<Array<{ id: string; name: string }>>;
}

type InboxContext = Pick<InboxServerDeps, "db" | "now" | "randomId"> & {
  changed: (payload: Record<string, unknown>) => void;
};

function createRecorder(ctx: InboxContext) {
  return (
    card: { id: string },
    kind: InboxKind,
    summary: string,
    dedupeKey: string,
    occurredAt: number,
  ) => {
    const inserted = insertInboxEvent(ctx.db, {
      id: ctx.randomId("evt"),
      cardId: card.id,
      kind,
      summary,
      dedupeKey,
      occurredAt,
    });
    if (inserted) ctx.changed({ cardId: card.id });
  };
}

function createResolver(ctx: InboxContext) {
  return (
    cardId: string,
    resolvedAt: number,
    kinds: ActionKind[] = ["question", "error", "paused"],
    reason: InboxResolutionReason | null = null,
  ) => {
    if (resolveActionInboxEvents(ctx.db, cardId, resolvedAt, kinds, reason) > 0) {
      ctx.changed({ cardId });
    }
  };
}

function createQuestionSync(ctx: InboxContext) {
  return (cardId: string, interactionIds: string[], occurredAt = ctx.now()) => {
    const result = syncQuestionInboxEvents(ctx.db, {
      cardId,
      interactionIds,
      occurredAt,
      createId: () => ctx.randomId("evt"),
      summary: "The agent is waiting for your answer to continue.",
    });
    const fields = ["inserted", "resolved", "reopened", "pausedSuperseded"] as const;
    if (fields.some((field) => result[field] > 0)) ctx.changed({ cardId });
  };
}

function createAnswerMarker(ctx: InboxContext) {
  return (cardId: string, interactionIds: string[]) =>
    markQuestionsAnswered(ctx.db, {
      cardId,
      interactionIds,
      occurredAt: ctx.now(),
    });
}

function createListHandler(ctx: InboxContext, deps: InboxServerDeps) {
  return async ({ includeArchived }: { includeArchived: boolean }) => {
    const rows = listInboxEvents(ctx.db, includeArchived) as Array<
      InboxEventRow & {
        display_name: string | null;
        name: string;
        project_id: string;
        card_kind: string | null;
      }
    >;
    const projects = await deps.listProjects();
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));
    return {
      notifications: rows.map((row) => ({
        cardId: row.card_id,
        cardName: row.display_name ?? row.name,
        projectName: projectNames.get(row.project_id) ?? row.project_id,
        cardKind: normalizeKind(row.card_kind),
        readAt: row.read_at,
        ...snapshot(row),
      })),
    };
  };
}

function changedUpdate(
  ctx: InboxContext,
  sql: string,
  values: unknown[],
  payload: Record<string, unknown>,
) {
  const result = ctx.db.prepare(sql).run(...values);
  if (result.changes > 0) ctx.changed(payload);
  return result.changes > 0;
}

function createEventUpdateHandler(
  ctx: InboxContext,
  sql: string,
  notificationIdFirst: boolean,
) {
  return async ({ notificationId }: { notificationId: string }) => {
    const values = notificationIdFirst
      ? [ctx.now(), notificationId]
      : [notificationId];
    const changed = changedUpdate(ctx, sql, values, { notificationId });
    return { ok: changed };
  };
}

function createReadHandler(ctx: InboxContext) {
  return createEventUpdateHandler(
    ctx,
    "UPDATE inbox_events SET read_at = ? WHERE id = ? AND read_at IS NULL",
    true,
  );
}

function createCardReadHandler(ctx: InboxContext) {
  return async ({ cardId, kind }: { cardId: string; kind: InboxKind }) => {
    if (kind !== "completed") return { marked: false };
    const changed = changedUpdate(
      ctx,
      `UPDATE inbox_events SET read_at = ?
       WHERE card_id = ? AND kind = 'completed'
         AND read_at IS NULL AND archived_at IS NULL`,
      [ctx.now(), cardId],
      { cardId },
    );
    return { marked: changed };
  };
}

function createArchiveHandler(ctx: InboxContext) {
  return createEventUpdateHandler(
    ctx,
    "UPDATE inbox_events SET archived_at = ? WHERE id = ? AND archived_at IS NULL",
    true,
  );
}

function createRestoreHandler(ctx: InboxContext) {
  return createEventUpdateHandler(
    ctx,
    "UPDATE inbox_events SET archived_at = NULL WHERE id = ? AND archived_at IS NOT NULL",
    false,
  );
}

function createGetHandler(ctx: InboxContext) {
  return async ({ notificationId, cardId }: { notificationId: string; cardId: string }) => {
    const row = ctx.db.prepare(`
      SELECT id, kind, summary, occurred_at, resolved_at, resolved_reason,
        archived_at, severity, severity_reasons
      FROM inbox_events WHERE id = ? AND card_id = ?
    `).get(notificationId, cardId) as InboxEventRow | undefined;
    return { notification: row ? snapshot(row) : null };
  };
}

function createInboxHandlers(ctx: InboxContext, deps: InboxServerDeps) {
  return {
    listNotifications: createListHandler(ctx, deps),
    markNotificationRead: createReadHandler(ctx),
    markCardNotificationsRead: createCardReadHandler(ctx),
    archiveNotification: createArchiveHandler(ctx),
    restoreNotification: createRestoreHandler(ctx),
    getNotification: createGetHandler(ctx),
  };
}

export function createInboxServer(deps: InboxServerDeps) {
  const ctx: InboxContext = {
    db: deps.db,
    now: deps.now,
    randomId: deps.randomId,
    changed: (payload) => deps.publish("inbox-changed", payload),
  };
  return {
    handlers: createInboxHandlers(ctx, deps),
    record: createRecorder(ctx),
    resolve: createResolver(ctx),
    syncPendingQuestion: createQuestionSync(ctx),
    markAnswered: createAnswerMarker(ctx),
  };
}

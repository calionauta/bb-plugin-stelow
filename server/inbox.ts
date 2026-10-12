import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  ensureInboxResolvedReasonColumn,
  ensureInboxSeverityColumns,
  insertInboxEvent,
  listInboxEvents,
  markQuestionsAnswered,
  resolveActionInboxEvents,
  resolveAllInboxEvents,
  upsertPausedEvent,
  syncQuestionInboxEvents,
  type InboxEventInput,
  type InboxResolutionReason,
} from "../lib/inbox-events.mjs";
import {
  ensureInboxOccurrencesColumn,
  recordErrorInboxEvent,
} from "../lib/inbox-error-event.mjs";
import { parseSeverityReasons } from "../lib/inbox-severity.mjs";
import { ensureColumns } from "../lib/sqlite-columns.mjs";
import { normalizeKind } from "../lib/tracks.mjs";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type Publish = (
  event: string,
  payload: Record<string, unknown>,
) => void;
type InboxKind = InboxEventInput["kind"];
// The kinds a person can still act on. `completed` is excluded on purpose: it
// is a review request, not an open action, so the action resolver leaves it
// alone and the terminal resolver is the one that closes it.
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
  holder_card_id: string | null;
  holder_file: string | null;
};


// The reasons a resolution can carry, in the order the contract declares them.
// Duplicated from inbox-contract deliberately: a runtime constant and a zod
// enum are different things, and importing one from the other would make the
// schema a runtime dependency of every reader of a resolution reason.
const RESOLUTION_REASONS = [
  "answered",
  "superseded",
  "resumed",
  "completed",
  "archived",
] as const;

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
  // The holder of a blocked file, as identity rather than prose. A summary can
  // only be read; a card id can be opened. Both columns are written together
  // from one record (lib/lock-blocked), so the sentence and the affordance can
  // never name different cards.
  ensureColumns(db, "inbox_events", [
    ["holder_card_id", "TEXT"],
    ["holder_file", "TEXT"],
  ]);
  ensureInboxSeverityColumns(db);
  ensureInboxOccurrencesColumn(db);
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
    holderCardId: row.holder_card_id ?? null,
    holderFile: row.holder_file ?? null,
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

/**
 * Record an inbox event.
 *
 * `holder` is the optional second fact an event can carry: which card is
 * holding the file, and which file. It is a separate argument rather than
 * something parsed back out of the summary, because a sentence can only be
 * read while an id can be opened — and a caller that had to re-extract the
 * holder from prose to build a link would eventually get it wrong.
 */
function createRecorder(ctx: InboxContext) {
  return (
    card: { id: string },
    kind: InboxKind,
    summary: string,
    dedupeKey: string,
    occurredAt: number,
    holder: { cardId: string; file: string } | null = null,
  ) => {
    const inserted = insertInboxEvent(ctx.db, {
      id: ctx.randomId("evt"),
      cardId: card.id,
      kind,
      summary,
      dedupeKey,
      occurredAt,
      holder,
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

/**
 * The terminal resolver, for a card whose life has ended. It reaches
 * `completed` too — see resolveAllInboxEvents for why an archived card must
 * not keep asking for a review nobody can perform.
 */
function createTerminalResolver(ctx: InboxContext) {
  return (cardId: string, resolvedAt: number, reason: InboxResolutionReason | null = null) => {
    if (resolveAllInboxEvents(ctx.db, cardId, resolvedAt, reason) > 0) {
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

// The other half of read state, and the reason the button on an item can be
// reversible. Clearing `read_at` returns the update to attention — which
// `archived_at` deliberately does not, because archive is how a person keeps
// an item out of the way for good and `restoreNotification` is its only exit.
function createUnreadHandler(ctx: InboxContext) {
  return createEventUpdateHandler(
    ctx,
    "UPDATE inbox_events SET read_at = NULL WHERE id = ? AND read_at IS NOT NULL",
    false,
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
        archived_at, severity, severity_reasons, holder_card_id, holder_file
      FROM inbox_events WHERE id = ? AND card_id = ?
    `).get(notificationId, cardId) as InboxEventRow | undefined;
    return { notification: row ? snapshot(row) : null };
  };
}

function createInboxHandlers(ctx: InboxContext, deps: InboxServerDeps) {
  return {
    listNotifications: createListHandler(ctx, deps),
    markNotificationRead: createReadHandler(ctx),
    markNotificationUnread: createUnreadHandler(ctx),
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
    // One open paused row per card, refreshed rather than duplicated — see
    // lib/inbox-events upsertPausedEvent for why a stream of identical rows
    // for a single stuck card is inflation, not attention.
    upsertPaused: (cardId: string, summary: string, idleAt: number) => {
      const touched = upsertPausedEvent(ctx.db, {
        cardId,
        summary,
        idleAt,
        nowMs: ctx.now(),
        createId: () => ctx.randomId("evt"),
      });
      if (touched) ctx.changed({ cardId });
    },
    // One open error row per card, for the same reason as upsertPaused: a
    // worker that keeps failing is one thing to look at, not one thing per
    // failure. Differs in the two ways the kind demands — it reopens a resolved
    // row (a failure after someone dealt with the last one is a NEW need, and
    // INSERT OR IGNORE would drop it), and it counts occurrences (the badge
    // needs the repetition, and counting rows would only measure the bug).
    recordError: (cardId: string, summary: string, occurredAt: number) => {
      const result = recordErrorInboxEvent(ctx.db, {
        id: ctx.randomId("evt"),
        cardId,
        kind: "error",
        summary,
        occurredAt,
      });
      ctx.changed({ cardId });
      return result;
    },
    resolve: createResolver(ctx),
    resolveAll: createTerminalResolver(ctx),
    syncPendingQuestion: createQuestionSync(ctx),
    markAnswered: createAnswerMarker(ctx),
  };
}

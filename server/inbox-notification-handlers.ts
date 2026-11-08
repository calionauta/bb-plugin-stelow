import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { InboxEventInput } from "../lib/inbox-events.mjs";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type InboxKind = InboxEventInput["kind"];

/**
 * The slice of the inbox context the per-notification writes read. Narrower
 * than the full context so this module never reaches for the recorder's clock
 * or id source, which its own conditional updates do not use.
 */
export type InboxUpdateContext = {
  db: Db;
  now: () => number;
  changed: (payload: Record<string, unknown>) => void;
};

function changedUpdate(
  ctx: InboxUpdateContext,
  sql: string,
  values: unknown[],
  payload: Record<string, unknown>,
) {
  const result = ctx.db.prepare(sql).run(...values);
  if (result.changes > 0) ctx.changed(payload);
  return result.changes > 0;
}

/**
 * One conditional single-row write, parameterized by the SQL and whether the
 * notification id is the first or last bind value. Read, unread, archive and
 * restore differ only in that SQL, so they share this body rather than four
 * copies of parse-then-publish.
 */
function createEventUpdateHandler(
  ctx: InboxUpdateContext,
  sql: string,
  notificationIdFirst: boolean,
) {
  const input = z.object({ notificationId: z.string().min(1) }).strict();
  return async (raw: { notificationId: string }) => {
    const { notificationId } = input.parse(raw);
    const values = notificationIdFirst
      ? [ctx.now(), notificationId]
      : [notificationId];
    const changed = changedUpdate(ctx, sql, values, { notificationId });
    return { ok: changed };
  };
}

export function createReadHandler(ctx: InboxUpdateContext) {
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
export function createUnreadHandler(ctx: InboxUpdateContext) {
  return createEventUpdateHandler(
    ctx,
    "UPDATE inbox_events SET read_at = NULL WHERE id = ? AND read_at IS NOT NULL",
    false,
  );
}

export function createCardReadHandler(ctx: InboxUpdateContext) {
  const input = z.object({
    cardId: z.string().min(1),
    kind: z.enum(["question", "error", "paused", "completed"]),
  }).strict();
  return async (raw: { cardId: string; kind: InboxKind }) => {
    const { cardId, kind } = input.parse(raw);
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

export function createArchiveHandler(ctx: InboxUpdateContext) {
  return createEventUpdateHandler(
    ctx,
    "UPDATE inbox_events SET archived_at = ? WHERE id = ? AND archived_at IS NULL",
    true,
  );
}

export function createRestoreHandler(ctx: InboxUpdateContext) {
  return createEventUpdateHandler(
    ctx,
    "UPDATE inbox_events SET archived_at = NULL WHERE id = ? AND archived_at IS NOT NULL",
    false,
  );
}

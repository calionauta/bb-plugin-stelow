/**
 * The inbox's wire shapes.
 *
 * Data only — no database, no clock, no publisher. `server/inbox.ts` owns the
 * behaviour and imports this, so the contract can be read, reviewed and
 * changed without reading 300 lines of SQLite to find out what a client is
 * promised. Same split the card, lifecycle and scope-map contracts already use.
 */
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

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
        // Which card is holding a file this one is waiting on. Present only on
        // a lock block; the inbox row turns it into a link instead of asking a
        // reader to match a display name against a board.
        holderCardId: z.string().nullable(),
        holderFile: z.string().nullable(),
      })),
    }),
  },
  markNotificationRead: {
    experimental_description: "Mark one inbox event read",
    input: z.object({ notificationId: z.string() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  markNotificationUnread: {
    experimental_description: "Mark one inbox event unread, so it returns to attention",
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


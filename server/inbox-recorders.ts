/**
 * The inbox's recorders: the attention rows it opens (paused, error) and the
 * two that mirror a question's lifecycle onto a card.
 *
 * They live apart from the inbox factory because they answer a different
 * question than the rest of it: the factory reads and mutates rows, while these
 * only decide WHEN a row is owed. Keeping them in one file is what lets the
 * sync semantics (explicit empty, reopened rows, superseded pauses) be read in
 * one place.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ActionRecorder } from "./runtime/action-log-runtime.js";
import {
  markQuestionsAnswered,
  QUESTION_WAITING_SUMMARY,
  syncQuestionInboxEvents,
  upsertPausedEvent,
} from "../lib/inbox-events.mjs";
import { recordErrorInboxEvent } from "../lib/inbox-error-event.mjs";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export type InboxQuestionContext = {
  db: Db;
  now: () => number;
  randomId: (prefix: string) => string;
  changed: (payload: Record<string, unknown>) => void;
};

export function createQuestionSync(ctx: InboxQuestionContext) {
  // `questionSummary` / `questionCount` are optional so every existing caller
  // keeps working: a caller that cannot name the question still mints the row
  // it used to, and the row falls back to the generic sentence at read time.
  return (
    cardId: string,
    interactionIds: string[],
    occurredAt = ctx.now(),
    question: { summary?: string | null; count?: number | null; kind?: string | null } = {},
  ) => {
    // explicitEmpty: every caller of this wrapper verified its read first —
    // question-inbox returns null (skip) on a failed poll rather than [],
    // and the answer door passes its own verified open set. An empty list
    // here means "looked, nothing open", never "the read failed".
    const result = syncQuestionInboxEvents(ctx.db, {
      cardId,
      interactionIds,
      occurredAt,
      createId: () => ctx.randomId("evt"),
      summary: QUESTION_WAITING_SUMMARY,
      questionSummary: question.summary ?? null,
      questionCount: question.count ?? null,
      questionKind: question.kind === "split" ? "split" : null,
      explicitEmpty: true,
    });
    const fields = ["inserted", "resolved", "reopened", "pausedSuperseded"] as const;
    if (fields.some((field) => result[field] > 0)) ctx.changed({ cardId });
  };
}

export function createAnswerMarker(ctx: InboxQuestionContext) {
  return (cardId: string, interactionIds: string[]) => {
    // The answer door resolved the rows; without a publish the clearance is
    // invisible until the next 45s tick or thread event mints something else.
    // Publish only when rows actually resolved — a silent answer (unknown
    // ids) stays silent instead of churning every badge on the board.
    if (markQuestionsAnswered(ctx.db, { cardId, interactionIds, occurredAt: ctx.now() }) > 0) {
      ctx.changed({ cardId });
    }
  };
}

/**
 * The two standing-condition rows. One open row per card, refreshed rather than
 * duplicated: a worker that keeps failing, or a card that keeps idling, is one
 * thing to look at, not one thing per occurrence. The action log therefore gets
 * one row with `occurrences` as well — the same collapse, recorded once on each
 * surface instead of twice on the card.
 */
export function createAttentionRecorders(ctx: InboxQuestionContext & { actions?: ActionRecorder }) {
  return {
    upsertPaused: (cardId: string, summary: string, idleAt: number) => {
      const touched = upsertPausedEvent(ctx.db, {
        cardId,
        summary,
        idleAt,
        nowMs: ctx.now(),
        createId: () => ctx.randomId("evt"),
      });
      if (!touched) return;
      ctx.changed({ cardId });
      ctx.actions?.record({
        kind: "inbox.opened",
        outcome: "ok",
        cause: "inbox.paused",
        cardId,
        detail: { idleAt },
      });
    },
    // One open error row per card, for the same reason as upsertPaused. It
    // differs in the two ways the kind demands — it reopens a resolved row (a
    // failure after someone dealt with the last one is a NEW need), and it
    // counts occurrences (the badge needs the repetition).
    recordError: (cardId: string, summary: string, occurredAt: number) => {
      const result = recordErrorInboxEvent(ctx.db, {
        id: ctx.randomId("evt"),
        cardId,
        kind: "error",
        summary,
        occurredAt,
      });
      ctx.changed({ cardId });
      ctx.actions?.record({
        kind: "inbox.opened",
        outcome: "ok",
        cause: "inbox.error",
        cardId,
        detail: { summary: summary.slice(0, 200) },
      });
      return result;
    },
  };
}

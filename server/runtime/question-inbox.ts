/**
 * The card's open questions, as the host sees them.
 *
 * A question is open when a pending plugin interaction or an unanswered
 * expired question says so, and the inbox mirrors exactly that set. A failed
 * interaction read is UNKNOWN, not proof that a question disappeared, so
 * these reads return null rather than an empty list and callers keep the
 * state they already had — a question must never vanish because a poll
 * hiccuped.
 */
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import type { WorkerCard } from "../workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

/** Pending plugin interactions (stelow asks), narrowed so payload/title read. */
export type PendingAsk = Extract<
  Awaited<
    ReturnType<BbPluginApi["sdk"]["threads"]["interactions"]["list"]>
  >[number],
  { origin: { kind: "plugin" } }
>;

export type QuestionInboxDeps = {
  bb: BbPluginApi;
  db: Db;
  syncPendingQuestionInbox: (
    card: WorkerCard,
    interactionIds: string[],
  ) => void;
};

export function createQuestionInbox(deps: QuestionInboxDeps) {
  /** Expired questions awaiting an answer, in expiry order. */
  function openExpiredQuestionIds(cardId: string): string[] {
    return (
      deps.db
        .prepare(
          "SELECT id FROM expired_questions WHERE card_id = ? AND answered = 0 ORDER BY expired_at ASC",
        )
        .all(cardId) as Array<{ id: string }>
    ).map((row) => `expired:${row.id}`);
  }

  function pendingAsks(
    list: Awaited<
      ReturnType<BbPluginApi["sdk"]["threads"]["interactions"]["list"]>
    >,
  ): PendingAsk[] {
    return list.filter(
      (entry): entry is PendingAsk =>
        entry.origin?.kind === "plugin" && entry.status === "pending",
    );
  }

  /** The card's live asks, or null when the host could not be asked. */
  async function fetchPendingAsks(
    threadId: string | null,
  ): Promise<PendingAsk[] | null> {
    if (!threadId) return [];
    try {
      return pendingAsks(
        await deps.bb.sdk.threads.interactions.list({ threadId }),
      );
    } catch {
      // A failed read is unknown, not proof that a question disappeared.
      // Callers must preserve the existing question state in this case.
      return null;
    }
  }

  /** Sync the inbox to the card's open questions and report their ids. */
  async function syncOpenQuestionInbox(
    card: WorkerCard,
  ): Promise<string[] | null> {
    const active = await fetchPendingAsks(card.worker_thread_id);
    if (active === null) return null;
    const questionIds = [
      ...active.map((entry) => entry.id),
      ...openExpiredQuestionIds(card.id),
    ];
    deps.syncPendingQuestionInbox(card, questionIds);
    return questionIds;
  }

  /** Whether the card still owes the user an answer; unknown reads as open. */
  function hasOpenQuestions(
    cardId: string,
    questionIds: string[] | null,
  ): boolean {
    return questionIds !== null
      ? questionIds.length > 0
      : openExpiredQuestionIds(cardId).length > 0;
  }

  return {
    openExpiredQuestionIds,
    pendingAsks,
    fetchPendingAsks,
    syncOpenQuestionInbox,
    hasOpenQuestions,
  };
}

export type QuestionInbox = ReturnType<typeof createQuestionInbox>;

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

function openExpiredQuestionIds(
  deps: QuestionInboxDeps,
  cardId: string,
): string[] {
  return (
    deps.db
      .prepare(
        "SELECT id FROM expired_questions WHERE card_id = ? AND answered = 0 ORDER BY expired_at ASC",
      )
      .all(cardId) as Array<{ id: string }>
  ).map((row) => `expired:${row.id}`);
}
function pendingAsks(
  deps: QuestionInboxDeps,
  list: Awaited<
    ReturnType<BbPluginApi["sdk"]["threads"]["interactions"]["list"]>
  >,
): PendingAsk[] {
  return list.filter(
    (entry): entry is PendingAsk =>
      entry.origin?.kind === "plugin" && entry.status === "pending",
  );
}
async function fetchPendingAsks(
  deps: QuestionInboxDeps,
  threadId: string | null,
): Promise<PendingAsk[] | null> {
  if (!threadId) return [];
  try {
    return pendingAsks(
      deps,
      await deps.bb.sdk.threads.interactions.list({ threadId }),
    );
  } catch {
    // A failed read is unknown, not proof that a question disappeared.
    // Callers must preserve the existing question state in this case.
    return null;
  }
}
async function syncOpenQuestionInbox(
  deps: QuestionInboxDeps,
  card: WorkerCard,
): Promise<string[] | null> {
  const active = await fetchPendingAsks(deps, card.worker_thread_id);
  if (active === null) return null;
  const questionIds = [
    ...active.map((entry) => entry.id),
    ...openExpiredQuestionIds(deps, card.id),
  ];
  deps.syncPendingQuestionInbox(card, questionIds);
  return questionIds;
}
function hasOpenQuestions(
  deps: QuestionInboxDeps,
  cardId: string,
  questionIds: string[] | null,
): boolean {
  return questionIds !== null
    ? questionIds.length > 0
    : openExpiredQuestionIds(deps, cardId).length > 0;
}

export function createQuestionInbox(deps: QuestionInboxDeps) {
  return {
    openExpiredQuestionIds: openExpiredQuestionIds.bind(null, deps),
    pendingAsks: pendingAsks.bind(null, deps),
    fetchPendingAsks: fetchPendingAsks.bind(null, deps),
    syncOpenQuestionInbox: syncOpenQuestionInbox.bind(null, deps),
    hasOpenQuestions: hasOpenQuestions.bind(null, deps),
  };
}

export type QuestionInbox = ReturnType<typeof createQuestionInbox>;

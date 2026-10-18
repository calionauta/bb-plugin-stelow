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
import type { QuestionCount } from "../../lib/question-store.mjs";
import { expiredQuestionId } from "../../lib/question-evidence.mjs";
import { expandInteractionQuestions } from "../../lib/question-batch.mjs";
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
    question?: { summary?: string | null; count?: number | null; kind?: string | null },
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
  ).map((row) => expiredQuestionId(row.id));
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
/**
 * The single question line an Inbox row shows, plus how many it covers.
 *
 * A row used to show only the generic wait sentence, so two question rows were
 * indistinguishable until you opened one. The description is the card's
 * original request, not the question, so the missing fact was the ask itself:
 * this takes the first pending question's own text.
 *
 * `expandInteractionQuestions` is reused rather than re-read here because it
 * already understands both payload shapes and drops malformed entries instead
 * of throwing. The expired batch is represented by its prompt too, so a row
 * whose only open items timed out still names what it is about.
 */
function questionLine(
  deps: QuestionInboxDeps,
  card: WorkerCard,
  active: PendingAsk[],
  expired: string[],
): { summary: string | null; count: number; kind: string | null } {
  const expanded = active.flatMap((entry) => expandInteractionQuestions(entry));
  const first = expanded.find((question) => question.question.trim().length > 0)?.question ?? null;
  let expiredLine: string | null = null;
  if (first === null && expired.length > 0) {
    try {
      const row = deps.db
        .prepare("SELECT question FROM expired_questions WHERE card_id = ? AND answered = 0 ORDER BY expired_at ASC LIMIT 1")
        .get(card.id) as { question?: string } | undefined;
      expiredLine = typeof row?.question === "string" && row.question.trim() ? row.question : null;
    } catch {
      // A read that cannot answer is better than a row that invents one.
      expiredLine = null;
    }
  }
  // `kind` gates the narrow door: a split answer creates child cards, which is
  // a card-scoped consequence, so the row must not offer the shortcut for it.
  const split = expanded.some((question) => question.kind === "split");
  const count = expanded.length > 0 ? expanded.length : expired.length;
  return { summary: first ?? expiredLine, count: count > 0 ? count : 0, kind: split ? "split" : null };
}

async function syncOpenQuestionInbox(
  deps: QuestionInboxDeps,
  card: WorkerCard,
): Promise<string[] | null> {
  const active = await fetchPendingAsks(deps, card.worker_thread_id);
  if (active === null) return null;
  const expired = openExpiredQuestionIds(deps, card.id);
  const questionIds = [
    ...active.map((entry) => entry.id),
    ...expired,
  ];
  deps.syncPendingQuestionInbox(card, questionIds, questionLine(deps, card, active, expired));
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

/**
 * How many questions a card is waiting on, split by where they are: a live
 * BB interaction, or an unanswered recovery row answerable on the card.
 *
 * This is the read-only answer to "is anything waiting on me?". On
 * card_48uuhus1 a worker had no way to ask that question without interrupting
 * a human, so it fired `--question "ping"` and got one. Returns null when the
 * live read fails — the same rule as everywhere else here: an unknown is not
 * a zero, and a zero would look like "go ahead and work".
 */
async function countOpenQuestions(
  deps: QuestionInboxDeps,
  cards: Array<{ id: string; worker_thread_id: string | null }>,
): Promise<Map<string, QuestionCount> | null> {
  const counts = new Map<string, QuestionCount>();
  for (const card of cards) {
    const expired = openExpiredQuestionIds(deps, card.id).length;
    const live = card.worker_thread_id
      ? await fetchPendingAsks(deps, card.worker_thread_id)
      : [];
    if (live === null) return null;
    counts.set(card.id, { expired, live: live.length });
  }
  return counts;
}

export function createQuestionInbox(deps: QuestionInboxDeps) {
  return {
    openExpiredQuestionIds: openExpiredQuestionIds.bind(null, deps),
    pendingAsks: pendingAsks.bind(null, deps),
    fetchPendingAsks: fetchPendingAsks.bind(null, deps),
    syncOpenQuestionInbox: syncOpenQuestionInbox.bind(null, deps),
    hasOpenQuestions: hasOpenQuestions.bind(null, deps),
    countOpenQuestions: countOpenQuestions.bind(null, deps),
  };
}

export type QuestionInbox = ReturnType<typeof createQuestionInbox>;

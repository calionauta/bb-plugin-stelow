import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { consumeAskContract } from "../../lib/ask-contracts.mjs";
import { cleanAnswerList } from "../../lib/expired-question-answers.mjs";
import { expandInteractionQuestions, formatBatchContinuation, groupBatchAnswers } from "../../lib/question-batch.mjs";
import { recordSplitAnswer } from "../../lib/split-proposal.mjs";
import type { WorkerCard } from "../workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type Answer = { questionId: string; answers: string[] };
type Decision = { question: string; answers: string[] };
type PendingAsk = { id: string; payload?: { title?: string } };
type Result = { ok: boolean; answered: number; error: string | null };
type OpenRow = { id: string; thread_id: string; question: string };
type AnswerRow = OpenRow & { answers: string[] };

type QuestionAnswersDeps = {
  bb: BbPluginApi;
  db: Db;
  errors: { cardNotFound: string; cardArchived: string };
  getCard: (cardId: string) => WorkerCard | undefined;
  isArchivedCard: (card: WorkerCard) => boolean;
  pendingAsks: (threadId: string) => Promise<PendingAsk[]>;
  openExpiredQuestionIds: (cardId: string) => string[];
  syncPendingQuestionInbox: (card: WorkerCard, ids: string[]) => void;
  syncOpenQuestionInbox: (card: WorkerCard) => Promise<string[] | null>;
  markInboxQuestionsAnswered: (cardId: string, ids: string[]) => void;
  recordSplitAnswer: typeof recordSplitAnswer;
  consumeAskContract: typeof consumeAskContract;
  logCardComment: (
    cardId: string,
    targetType: string,
    targetId: string,
    actor: "user" | "agent",
    body: string,
  ) => void;
  updateCard: (cardId: string, fields: Record<string, unknown>) => void;
  hasOpenQuestions: (cardId: string, ids: string[] | null) => boolean;
};

function refusal(error: string): Result {
  return { ok: false, answered: 0, error };
}

function questionText(asks: PendingAsk[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const ask of asks) {
    const expanded = expandInteractionQuestions({
      id: ask.id,
      title: ask.payload?.title,
      payload: ask.payload,
    });
    for (const item of expanded) result.set(item.questionId, item.question);
  }
  return result;
}

async function respondToLiveAsks(
  deps: QuestionAnswersDeps,
  card: WorkerCard,
  answers: Answer[],
): Promise<{ decisions: Decision[]; answeredIds: Set<string>; pendingIds: string[] }> {
  const asks = await deps.pendingAsks(card.worker_thread_id!);
  const pendingIds = asks.map((ask) => ask.id);
  const pending = new Set(pendingIds);
  const text = questionText(asks);
  const decisions: Decision[] = [];
  const answeredIds = new Set<string>();
  for (const [interactionId, value] of groupBatchAnswers(answers)) {
    if (!pending.has(interactionId)) continue;
    await deps.bb.sdk.threads.interactions.respond({
      threadId: card.worker_thread_id!,
      interactionId,
      value: { answers: value.answers },
    });
    answeredIds.add(interactionId);
    if (value.kind === "single") {
      decisions.push({ question: text.get(interactionId) ?? "", answers: value.answers });
    } else {
      value.answers.forEach((slot, index) => decisions.push({
        question: text.get(`${interactionId}#${index}`) ?? "",
        answers: slot,
      }));
    }
  }
  return { decisions, answeredIds, pendingIds };
}

function recordContractAnswers(
  deps: QuestionAnswersDeps,
  cardId: string,
  decisions: Decision[],
) {
  const notes: string[] = [];
  for (const decision of decisions) {
    const contract = decision.question
      ? deps.consumeAskContract(deps.db, cardId, decision.question)
      : null;
    if (contract) {
      notes.push(`Q: ${decision.question}\nA: ${decision.answers.join(", ")} [contract: ${contract}]`);
    }
  }
  if (notes.length > 0) {
    deps.logCardComment(
      cardId,
      "card",
      cardId,
      "user",
      `Answer to a pending question:\n\n${notes.join("\n\n")}`,
    );
  }
}

async function resumeFromDecisions(
  deps: QuestionAnswersDeps,
  threadId: string,
  decisions: Decision[],
) {
  await deps.bb.sdk.threads.send({
    threadId,
    mode: "auto",
    input: [{
      type: "text",
      text: formatBatchContinuation(decisions),
      mentions: [],
    }],
  });
}

async function answerQuestions(
  deps: QuestionAnswersDeps,
  input: { cardId: string; answers: Answer[] },
): Promise<Result> {
  const card = deps.getCard(input.cardId);
  if (!card?.worker_thread_id) return refusal("This card has no worker thread.");
  if (deps.isArchivedCard(card)) return refusal(deps.errors.cardArchived);
  try {
    const live = await respondToLiveAsks(deps, card, input.answers);
    if (live.decisions.length === 0) {
      return refusal("No open question awaits an answer on this card.");
    }
    deps.recordSplitAnswer(deps.db, input.cardId, live.decisions);
    await resumeFromDecisions(deps, card.worker_thread_id, live.decisions);
    const unanswered = live.pendingIds.filter((id) => !live.answeredIds.has(id));
    const openQuestionIds = [...unanswered, ...deps.openExpiredQuestionIds(input.cardId)];
    deps.markInboxQuestionsAnswered(input.cardId, [...live.answeredIds]);
    deps.syncPendingQuestionInbox(card, openQuestionIds);
    recordContractAnswers(deps, input.cardId, live.decisions);
    deps.updateCard(input.cardId, {
      activity: openQuestionIds.length > 0 ? "awaiting-answer" : "running",
      status: "in-progress",
      last_error: null,
    });
    return { ok: true, answered: live.decisions.length, error: null };
  } catch (error) {
    return refusal(error instanceof Error ? error.message : "Unable to answer the questions.");
  }
}

function openExpiredRows(deps: QuestionAnswersDeps, cardId: string): OpenRow[] {
  return deps.db.prepare(
    "SELECT id, thread_id, question FROM expired_questions WHERE card_id = ? AND answered = 0",
  ).all(cardId) as OpenRow[];
}

function answerRows(openRows: OpenRow[], answers: Answer[]): AnswerRow[] {
  const selected = new Map<string, AnswerRow>();
  for (const item of answers) {
    const row = openRows.find((entry) => entry.id === item.questionId);
    const clean = cleanAnswerList(item.answers);
    if (row && !selected.has(item.questionId) && clean.length > 0) {
      selected.set(item.questionId, { ...row, answers: clean });
    }
  }
  return [...selected.entries()].map(([id, row]) => ({ ...row, id }));
}

function commitExpiredAnswers(
  deps: QuestionAnswersDeps,
  cardId: string,
  rows: AnswerRow[],
): Decision[] {
  const decisions: Decision[] = [];
  deps.db.transaction(() => {
    for (const row of rows) {
      const contract = deps.consumeAskContract(deps.db, cardId, row.question);
      const suffix = contract ? ` (contract: ${contract})` : "";
      deps.logCardComment(
        cardId,
        "card",
        cardId,
        "user",
        `Answer to a pending question${suffix}:\n\nQ: ${row.question}\nA: ${row.answers.join(", ")}`,
      );
      deps.db.prepare(
        "UPDATE expired_questions SET answered = 1 WHERE id = ?",
      ).run(row.id);
      decisions.push({ question: row.question, answers: row.answers });
    }
  })();
  return decisions;
}

async function answerExpiredQuestions(
  deps: QuestionAnswersDeps,
  input: { cardId: string; answers: Answer[] },
): Promise<Result> {
  const card = deps.getCard(input.cardId);
  if (!card) return refusal(deps.errors.cardNotFound);
  if (deps.isArchivedCard(card)) return refusal(deps.errors.cardArchived);
  const openRows = openExpiredRows(deps, input.cardId);
  if (openRows.length === 0) return refusal("Questions not found or already answered.");
  const rows = answerRows(openRows, input.answers);
  if (rows.length !== openRows.length) {
    return refusal("Answer every pending question before submitting.");
  }
  const decisions = commitExpiredAnswers(deps, input.cardId, rows);
  deps.recordSplitAnswer(deps.db, input.cardId, decisions);
  deps.markInboxQuestionsAnswered(
    input.cardId,
    rows.map((row) => `expired:${row.id}`),
  );
  const openQuestionIds = await deps.syncOpenQuestionInbox(card);
  deps.updateCard(input.cardId, {
    activity: deps.hasOpenQuestions(input.cardId, openQuestionIds)
      ? "awaiting-answer"
      : "running",
    status: "in-progress",
    last_error: null,
  });
  deps.bb.realtime.publish("card-state", { cardId: input.cardId });
  const threadId = card.worker_thread_id ?? rows[0]?.thread_id ?? null;
  if (threadId) {
    await resumeFromDecisions(deps, threadId, decisions).catch(() => undefined);
  }
  return { ok: true, answered: decisions.length, error: null };
}

export function createQuestionAnswers(deps: QuestionAnswersDeps) {
  return {
    answerQuestions: (input: { cardId: string; answers: Answer[] }) =>
      answerQuestions(deps, input),
    answerExpiredQuestions: (input: { cardId: string; answers: Answer[] }) =>
      answerExpiredQuestions(deps, input),
  };
}

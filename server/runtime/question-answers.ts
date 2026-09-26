import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { consumeAskContract } from "../../lib/ask-contracts.mjs";
import { cleanAnswerList } from "../../lib/expired-question-answers.mjs";
import {
  answerCommentBody,
  answeredCardPatch,
  EXPIRED_QUESTION_ID_PREFIX,
  expiredQuestionId,
} from "../../lib/question-answer-recording.mjs";
import { expandInteractionQuestions, formatBatchContinuation, groupBatchAnswers } from "../../lib/question-batch.mjs";
import { recordSplitAnswer } from "../../lib/split-proposal.mjs";
import type { ExecutionRun } from "../../lib/execution-run-ledger.mjs";
import type { WorkerCard } from "../workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type Answer = { questionId: string; answers: string[] };
type Decision = { question: string; answers: string[] };
type RecordedDecision = Decision & { contract: string | null };
type PendingAsk = { id: string; payload?: { title?: string } };
type Result = { ok: boolean; answered: number; error: string | null };
type OpenRow = { id: string; thread_id: string; question: string };
type AnswerRow = OpenRow & { answers: string[] };

/**
 * The one boundary port both doors share. The execution layer is built after
 * this one, so it arrives as a reader: a door that needs the lifecycle to route
 * a native-boundary answer asks for it, and a door on a card with no run never
 * does. Binding it is the execution layer's wiring, not this module's.
 */
export type AnswerBoundaryPort = {
  /**
   * Sends the ordinary worker continuation, unless a decision is this run's own
   * native boundary — that one resumes the run instead of the thread. Returns
   * the boundary run it resumed, if any.
   */
  routeAnswerContinuation: (
    cardId: string,
    threadId: string,
    decisions: Decision[],
  ) => Promise<ExecutionRun | null>;
  /** Resumes from a boundary answer; a non-null result is a resume refusal. */
  resumeAfterAnswers: (
    run: ExecutionRun,
    decisions: Decision[],
  ) => Promise<string | null>;
};

/** A port that is not bound yet reads as undefined, and the door stays ordinary. */
export type BoundaryPortReader = {
  read: () => AnswerBoundaryPort | undefined;
};

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
  /**
   * Read at call time, never captured: the execution layer binds it after this
   * one is built. Absent (or unbound) means "no boundary here", and the answer
   * resumes the worker thread exactly as it did before native runs existed.
   */
  boundary?: BoundaryPortReader;
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
): void {
  // One recording rule for both doors (lib/question-answer-recording): every
  // answer leaves a trail, and a declared contract is named in it so a grep for
  // a satisfied contract cannot miss it.
  const trail = answerCommentBody(
    decisions.map((decision) => ({
      ...decision,
      contract: decision.question
        ? deps.consumeAskContract(deps.db, cardId, decision.question)
        : null,
    })),
  );
  if (trail) deps.logCardComment(cardId, "card", cardId, "user", trail);
}

/**
 * Resumes the worker with the batch, unless this batch answered the run's own
 * native boundary — that decision resumes the RUN, and the thread is left
 * alone. Returns a refusal when the boundary answer could not be applied.
 */
async function resumeFromDecisions(
  deps: QuestionAnswersDeps,
  cardId: string,
  threadId: string,
  decisions: Decision[],
): Promise<{ boundaryResumed: boolean; error: string | null }> {
  const port = deps.boundary?.read();
  const boundaryRun = port
    ? await port.routeAnswerContinuation(cardId, threadId, decisions)
    : null;
  if (boundaryRun && port) {
    const resumeError = await port.resumeAfterAnswers(boundaryRun, decisions);
    return { boundaryResumed: true, error: resumeError };
  }
  await deps.bb.sdk.threads.send({
    threadId,
    mode: "auto",
    input: [{
      type: "text",
      text: formatBatchContinuation(decisions),
      mentions: [],
    }],
  });
  return { boundaryResumed: false, error: null };
}

/**
 * A recovery question answered with its bare row id lands here, and the older
 * wording blamed the card for a question that was very much open. Say which id
 * space the caller wants and name the way out: a refusal without an exit is a
 * deadlock with a good error message.
 */
function noQuestionAnswered(deps: QuestionAnswersDeps, cardId: string): Result {
  const open = deps.openExpiredQuestionIds(cardId);
  if (open.length === 0) {
    return refusal("No open question awaits an answer on this card.");
  }
  return refusal(
    `That id is not a live interaction. Recovery questions use ${EXPIRED_QUESTION_ID_PREFIX}<id>. `
    + `Open: ${open.join(", ")}.`,
  );
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
    if (live.decisions.length === 0) return noQuestionAnswered(deps, input.cardId);
    deps.recordSplitAnswer(deps.db, input.cardId, live.decisions);
    const resume = await resumeFromDecisions(
      deps,
      input.cardId,
      card.worker_thread_id,
      live.decisions,
    );
    if (resume.error) {
      return { ok: false, answered: live.decisions.length, error: resume.error };
    }
    const unanswered = live.pendingIds.filter((id) => !live.answeredIds.has(id));
    const openQuestionIds = [...unanswered, ...deps.openExpiredQuestionIds(input.cardId)];
    // Name the answered ones BEFORE the sync: disappearance alone would
    // mislabel them superseded.
    deps.markInboxQuestionsAnswered(input.cardId, [...live.answeredIds]);
    deps.syncPendingQuestionInbox(card, openQuestionIds);
    recordContractAnswers(deps, input.cardId, live.decisions);
    deps.updateCard(input.cardId, answeredCardPatch(openQuestionIds.length > 0));
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

/**
 * The recovery rows this answer commits. The contract is consumed inside the
 * transaction so a half-written batch cannot claim a contract it never
 * satisfied; the trail comment waits until the rows are committed, because a
 * comment about an answer that rolled back is a lie on the card.
 */
function commitExpiredAnswers(
  deps: QuestionAnswersDeps,
  cardId: string,
  rows: AnswerRow[],
): RecordedDecision[] {
  const decisions: RecordedDecision[] = [];
  deps.db.transaction(() => {
    for (const row of rows) {
      decisions.push({
        question: row.question,
        answers: row.answers,
        contract: deps.consumeAskContract(deps.db, cardId, row.question),
      });
      deps.db.prepare(
        "UPDATE expired_questions SET answered = 1 WHERE id = ?",
      ).run(row.id);
    }
  })();
  return decisions;
}

/** Every open recovery question, refused as one: a partial answer would
 * resume the worker early, and later answers may reverse its direction. */
function partialBatchRefusal(open: OpenRow[], answered: AnswerRow[]): Result | null {
  if (answered.length === open.length) return null;
  const stillOpen = open
    .filter((row) => !answered.some((entry) => entry.id === row.id))
    .map((row) => expiredQuestionId(row.id));
  return refusal(
    "Answer every pending question: a partial answer would resume the worker early. "
    + `Still open: ${stillOpen.join(", ")}.`,
  );
}

async function answerExpiredQuestions(
  deps: QuestionAnswersDeps,
  input: { cardId: string; answers: Answer[] },
): Promise<Result> {
  const card = deps.getCard(input.cardId);
  if (!card) return refusal(deps.errors.cardNotFound);
  if (deps.isArchivedCard(card)) return refusal(deps.errors.cardArchived);
  const openRows = openExpiredRows(deps, input.cardId);
  if (openRows.length === 0) {
    return refusal(
      "No recovery question awaits an answer here. "
      + `Recovery questions use \`${EXPIRED_QUESTION_ID_PREFIX}<id>\`; list them with bb stelow status.`,
    );
  }
  const rows = answerRows(openRows, input.answers);
  const partial = partialBatchRefusal(openRows, rows);
  if (partial) return partial;
  const decisions = commitExpiredAnswers(deps, input.cardId, rows);
  deps.recordSplitAnswer(deps.db, input.cardId, decisions);
  deps.markInboxQuestionsAnswered(
    input.cardId,
    rows.map((row) => expiredQuestionId(row.id)),
  );
  const openQuestionIds = await deps.syncOpenQuestionInbox(card);
  // One recording rule for both doors (lib/question-answer-recording): this door
  // used to write a differently-spelled comment per question, so a grep for a
  // satisfied contract could miss it.
  recordContractAnswers(deps, input.cardId, decisions);
  // Same stale-error rule as live answers: answering clears the interrupted
  // turn's failure so the recovered card reads coherent.
  deps.updateCard(
    input.cardId,
    answeredCardPatch(deps.hasOpenQuestions(input.cardId, openQuestionIds)),
  );
  deps.bb.realtime.publish("card-state", { cardId: input.cardId });
  // Resume the CURRENT worker: the row's thread may be stale (restart / reseed
  // archives the thread but keeps its expired questions).
  const threadId = card.worker_thread_id ?? rows[0]?.thread_id ?? null;
  if (threadId) {
    await resumeFromDecisions(deps, input.cardId, threadId, decisions)
      .catch(() => undefined);
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

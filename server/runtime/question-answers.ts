import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { consumeAnsweredContract } from "../../lib/question-contracts.mjs";
import { commitRecoveryAnswers, recordAnswerTrail } from "../../lib/question-answer-recording.mjs";
import type { ActionRecorder } from "./action-log-runtime.js";
import { questionWaitStart, recordCardAnswer } from "./question-answer-log.js";
import type { PremiseObserver } from "../../lib/premise-staleness.mjs";
import { cleanAnswerList } from "../../lib/question-store.mjs";
import {
  answeredCardPatch,
  EXPIRED_QUESTION_ID_PREFIX,
  expiredQuestionId,
} from "../../lib/question-evidence.mjs";
import { expandInteractionQuestions, groupBatchAnswers } from "../../lib/question-batch.mjs";
import {
  answersFor,
  exclusivePickError,
  expiredAnswerRefusal,
  liveQuestionShapes,
  slotsOf,
} from "../../lib/question-exclusivity.mjs";
import { recordSplitAnswer } from "../../lib/split-proposal.mjs";
import { answerDeliveryCardPatch, answerDeliveryLine } from "../../lib/answer-delivery.mjs";
import type { AnswerDeliveryVerdict } from "../../lib/answer-delivery.d.mts";
import type { WorkerCard } from "../workers-types.js";
import { resumeExpiredAnswer, resumeFromDecisions } from "./answer-resume.js";
import type { BoundaryPortReader } from "./answer-resume.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type Answer = { questionId: string; answers: string[] };
type Decision = { question: string; answers: string[] };
type PendingAsk = { id: string; payload?: { title?: string } };
type Result = {
  ok: boolean;
  answered: number;
  error: string | null;
  /** What the resume did, or null when nothing was resumed (a refusal). */
  delivery: AnswerDeliveryVerdict["delivery"];
  /** The sentence to show beside the saved answer; null when a dispatched resume speaks for itself. */
  deliveryLine: string | null;
};
type OpenRow = { id: string; thread_id: string; question: string; multiple: unknown; kind: unknown; options?: unknown };
type AnswerRow = OpenRow & { answers: string[] };

/**
 * The one boundary port both doors share. The execution layer is built after
 * this one, so it arrives as a reader: a door that needs the lifecycle to route
 * a native-boundary answer asks for it, and a door on a card with no run never
 * does. Binding it is the execution layer's wiring, not this module's.
 */
export type QuestionAnswersDeps = {
  bb: BbPluginApi;
  db: Db;
  errors: { cardNotFound: string; cardArchived: string };
  getCard: (cardId: string) => WorkerCard | undefined;
  isArchivedCard: (card: WorkerCard) => boolean;
  pendingAsks: (threadId: string) => Promise<PendingAsk[]>;
  openExpiredQuestionIds: (cardId: string) => string[];
  syncPendingQuestionInbox: (
    card: WorkerCard,
    ids: string[],
    question?: { summary?: string | null; count?: number | null; kind?: string | null },
  ) => void;
  syncOpenQuestionInbox: (card: WorkerCard) => Promise<string[] | null>;
  markInboxQuestionsAnswered: (cardId: string, ids: string[]) => void;
  recordSplitAnswer: typeof recordSplitAnswer;
  consumeAnsweredContract: typeof consumeAnsweredContract;
  /**
   * The card's premise observation (lib/premise-staleness), built from its state
   * dir. Optional and fail-soft: an unbound reader means no verdict, never a
   * stale one, so a card mid-rewrite cannot have its answers accused by an
   * unreadable artifact.
   */
  premiseObservation?: (cardId: string) => Promise<PremiseObserver | null>;
  /**
   * The comments the card's next answer carries (`server/runtime/answer-feedback`):
   * what a person wrote while reviewing, before they decided. Optional and
   * fail-soft, like the premise observation — an unbound reader means no block,
   * never a lost answer.
   */
  answerFeedback?: (cardId: string) => Promise<{ block: string | null; ids: string[] }>;
  /** Mark the comments a SENT answer carried, so none of them rides twice. */
  markAnswerFeedbackCarried?: (ids: string[]) => void;
  logCardComment: (
    cardId: string,
    targetType: string,
    targetId: string,
    actor: "user" | "agent",
    body: string,
  ) => void;
  updateCard: (cardId: string, fields: Record<string, unknown>) => void;
  /** The flight recorder; optional in narrow tests. */
  actions?: ActionRecorder;
  hasOpenQuestions: (cardId: string, ids: string[] | null) => boolean;
  /**
   * Read at call time, never captured: the execution layer binds it after this
   * one is built. Absent (or unbound) means "no boundary here", and the answer
   * resumes the worker thread exactly as it did before native runs existed.
   */
  boundary?: BoundaryPortReader;
};

function refusal(error: string, answered = 0): Result {
  // A refusal resumes nothing, so it carries no verdict: `null`, never `refused`.
  // `answered` is not always 0 — a boundary answer is committed before its run is
  // asked to resume, so a refused boundary resume already recorded the answers.
  return { ok: false, answered, error, delivery: null, deliveryLine: null };
}

/** A result that answers the questions, with the resume's verdict attached. */
function delivered(answered: number, verdict: AnswerDeliveryVerdict): Result {
  return {
    ok: true,
    answered,
    error: null,
    delivery: verdict.delivery,
    deliveryLine: answerDeliveryLine(verdict),
  };
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
  const shapes = liveQuestionShapes(asks);
  const groups = [...groupBatchAnswers(answers)].filter(([interactionId]) => pending.has(interactionId));
  // The single-choice rule first, across the WHOLE batch, before a single
  // interaction is answered: responding is the point of no return, and a
  // refusal after half the batch landed would leave the worker resumed on a
  // partial decision set. `exclusivePickError` reads the same rule the
  // recovery door reads.
  const overPicked = exclusivePickError(
    groups.flatMap(([interactionId, value]) => slotsOf(interactionId, value, shapes)),
    groups.flatMap(([interactionId, value]) => answersFor(interactionId, value)),
  );
  if (overPicked) throw new Error(overPicked);
  const decisions: Decision[] = [];
  const answeredIds = new Set<string>();
  for (const [interactionId, value] of groups) {
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

/**
 * The trail rule lives in lib/question-answer-recording: both doors write one
 * entry per answer, and an answer whose premise is gone is recorded as a
 * decision that no longer rests on anything (see that module's header).
 */
function recordContractAnswers(
  deps: QuestionAnswersDeps,
  cardId: string,
  decisions: Decision[],
  observe: PremiseObserver | null,
  knownStaleNotes: string[] = [],
): void {
  recordAnswerTrail({
    db: deps.db,
    cardId,
    decisions,
    observe,
    consume: deps.consumeAnsweredContract,
    logComment: deps.logCardComment,
    knownStaleNotes,
  });
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
  const askedAt = questionWaitStart(deps, input.cardId);
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
    // A refused boundary resume used to return here, before any bookkeeping:
    // `respondToLiveAsks` had already consumed the interaction, so the card kept
    // `awaiting-answer` and an Inbox row nobody could answer (a re-answer hits
    // "no question was answered"). The answers ARE recorded — the refusal is
    // about waking the run — so the bookkeeping runs and the verdict carries the
    // port's words. Same rule as a refused thread dispatch.
    const unanswered = live.pendingIds.filter((id) => !live.answeredIds.has(id));
    const openQuestionIds = [...unanswered, ...deps.openExpiredQuestionIds(input.cardId)];
    // Name the answered ones BEFORE the sync: disappearance alone would
    // mislabel them superseded.
    deps.markInboxQuestionsAnswered(input.cardId, [...live.answeredIds]);
    deps.syncPendingQuestionInbox(card, openQuestionIds);
    recordContractAnswers(
      deps,
      input.cardId,
      live.decisions,
      await premiseObservation(deps, input.cardId),
    );
    // A queued answer is a hold, a refused one woke nobody, and a card still
    // waiting on the person keeps `awaiting-answer`. Only `sent` stays `running`.
    deps.updateCard(input.cardId, {
      ...answeredCardPatch(openQuestionIds.length > 0),
      ...answerDeliveryCardPatch(resume.verdict, card.last_assistant_text, openQuestionIds.length > 0),
    });
    recordCardAnswer(deps, input.cardId, card.worker_thread_id ?? null, "live", live.decisions.length, askedAt);
    return delivered(live.decisions.length, resume.verdict);
  } catch (error) {
    return refusal(error instanceof Error ? error.message : "Unable to answer the questions.");
  }
}

function openExpiredRows(deps: QuestionAnswersDeps, cardId: string): OpenRow[] {
  return deps.db.prepare(
    "SELECT id, thread_id, question, multiple, kind, options FROM expired_questions WHERE card_id = ? AND answered = 0",
  ).all(cardId) as OpenRow[];
}

function answerRows(openRows: OpenRow[], answers: Answer[]): AnswerRow[] {
  const selected = new Map<string, AnswerRow>();
  for (const item of answers) {
    const row = openRows.find((entry) => entry.id === item.questionId);
    const clean = cleanAnswerList(item.answers);
    // Empty means none — but only where none is expressible. A multiple
    // question with nothing checked is a decision (keep nothing / add
    // nothing), except split proposals, whose explicit none is the keep
    // choice. A single-select radio with nothing picked is an unfinished
    // form, so it stays unanswered and the batch refusal names it. The flag
    // is read as stored (0/1 integers) rather than coerced upstream, so the
    // row keeps the database representation end to end.
    const none = clean.length === 0 && Boolean(row?.multiple) && row?.kind !== "split";
    if (row && !selected.has(item.questionId) && (clean.length > 0 || none)) {
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
  observe: PremiseObserver | null,
): { decisions: Decision[]; staleNotes: string[] } {
  return commitRecoveryAnswers({
    db: deps.db,
    cardId,
    rows,
    observe,
    consume: deps.consumeAnsweredContract,
  });
}

/** The card's premise observation, read once per answer door. Fail-soft: an
 * unbound reader or a failed lookup means no verdict, never a stale one. */
async function premiseObservation(
  deps: QuestionAnswersDeps,
  cardId: string,
): Promise<PremiseObserver | null> {
  if (!deps.premiseObservation) return null;
  return await deps.premiseObservation(cardId).catch(() => null);
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
  const askedAt = questionWaitStart(deps, input.cardId);
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
  const overPicked = expiredAnswerRefusal(openRows, input.answers);
  if (overPicked) return refusal(overPicked);
  const decisions = commitExpiredAnswers(deps, input.cardId, rows, await premiseObservation(deps, input.cardId));
  deps.recordSplitAnswer(deps.db, input.cardId, decisions.decisions);
  deps.markInboxQuestionsAnswered(
    input.cardId,
    rows.map((row) => expiredQuestionId(row.id)),
  );
  const openQuestionIds = await deps.syncOpenQuestionInbox(card);
  // One recording rule for both doors (lib/question-evidence): this door
  // used to write a differently-spelled comment per question, so a grep for a
  // satisfied contract could miss it.
  recordContractAnswers(deps, input.cardId, decisions.decisions, null, decisions.staleNotes);
  const verdict = await resumeExpiredAnswer(
    deps,
    card,
    rows,
    decisions.decisions,
    openQuestionIds,
  );
  recordCardAnswer(deps, input.cardId, card.worker_thread_id ?? null, "expired", decisions.decisions.length, askedAt);
  return delivered(decisions.decisions.length, verdict);
}

export function createQuestionAnswers(deps: QuestionAnswersDeps) {
  return {
    answerQuestions: (input: { cardId: string; answers: Answer[] }) =>
      answerQuestions(deps, input),
    answerExpiredQuestions: (input: { cardId: string; answers: Answer[] }) =>
      answerExpiredQuestions(deps, input),
  };
}

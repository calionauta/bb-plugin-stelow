/**
 * The resume step both answer doors share, and the verdict it returns.
 *
 * Extracted from `question-answers.ts` when that file went past its line
 * budget: the two doors were growing the same three paragraphs (resolve the
 * thread, read the dispatch, repaint the card) and the file was the only place
 * they could drift apart. One home, called twice.
 *
 * The rule this module exists for: the answer is committed first and the worker
 * is woken second, so the wake has three outcomes and only one of them means
 * work continues. The doors used to await a raw `threads.send` and discard what
 * came back — a queued dispatch read as a resume, a refused one read as a
 * success — which is the same collapse `thread-send.ts` documents on the nudge
 * paths, where it cost a card its whole auto-continue budget.
 */
import type { AnswerDeliveryVerdict } from "../../lib/answer-delivery.d.mts";
import { answerDeliveryCardPatch, answerDeliveryOf } from "../../lib/answer-delivery.mjs";
import { answeredCardPatch } from "../../lib/question-evidence.mjs";
import { formatBatchContinuation } from "../../lib/question-batch.mjs";
import type { WorkerCard } from "../workers-types.js";
import type { QuestionAnswersDeps } from "./question-answers.js";
import { sendWorkerInput } from "./thread-send.js";

type Decision = { question: string; answers: string[] };
type Row = { thread_id: string };

/**
 * Resumes the worker with the batch, unless this batch answered the run's own
 * native boundary — that decision resumes the RUN, and the thread is left alone.
 */
export async function resumeFromDecisions(
  deps: QuestionAnswersDeps,
  cardId: string,
  threadId: string,
  decisions: Decision[],
): Promise<{ boundaryResumed: boolean; verdict: AnswerDeliveryVerdict }> {
  const port = deps.boundary?.read();
  const boundaryRun = port
    ? await port.routeAnswerContinuation(cardId, threadId, decisions)
    : null;
  if (boundaryRun && port) {
    const resumeError = await port.resumeAfterAnswers(boundaryRun, decisions);
    return {
      boundaryResumed: true,
      // The run door reports a failure as words, not as a dispatch: it never
      // speaks the thread protocol, so mapping it to `refused` is the honest
      // reading and keeps one vocabulary for the reader.
      verdict: resumeError
        ? { delivery: "refused", hold: null, error: resumeError }
        : { delivery: "sent", hold: null, error: null },
    };
  }
  // What the person wrote while reviewing rides the answer, and only the
  // dispatch that landed marks it carried: a refusal leaves the comments pending
  // for the next answer instead of losing them behind a send that never went.
  const feedback = await readAnswerFeedback(deps, cardId);
  const verdict = answerDeliveryOf(await sendWorkerInput(deps.bb, threadId, [{
    type: "text",
    text: [formatBatchContinuation(decisions), feedback.block].filter(Boolean).join("\n\n"),
    mentions: [],
  }]));
  if (verdict.delivery === "sent" && feedback.ids.length > 0) {
    deps.markAnswerFeedbackCarried?.(feedback.ids);
  }
  return { boundaryResumed: false, verdict };
}

/** The pending comments, fail-soft: an unbound reader means no block, not a failed answer. */
async function readAnswerFeedback(
  deps: QuestionAnswersDeps,
  cardId: string,
): Promise<{ block: string | null; ids: string[] }> {
  if (!deps.answerFeedback) return { block: null, ids: [] };
  return await deps
    .answerFeedback(cardId)
    .catch(() => ({ block: null, ids: [] as string[] }));
}

/**
 * The recovery door's tail: wake the CURRENT worker, then repaint once.
 *
 * The row's thread may be stale (a restart or reseed archives the thread but
 * keeps its expired questions), which is why the card's thread wins. These rows
 * are already committed, so nothing here can roll back — but the door used to
 * swallow this with `.catch(() => undefined)`, telling a reader their answer had
 * resumed work nobody woke. Now the answers stand and the verdict says whether
 * the worker heard about them.
 */
export async function resumeExpiredAnswer(
  deps: QuestionAnswersDeps,
  card: WorkerCard,
  rows: Row[],
  decisions: Decision[],
  openQuestionIds: string[] | null,
): Promise<AnswerDeliveryVerdict> {
  const threadId = card.worker_thread_id ?? rows[0]?.thread_id ?? null;
  let verdict: AnswerDeliveryVerdict = {
    delivery: "refused",
    hold: null,
    error: "this card has no worker thread to resume",
  };
  if (threadId) {
    try {
      verdict = (await resumeFromDecisions(deps, card.id, threadId, decisions)).verdict;
    } catch (error) {
      verdict = {
        delivery: "refused",
        hold: null,
        error: error instanceof Error ? error.message : null,
      };
    }
  }
  // One repaint, after the verdict is known: the alternative repaints `answered`
  // and then repaints again as held, leaving a card on screen claiming to run for
  // as long as the host takes to answer the dispatch.
  //
  // Same stale-error rule as live answers: answering clears the interrupted
  // turn's failure so the recovered card reads coherent.
  deps.updateCard(card.id, {
    ...answeredCardPatch(deps.hasOpenQuestions(card.id, openQuestionIds)),
    ...answerDeliveryCardPatch(verdict, card.last_assistant_text),
  });
  deps.bb.realtime.publish("card-state", { cardId: card.id });
  return verdict;
}

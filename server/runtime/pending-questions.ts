import { expandInteractionQuestions } from "../../lib/question-batch.mjs";
import { isTerminalCardStatus } from "../../lib/card-status.mjs";
import { boundaryIdFromQuestion, boundaryQuestionShape } from "../../lib/execution-boundary-marker.mjs";
import { rpcContract } from "../rpc-contract.js";
import type { WorkerCard } from "../workers.js";

type PendingQuestion = Awaited<
  ReturnType<typeof rpcContract.cardDetail.output.parse>
>["pendingQuestions"][number];

type BoundaryShape = NonNullable<PendingQuestion["boundary"]>;

type PendingAsk = {
  id: string;
  payload?: { title?: string; [key: string]: unknown };
  expiresAt?: unknown;
};

type PendingQuestionsDeps = {
  fetchPendingAsks: (threadId: string) => Promise<PendingAsk[] | null>;
  getCardByWorkerThread: (threadId: string) => WorkerCard | null | undefined;
  resolveAskOptions: (
    card: WorkerCard | null,
    options: Array<{
      label: string;
      description: string;
      preview: string | null;
      artifact: { path: string } | null;
    }>,
  ) => Promise<PendingQuestion["options"]>;
  /**
   * The boundary a question belongs to, resolved by its `[Stelow boundary
   * <id>]` marker against the card's runs. Returns null for an ordinary
   * question, which is most of them: the framing is opt-in, never inferred.
   */
  boundaryForQuestion: (card: WorkerCard | null, question: string) => Promise<{ kind: string } | null>;
};

/** The framing a question renders with, or null when it is not a boundary. */
async function boundaryFor(
  deps: PendingQuestionsDeps,
  card: WorkerCard | null,
  question: string,
  hasOptions: boolean,
): Promise<BoundaryShape | null> {
  const boundaryId = boundaryIdFromQuestion(question);
  if (!boundaryId) return null;
  const boundary = await deps.boundaryForQuestion(card, question).catch(() => null);
  if (!boundary) return null;
  return boundaryQuestionShape(boundary.kind, { hasOptions });
}

/**
 * The card's open questions, as the card detail and the CLI see them.
 *
 * A failed ask read is UNKNOWN, not proof that a question disappeared — the
 * same rule `question-inbox.ts` documents for its own reads. This projection
 * used to return `[]` for both "read failed" and "nothing open", so a poll
 * hiccup rendered as "0 open questions" and `done` closed a card over a
 * question that was still live. `null` now carries that distinction; callers
 * must keep the state they already had instead of treating it as zero.
 */
export function createPendingQuestions(deps: PendingQuestionsDeps) {
  return async function fetchPendingQuestions(
    threadId: string | null,
  ): Promise<PendingQuestion[] | null> {
    if (!threadId) return [];
    try {
      const card = deps.getCardByWorkerThread(threadId) ?? null;
      // A finished card's open questions closed with it — the same rule
      // `readOpenExpiredQuestions` applies to the recovery rows. Projecting
      // one renders a waiting hero whose "answer below and the agent resumes on
      // its own" promise cannot be kept, because nothing is left to resume.
      // This is a known zero, not an unknown: terminality is readable from the
      // card row itself.
      if (isTerminalCardStatus(card?.status)) return [];
      const asks = await deps.fetchPendingAsks(threadId);
      if (asks === null) return null;
      const out: PendingQuestion[] = [];
      for (const entry of asks) {
        const expanded = expandInteractionQuestions({
          id: entry.id,
          title: entry.payload?.title,
          payload: entry.payload,
        });
        for (const question of expanded) {
          const options = await deps.resolveAskOptions(card, question.options);
          out.push({
            id: question.questionId,
            title: question.title,
            question: question.question,
            multiple: question.multiple,
            kind: question.kind,
            boundary: await boundaryFor(deps, card, question.question, options.length > 0),
            options,
            expiresAt: typeof entry.expiresAt === "number" ? entry.expiresAt : null,
          });
        }
      }
      return out;
    } catch {
      return null;
    }
  };
}

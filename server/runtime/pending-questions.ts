import { expandInteractionQuestions } from "../../lib/question-batch.mjs";
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

export function createPendingQuestions(deps: PendingQuestionsDeps) {
  return async function fetchPendingQuestions(
    threadId: string | null,
  ): Promise<PendingQuestion[]> {
    if (!threadId) return [];
    const asks = await deps.fetchPendingAsks(threadId);
    if (asks === null) return [];
    try {
      const card = deps.getCardByWorkerThread(threadId) ?? null;
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
      return [];
    }
  };
}

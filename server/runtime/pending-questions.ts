import { expandInteractionQuestions } from "../../lib/question-batch.mjs";
import { rpcContract } from "../rpc-contract.js";
import type { WorkerCard } from "../workers.js";

type PendingQuestion = Awaited<
  ReturnType<typeof rpcContract.cardDetail.output.parse>
>["pendingQuestions"][number];

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
};

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

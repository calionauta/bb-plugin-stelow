import { QuestionBatch } from "./question-batch";
import type { BatchItem, ExpiredQuestionItem, OpenArtifactHandler } from "./batch-types";

/**
 * The RECOVERED (timed-out) question batch.
 *
 * It draws NO section of its own any more. The live batch and this one are the
 * same decision ("what is the card still waiting on me for"), so
 * `DetailQuestionSections` owns the one "Waiting for you" section — title,
 * count, amber tone, open state — and this component keeps only the batch and
 * the mapping from stored rows to the shared stepper. Two sections for one
 * decision made the live copy look like an alert and the recovered copy like
 * history, when both are the card's blocking work.
 */
function expiredBatchItems(questions: ExpiredQuestionItem[]): BatchItem[] {
  return questions.map((q) => ({
    id: q.id,
    title: "",
    prompt: q.question,
    multiple: q.multiple,
    kind: q.kind,
    options: q.options,
    staleness: q.staleness ?? null,
  }));
}

export function ExpiredQuestionsSection({ cardId, questions, onAnswered, onOpenArtifact }: {
  cardId: string;
  questions: ExpiredQuestionItem[];
  onAnswered: () => void;
  onOpenArtifact?: OpenArtifactHandler;
}) {
  if (questions.length === 0) return null;
  return (
    <QuestionBatch
      cardId={cardId}
      mode="expired"
      questions={expiredBatchItems(questions)}
      onAnswered={onAnswered}
      onOpenArtifact={onOpenArtifact}
    />
  );
}

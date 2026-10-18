import { DisclosureSection } from "../disclosure";
import { questionCopy } from "../../lib/question-presentation.mjs";
import { QuestionBatch } from "./question-batch";
import type { BatchItem, ExpiredQuestionItem, OpenArtifactHandler } from "./batch-types";

/**
 * The RECOVERED (timed-out) question batch.
 *
 * Its own file rather than a tail on `question-batch.tsx` because it is a
 * different decision surface with a different shape: a collapsed section that
 * starts closed, where the live batch is the hero's own action. It also keeps
 * that file inside its line budget.
 */

// The recovered batch is the one place a section is still the right shape, and
// that is not a contradiction of the live question's container-less treatment.
// An OPEN box around the action restates the hero, which is why the live batch
// lost its frame. A COLLAPSED row with a header is what `disclosure.tsx` calls a
// section of the card, and this batch is neither live nor blocking — the worker
// already moved on — so `startsOpen()` correctly returns false for it.
//
// It keeps a header because the caveat has to live somewhere while the section
// is closed: every option the reader picked is retained, and a later answer
// cannot revise work already resumed. Without the row, a timed-out question
// exists only as an unexplained extra count in the hero.
// A timed-out question is the same question with no title of its own — the
// recovered batch draws its prompt where the live one draws a heading. Named
// rather than inlined so the mapping is one thing to read, and so the JSX above
// does not carry a 150-character expression.
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
  const copy = questionCopy();
  return (
    <DisclosureSection
      title={copy.recoveryHeading}
      hint={`${questions.length} timed out`}
    >
      <p className="text-xs leading-5 text-muted-foreground">
        These questions timed out before they were answered. Every option you picked is kept
        exactly as you left it — a later answer cannot revise work the worker already resumed.
      </p>
      <QuestionBatch
        cardId={cardId}
        mode="expired"
        questions={expiredBatchItems(questions)}
        onAnswered={onAnswered}
        onOpenArtifact={onOpenArtifact}
      />
    </DisclosureSection>
  );
}

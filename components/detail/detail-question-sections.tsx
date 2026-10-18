import type { ReactNode } from "react";
import { openAskArtifact } from "../artifacts/artifact-inventory";
import { QuestionBatch, type BatchItem } from "../conversation/question-batch";
import { ExpiredQuestionsSection } from "../conversation/expired-questions-section";
import type { ExpiredQuestionItem } from "../conversation/batch-types";

type PendingQuestionInput = {
  id: string;
  title: string;
  question: string;
  multiple: boolean;
  kind?: BatchItem["kind"];
  options: BatchItem["options"];
  staleness?: BatchItem["staleness"] | null;
};
type OpenArtifact = (
  artifact: Parameters<typeof openAskArtifact>[3],
  mode: Parameters<typeof openAskArtifact>[4],
  optionLabel: Parameters<typeof openAskArtifact>[5],
) => void;

type DetailQuestionSectionsProps = {
  card: { id: string; workspaceKind: string };
  detail: {
    pendingQuestions: PendingQuestionInput[];
    expiredQuestions: ExpiredQuestionItem[];
    fileEnvironmentId: string | null;
  };
  setViewerFile: Parameters<typeof openAskArtifact>[2];
  onAnswered: () => void;
  openLiveArtifact: boolean;
};

export function DetailQuestionSections({
  card,
  detail,
  setViewerFile,
  onAnswered,
  openLiveArtifact,
}: DetailQuestionSectionsProps) {
  const openArtifact: OpenArtifact = (artifact, mode, optionLabel) => openAskArtifact(
    card,
    detail.fileEnvironmentId,
    setViewerFile,
    artifact,
    mode,
    optionLabel,
  );
  return (
    <>
      <LiveQuestionSection
        cardId={card.id}
        questions={detail.pendingQuestions}
        onAnswered={onAnswered}
        onOpenArtifact={openLiveArtifact ? openArtifact : undefined}
      />
      <ExpiredQuestionSection
        cardId={card.id}
        questions={detail.expiredQuestions}
        onAnswered={onAnswered}
        onOpenArtifact={openArtifact}
      />
    </>
  );
}

function QuestionFrame({
  children,
}: {
  children: ReactNode;
}) {
  // The boundary between the hero's status and the question it produced. It
  // used to be amber (`border-amber-500/20`), which is the same tone the hero
  // already wears — so the marker competed with the thing it was marking
  // rather than separating it. `border` is the card's own hairline: the hero's
  // amber says "this needs you", and this neutral rule says "the answer starts
  // here".
  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      {children}
    </div>
  );
}

function LiveQuestionSection({
  cardId,
  questions,
  onAnswered,
  onOpenArtifact,
}: {
  cardId: string;
  questions: PendingQuestionInput[];
  onAnswered: () => void;
  onOpenArtifact?: OpenArtifact;
}) {
  if (!questions[0]) return null;
  return (
    <div id="execution-needs-input-questions" tabIndex={-1}>
      <QuestionFrame>
        <QuestionBatch
          cardId={cardId}
          mode="live"
          questions={questions.map((question) => ({ ...question, prompt: question.question }))}
          onAnswered={onAnswered}
          onOpenArtifact={onOpenArtifact}
        />
      </QuestionFrame>
    </div>
  );
}

function ExpiredQuestionSection({
  cardId,
  questions,
  onAnswered,
  onOpenArtifact,
}: {
  cardId: string;
  questions: ExpiredQuestionItem[];
  onAnswered: () => void;
  onOpenArtifact: OpenArtifact;
}) {
  if (questions.length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      <ExpiredQuestionsSection
        cardId={cardId}
        questions={questions}
        onOpenArtifact={onOpenArtifact}
        onAnswered={onAnswered}
      />
    </div>
  );
}

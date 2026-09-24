import type { ReactNode } from "react";
import { openAskArtifact } from "../artifacts/artifact-inventory";
import {
  ExpiredQuestionsSection,
  QuestionBatch,
  type BatchItem,
  type ExpiredQuestionItem,
} from "../conversation/question-batch";

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
  const openArtifact: OpenArtifact = (artifact, mode) => openAskArtifact(
    card,
    detail.fileEnvironmentId,
    setViewerFile,
    artifact,
    mode,
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
  withSpace = false,
}: {
  children: ReactNode;
  withSpace?: boolean;
}) {
  const spacing = withSpace ? " space-y-2" : "";
  return (
    <div className={`mt-3 border-t border-amber-500/20 pt-3${spacing}`}>
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
      <QuestionFrame withSpace>
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
    <QuestionFrame>
      <ExpiredQuestionsSection
        cardId={cardId}
        questions={questions}
        onOpenArtifact={onOpenArtifact}
        onAnswered={onAnswered}
      />
    </QuestionFrame>
  );
}

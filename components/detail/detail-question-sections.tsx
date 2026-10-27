import type { ReactNode } from "react";
import { openAskArtifact } from "../artifacts/artifact-inventory";
import { DisclosureSection } from "../disclosure";
import { questionCopy } from "../../lib/question-presentation.mjs";
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

/**
 * The card's ONE decision surface, live or recovered.
 *
 * It used to be two different shapes: a live batch with no container at all,
 * and a separate "Waiting for you" disclosure for the timed-out copy that
 * started closed and wore the neutral section tone. A reader landing on a card
 * that was waiting for them saw the amber state line at the top, then a grey
 * section they had to open — the colour and the heading were on the wrong
 * component. The decision surface is now one section: amber, open, and named
 * with the count it owns ("Needs your decision — 9 questions"). The hero keeps
 * the card's state and gives up the gold.
 *
 * The section carries BOTH stores because they answer the same question — what
 * is the card still waiting on me for — and a card can have both at once (a new
 * ask arriving while older ones timed out).
 */
export function DetailQuestionSections({
  card,
  detail,
  setViewerFile,
  onAnswered,
  openLiveArtifact,
}: DetailQuestionSectionsProps) {
  const { pendingQuestions, expiredQuestions } = detail;
  if (pendingQuestions.length + expiredQuestions.length === 0) return null;
  const openArtifact: OpenArtifact = (artifact, mode, optionLabel) => openAskArtifact(
    card,
    detail.fileEnvironmentId,
    setViewerFile,
    artifact,
    mode,
    optionLabel,
  );
  return (
    <WaitingSection live={pendingQuestions.length} expired={expiredQuestions.length}>
      <LiveQuestionSection
        cardId={card.id}
        questions={pendingQuestions}
        onAnswered={onAnswered}
        onOpenArtifact={openLiveArtifact ? openArtifact : undefined}
      />
      <ExpiredQuestionSection
        cardId={card.id}
        questions={expiredQuestions}
        onAnswered={onAnswered}
        onOpenArtifact={openArtifact}
      />
    </WaitingSection>
  );
}

/**
 * The shared frame: title, the count it owns, and the lead that says what
 * answering does here.
 *
 * `defaultOpen` is deliberate and is the `startsOpen({ blocking: true })` case
 * from `disclosure.tsx`: a section holding an unanswered decision is the one
 * kind of section that may open itself. The reader can still close it.
 */
function WaitingSection({ live, expired, children }: {
  live: number;
  expired: number;
  children: ReactNode;
}) {
  const copy = questionCopy();
  const total = live + expired;
  return (
    <DisclosureSection
      title={copy.recoveryHeading}
      subtitle={copy.needsDecision(total)}
      hint={expired > 0 ? `${expired} question${expired === 1 ? "" : "s"} timed out` : null}
      tone="decision"
      defaultOpen
    >
      <p className="text-sm leading-6 text-foreground">{live > 0 ? copy.liveLead : copy.expiredLead}</p>
      {live > 0 && expired > 0
        ? <p className="text-sm leading-6 text-muted-foreground">{copy.expiredLead}</p>
        : null}
      {children}
    </DisclosureSection>
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
    <div id="execution-needs-input-questions" tabIndex={-1} className="space-y-2">
      <QuestionBatch
        cardId={cardId}
        mode="live"
        questions={questions.map((question) => ({ ...question, prompt: question.question }))}
        onAnswered={onAnswered}
        onOpenArtifact={onOpenArtifact}
      />
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
    <div className="space-y-2 border-t border-border/60 pt-3">
      <ExpiredQuestionsSection
        cardId={cardId}
        questions={questions}
        onOpenArtifact={onOpenArtifact}
        onAnswered={onAnswered}
      />
    </div>
  );
}

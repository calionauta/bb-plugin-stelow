import { useState } from "react";
import { questionCopy } from "../../lib/question-presentation.mjs";
import { isSplitQuestion, splitQuestionText, splitSelectionNotice } from "../../lib/question-presentation.mjs";
import { SPLIT_KEEP_LABEL } from "../../lib/split-proposal.mjs";
import { preselectedAnswers, toggleSinglePick } from "../../lib/question-batch.mjs";
import { BatchAnswerBody, BatchFooter } from "./batch-answer-body";
import { useAnswerSubmit } from "./use-answer-submit";
import { BatchQuestionHeading } from "./batch-question-heading";
import type {
  BatchItem,
  OpenArtifactHandler,
} from "./batch-types";

// Question conversation: the stepper (radio/checkbox options, free-text
// Other, explicit skip, atomic submit), the live batch (answerQuestions),
// and the expired batch (answerExpiredQuestions, every selected option
// retained). Every track renders the same conversation — one home, not
// three pasted steppers. The option rows themselves, the question shapes
// they render, and the document they open are declared alongside.

// The question shapes live in ./batch-types so the option rows and the stepper
// can both import them without importing each other. They are re-exported
// here because this module is where every consumer already reaches for them.
export type {
  AskArtifact,
  ArtifactViewerMode,
  BatchItem,
  BatchOption,
  OpenArtifactHandler,
} from "./batch-types";

// Preselected answers live in lib/question-batch.mjs (pure, node-tested);
// the hook only reads the resolved initial state once per batch.

// Batch selection state: stepper position, per-question picks, free-text
// customs, and explicit skips — plus the merged answers each question
// contributes to the atomic submit. One hook so the dots, the options,
// and the footer always read the same decisions.
// Exception to the 50-line function rule (2026-09-23): this hook is one
// cohesive selection state machine (position, picks, customs, skips plus
// the split keep/clear rule). Its parts are coupled — splitting custom
// from skip or pick from merged would scatter one decision across hooks
// for the metric's sake (KISS wins). Revisit if it grows past 70.
// Empty means none on multiple-choice: an unchecked checkbox list completes
// as an explicit none decision (single-select still needs a pick; split
// proposals keep their explicit keep choice).
function isQuestionDone(q: BatchItem, skipped: Set<string>, merged: (id: string) => string[]) {
  return skipped.has(q.id) || merged(q.id).length > 0 || (q.multiple && !isSplitQuestion(q));
}

// Done-derivation for one question by id, shared by the stepper dots.
// Lives at module scope so the stepper stays a layout function instead of
// growing closures — the hook owns selection state, this owns the read.
function isDoneById(questions: BatchItem[], skipped: Set<string>, merged: (id: string) => string[], id: string): boolean {
  const question = questions.find((entry) => entry.id === id);
  return question ? isQuestionDone(question, skipped, merged) : false;
}

function useBatchSelection(questions: BatchItem[]) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<Record<string, string[]>>(() => preselectedAnswers(questions));
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  // Nullable: the stepper renders nothing for an empty batch, but hooks
  // run unconditionally — the shell guards before reading current.
  const current = questions.length === 0 ? null : (questions[Math.min(index, questions.length - 1)] as BatchItem);
  const isSplitProposal = current ? isSplitQuestion(current) : false;
  const merged = (id: string): string[] => {
    if (skipped.has(id)) return [];
    const out = [...(selected[id] ?? [])];
    const text = (custom[id] ?? "").trim();
    if (text) out.push(text);
    return out;
  };
  const complete = questions.every((q) => isQuestionDone(q, skipped, merged));
  const isLastQuestion = index === questions.length - 1;
  const pick = (question: BatchItem, label: string) => {
    setSkipped((prev) => { const next = new Set(prev); next.delete(question.id); return next; });
    setSelected((prev) => {
      const has = (prev[question.id] ?? []).includes(label);
      if (current && question === current && isSplitProposal) {
        // Delivery cards form a multi-select. The explicit keep choice is an
        // alternative, not a fourth delivery: choosing either side clears
        // the other so a card answer can never encode two contradictory
        // outcomes.
        if (label === SPLIT_KEEP_LABEL) return { ...prev, [question.id]: has ? [] : [SPLIT_KEEP_LABEL] };
        const withoutKeep = (prev[question.id] ?? []).filter((item) => item !== SPLIT_KEEP_LABEL);
        return { ...prev, [question.id]: has ? withoutKeep.filter((item) => item !== label) : [...withoutKeep, label] };
      }
      if (question.multiple) return { ...prev, [question.id]: has ? prev[question.id]!.filter((item) => item !== label) : [...(prev[question.id] ?? []), label] };
      // Single-select: the pick composes with custom text; split
      // exclusivity lives in its branch above.
      return { ...prev, [question.id]: toggleSinglePick(prev[question.id], label) };
    });
  };
  const typeCustom = (question: BatchItem, value: string) => {
    setCustom((prev) => ({ ...prev, [question.id]: value }));
    if (value.trim() && isSplitQuestion(question)) setSelected((prev) => ({ ...prev, [question.id]: [] }));
    if (value.trim()) setSkipped((prev) => { const next = new Set(prev); next.delete(question.id); return next; });
  };
  const skip = (question: BatchItem) => {
    setSkipped((prev) => new Set(prev).add(question.id));
    setSelected((prev) => ({ ...prev, [question.id]: [] }));
    setCustom((prev) => ({ ...prev, [question.id]: "" }));
  };
  const unskip = (question: BatchItem) => setSkipped((prev) => { const next = new Set(prev); next.delete(question.id); return next; });
  return { index, setIndex, selected, custom, skipped, current, isSplitProposal, merged, pick, typeCustom, skip, unskip, complete, isLastQuestion };
}

// radio (single) / checkbox (multi) options plus a free-text "Other", explicit
// skip, and a single atomic submit — one worker resume, one inbox resolution.
// The controls themselves live in ./batch-answer-body; this owns position,
// framing, and submission.
//
// There is NO keyboard accelerator, on purpose (2026-10-27). The digit, arrow
// and chord layer was invisible enough that a reader could not tell it existed,
// and it competed with the browser's own keys beside a live worker terminal.
// The controls are buttons, inputs and a native details summary: every one is
// reachable and operable with Tab/Enter/Space without a private router.
export function BatchStepper({ cardId, questions, allowSkip, busy, error, submitLabel, onSubmit, onOpenArtifact }: {
  cardId?: string;
  questions: BatchItem[];
  allowSkip: boolean;
  busy: boolean;
  error: string | null;
  submitLabel: string;
  onSubmit: (answers: string[][]) => void;
  onOpenArtifact?: OpenArtifactHandler;
}) {
  const sel = useBatchSelection(questions);
  if (questions.length === 0) return null;
  const current = sel.current!;
  const copy = questionCopy();
  const prompt = sel.isSplitProposal ? splitQuestionText(current.prompt) : current.prompt;
  const splitNotice = sel.isSplitProposal ? splitSelectionNotice(current.options, sel.selected[current.id] ?? []) : null;
  const isDone = (id: string): boolean => isDoneById(questions, sel.skipped, sel.merged, id);
  return (
    <StepperSurface
      questions={questions}
      sel={sel}
      current={current}
      copy={copy}
      prompt={prompt}
      splitNotice={splitNotice}
      isDone={isDone}
      cardId={cardId}
      allowSkip={allowSkip}
      busy={busy}
      error={error}
      submitLabel={submitLabel}
      onSubmit={onSubmit}
      onOpenArtifact={onOpenArtifact}
    />
  );
}

/**
 * The batch's markup. Split from `BatchStepper` — which owns the selection
 * state — so neither function crosses the size budget, and so the layout can be
 * read without reading the state machine behind it.
 */
function StepperSurface({
  questions, sel, current, copy, prompt, splitNotice, isDone,
  cardId, allowSkip, busy, error, submitLabel, onSubmit, onOpenArtifact,
}: {
  questions: BatchItem[];
  sel: ReturnType<typeof useBatchSelection>;
  current: BatchItem;
  copy: ReturnType<typeof questionCopy>;
  prompt: string;
  splitNotice: { text: string } | null;
  isDone: (id: string) => boolean;
  cardId?: string;
  allowSkip: boolean;
  busy: boolean;
  error: string | null;
  submitLabel: string;
  onSubmit: (answers: string[][]) => void;
  onOpenArtifact?: OpenArtifactHandler;
}) {
  return (
    <div className="space-y-2">
      <BatchQuestionHeading questions={questions} index={sel.index} copy={copy} current={current} prompt={prompt} onSelectDot={sel.setIndex} isDone={isDone} />
      <BatchAnswerBody
        cardId={cardId}
        sel={sel}
        current={current}
        copy={copy}
        allowSkip={allowSkip}
        error={error}
        splitNotice={splitNotice}
        onOpenArtifact={onOpenArtifact}
      />
      <BatchFooter
        sel={sel}
        questions={questions}
        copy={copy}
        busy={busy}
        submitLabel={submitLabel}
        isDone={isDone}
        canSkip={allowSkip}
        onSubmit={onSubmit}
      />
    </div>
  );
}

export function QuestionBatch({ cardId, questions, mode, onAnswered, onOpenArtifact }: {
  cardId: string;
  questions: BatchItem[];
  mode: "live" | "expired";
  onAnswered: () => void;
  onOpenArtifact?: OpenArtifactHandler;
}) {
  // The hook runs before the empty-batch return so its own hooks are never
  // conditional.
  const { busy, error, submit } = useAnswerSubmit(cardId, questions, mode, onAnswered);
  const copy = questionCopy();
  if (questions.length === 0) return null;
  return (
    <BatchStepper
      cardId={cardId}
      questions={questions}
      allowSkip={mode === "live"}
      busy={busy}
      error={error}
      submitLabel={questions.length > 1 ? copy.submitAnswers : copy.submitAnswer}
      onSubmit={(all) => void submit(all)}
      onOpenArtifact={onOpenArtifact}
    />
  );
}


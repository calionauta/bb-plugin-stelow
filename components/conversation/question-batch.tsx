import { useState, useCallback, useRef } from "react";
import { questionCopy } from "../../lib/question-presentation.mjs";
import { isSplitQuestion, splitQuestionText, splitSelectionNotice, submitBlockReason } from "../../lib/question-presentation.mjs";
import { artifactViewerModeForOption } from "../../lib/question-presentation.mjs";
import { BatchKeyLegend, BatchKeyOverlay, useBatchKeys } from "./batch-keys-ui";
import { SPLIT_KEEP_LABEL } from "../../lib/split-proposal.mjs";
import { boundaryOptions } from "./boundary-question-frame";
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
// The frame went with the counters. It used to be a bordered amber panel with a
// "?" badge and `role="alert"`, and it is rendered INSIDE the card's hero
// section — which is already a section surface wearing the amber decision tone.
// So a bordered box sat inside a bordered box, announcing "a question exists"
// two lines below the hero that had already said exactly that, in amber text on
// an amber wash. The hero owns the alert (HERO_STYLE.decision.alert); a second
// live region for one fact is worse than one. What marks the boundary now is
// position (the hairline in detail-question-sections), the default-open state,
// and the option rows' own frames.
/**
 * The batch's keyboard wiring, as one hook.
 *
 * Extracted from `BatchStepper`, which was over its function budget once the
 * accelerator landed. The stepper owns the shape of the surface; this owns what
 * each key does to the selection it is given.
 */
/**
 * What each key does to this batch, as a plain object.
 *
 * Module scope rather than inline, so `useStepperKeys` reads as the wiring it is
 * and neither function crosses the size budget. Every handler that needs the
 * current question tolerates its absence, because this map is built on renders
 * where the batch is empty too.
 */
function stepperKeyHandlers({
  questions, sel, current, shownOptions, firstDocument, busy, focusNote, onSubmit, onOpenArtifact,
}: {
  questions: BatchItem[];
  sel: ReturnType<typeof useBatchSelection>;
  current: BatchItem | null;
  shownOptions: BatchItem["options"];
  firstDocument: BatchItem["options"][number] | undefined;
  busy: boolean;
  focusNote: () => void;
  onSubmit: (answers: string[][]) => void;
  onOpenArtifact?: OpenArtifactHandler;
}): Parameters<typeof useBatchKeys>[0]["handlers"] {
  return {
    onPick: (optionIndex) => {
      if (!current) return;
      const option = shownOptions[optionIndex];
      if (option) sel.pick(current, option.label);
    },
    onMove: sel.setIndex,
    onFocusNote: focusNote,
    onToggleSkip: () => {
      if (!current) return;
      if (sel.skipped.has(current.id)) sel.unskip(current);
      else sel.skip(current);
    },
    onOpenDocument: () => {
      if (!firstDocument?.artifact || !onOpenArtifact) return;
      onOpenArtifact(firstDocument.artifact, artifactViewerModeForOption(firstDocument.label), firstDocument.label);
    },
    // The SAME guard the footer's button uses. Calling `onSubmit` bare sent a
    // `needsNote` pick with an empty note — the exact case the field refusal
    // exists to prevent — and allowed a second submit while one was in flight.
    // A chord must shortcut the button's REFUSALS too, not just its action.
    onSubmit: () => {
      const blockReason = submitBlockReason(questions, sel.selected, sel.custom);
      if (!sel.complete || busy || blockReason !== null) return;
      onSubmit(questions.map((q) => sel.merged(q.id)));
    },
  };
}

function useStepperKeys({
  questions,
  sel,
  allowSkip,
  busy,
  onOpenArtifact,
  onSubmit,
  focusNote,
}: {
  questions: BatchItem[];
  sel: ReturnType<typeof useBatchSelection>;
  allowSkip: boolean;
  busy: boolean;
  onOpenArtifact?: OpenArtifactHandler;
  onSubmit: (answers: string[][]) => void;
  focusNote: () => void;
}) {
  // Read the current question from the selection rather than taking it as an
  // argument, because every hook above must run even for an empty batch — and
  // an empty batch has no current question to pass in.
  const current = sel.current;
  // The options the reader can actually SEE. A boundary question may render none
  // of them (`boundaryOptions`), and the digit keys must index that same list:
  // indexing the raw options would let `1` pick an invisible option and complete
  // the batch from a question the reader never answered.
  const shownOptions = current ? boundaryOptions(current) : [];
  const firstDocument = shownOptions.find((option) => option.artifact);
  return useBatchKeys({
    questions,
    index: sel.index,
    setIndex: sel.setIndex,
    canSkip: allowSkip,
    hasDocument: Boolean(firstDocument?.artifact) && Boolean(onOpenArtifact),
    optionCount: shownOptions.length,
    handlers: stepperKeyHandlers({
      questions, sel, current, shownOptions, firstDocument, busy, focusNote, onSubmit, onOpenArtifact,
    }),
  });
}

/**
 * The stepper's accelerator, with the one indirection it needs.
 *
 * `o` focuses the note by walking down from the container, but the container
 * ref lives on the hook the handlers are passed TO — so one ref carries the
 * handler into the binding. Bundled here because the stepper is a layout
 * function and this is the whole of its keyboard setup.
 */
function useStepperKeySetup({
  questions, sel, allowSkip, busy, onOpenArtifact, onSubmit,
}: {
  questions: BatchItem[];
  sel: ReturnType<typeof useBatchSelection>;
  allowSkip: boolean;
  busy: boolean;
  onOpenArtifact?: OpenArtifactHandler;
  onSubmit: (answers: string[][]) => void;
}) {
  // The ref breaks a cycle: `focusNote` must call the binding that is created
  // by PASSING `focusNote`. One ref carries the callback into the binding, and
  // only `keys` needs to leave this hook.
  const focusNoteRef = useRef<{ focusNote: () => void } | null>(null);
  const focusNote = useCallback(() => focusNoteRef.current?.focusNote(), []);
  const keys = useStepperKeys({ questions, sel, allowSkip, busy, onOpenArtifact, onSubmit, focusNote });
  focusNoteRef.current = keys;
  return keys;
}

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
  // A hook, so it runs even for an empty batch — calling it after the early
  // return below would change the hook count the moment a batch arrived
  // (tests/question-surface-collapse.test.mjs pins the order).
  const keys = useStepperKeySetup({ questions, sel, allowSkip, busy, onOpenArtifact, onSubmit });
  if (questions.length === 0) return null;
  const current = sel.current!;
  const copy = questionCopy();
  const prompt = sel.isSplitProposal ? splitQuestionText(current.prompt) : current.prompt;
  const splitNotice = sel.isSplitProposal ? splitSelectionNotice(current.options, sel.selected[current.id] ?? []) : null;
  const isDone = (id: string): boolean => isDoneById(questions, sel.skipped, sel.merged, id);
  return (
    <StepperSurface
      keys={keys}
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
 * The batch's markup. Split from `BatchStepper` — which owns selection and the
 * keyboard binding — so neither function crosses the size budget, and so the
 * layout can be read without reading the state machine behind it.
 *
 * No ring, no `tabIndex` on the container: the keys arrive by bubbling from the
 * focused child, so this div is never a focus target, and a ring on a
 * non-focusable element is dead CSS. A `tabIndex={0}` would add an empty tab
 * stop before the real controls, which is worse than none.
 */
function StepperSurface({
  keys, questions, sel, current, copy, prompt, splitNotice, isDone,
  cardId, allowSkip, busy, error, submitLabel, onSubmit, onOpenArtifact,
}: {
  keys: { containerRef: React.RefObject<HTMLDivElement | null>; showKeys: boolean; closeKeys: () => void };
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
    <div ref={keys.containerRef} className="space-y-2">
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
      <BatchKeyOverlay open={keys.showKeys} onClose={keys.closeKeys} />
      <BatchKeyLegend multiQuestion={questions.length > 1} canSkip={allowSkip} />
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


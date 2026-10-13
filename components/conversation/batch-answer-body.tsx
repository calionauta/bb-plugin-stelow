// How one question is answered: the option rows, the free-text "Other", the
// explicit skip, the progress notes, and the navigation footer. Split out of
// the stepper so each has a name and a size — the stepper owns position,
// framing, and submission; this owns the controls a reader actually touches.
//
// It takes the selection state as a parameter rather than importing the hook,
// so `question-batch` passes its state down without the two files importing
// each other.
import { Button } from "@/components/ui/button";
import { BatchOptionList } from "./batch-options";
import { boundaryOptions } from "./boundary-question-frame";
import { submitBlockReason } from "../../lib/question-presentation.mjs";
import type { BatchItem, OpenArtifactHandler } from "./batch-types";
import type { questionCopy } from "../../lib/question-presentation.mjs";

type Copy = ReturnType<typeof questionCopy>;

const NOTICE_CLASS =
  "rounded-md border border-amber-500/30 bg-background/50 p-2 text-xs leading-5 "
  + "text-amber-900/80 dark:text-amber-100/80";
const MUTED_CLASS = "text-xs text-amber-900/60 dark:text-amber-200/60";

/** The subset of the stepper's selection state the answer controls read. */
export type AnswerBodyState = {
  isSplitProposal: boolean;
  splitKeepLabel: string;
  selected: Record<string, string[]>;
  custom: Record<string, string>;
  skipped: Set<string>;
  pick: (question: BatchItem, label: string) => void;
  typeCustom: (question: BatchItem, value: string) => void;
  skip: (question: BatchItem) => void;
  unskip: (question: BatchItem) => void;
};

/** The subset the footer reads: position, completion, and the merged answers. */
export type AnswerFooterState = {
  index: number;
  isLastQuestion: boolean;
  complete: boolean;
  doneCount: number;
  remainingCount: number;
  setIndex: (index: number) => void;
  merged: (id: string) => string[];
};

const INPUT_CLASS =
  "mt-1 min-h-11 w-full cursor-text rounded-md border border-border "
  + "bg-background/60 px-2 text-sm font-normal text-foreground placeholder:text-muted-foreground";

// Free-text note: composes with a picked option (the note travels with the
// decision) and doubles as a standalone custom answer when nothing is
// picked — except on split proposals, where pick and text stay exclusive.
export function BatchCustomInput({
  copy,
  value,
  onType,
}: {
  copy: Copy;
  value: string;
  onType: (value: string) => void;
}) {
  return (
    <label className="block text-xs font-medium text-amber-900/80 dark:text-amber-200/80">
      <span>{copy.other}</span>
      <input
        value={value}
        onChange={(event) => onType(event.target.value)}
        placeholder={copy.customPlaceholder}
        className={INPUT_CLASS}
      />
    </label>
  );
}

function SkipControl({
  skipped,
  copy,
  onSkip,
  onUnskip,
}: {
  skipped: boolean;
  copy: Copy;
  onSkip: () => void;
  onUnskip: () => void;
}) {
  return skipped
    ? (
      <button onClick={onUnskip} className="min-h-11 cursor-pointer text-xs font-medium text-primary hover:underline">
        {copy.skipped}
      </button>
    )
    : (
      <button onClick={onSkip} className="min-h-11 cursor-pointer text-xs text-amber-900/70 hover:underline dark:text-amber-200/70">
        {copy.skip}
      </button>
    );
}

/** The custom answer and the explicit skip, which never appear together. */
function CustomAndSkip({
  sel,
  current,
  copy,
  allowSkip,
}: {
  sel: AnswerBodyState;
  current: BatchItem;
  copy: Copy;
  allowSkip: boolean;
}) {
  if (sel.isSplitProposal) return null;
  const missingNote = submitBlockReason(
    [current],
    { [current.id]: sel.selected[current.id] ?? [] },
    { [current.id]: sel.custom[current.id] ?? "" },
  );
  return (
    <>
      <BatchCustomInput
        copy={copy}
        value={sel.custom[current.id] ?? ""}
        onType={(value) => sel.typeCustom(current, value)}
      />
      {missingNote ? <p role="note" className="text-xs text-amber-900/80 dark:text-amber-200/80">{missingNote}</p> : null}
      {allowSkip
        ? (
          <SkipControl
            skipped={sel.skipped.has(current.id)}
            copy={copy}
            onSkip={() => sel.skip(current)}
            onUnskip={() => sel.unskip(current)}
          />
        )
        : null}
    </>
  );
}

export function BatchAnswerBody({
  cardId,
  sel,
  current,
  copy,
  allowSkip,
  error,
  splitNotice,
  onOpenArtifact,
}: {
  cardId?: string;
  sel: AnswerBodyState;
  current: BatchItem;
  copy: Copy;
  allowSkip: boolean;
  error: string | null;
  splitNotice: { text: string } | null;
  onOpenArtifact?: OpenArtifactHandler;
}) {
  // A reaction boundary withholds its options, so the list is decided once
  // here instead of in every place that reads `current.options`.
  const shown: BatchItem = { ...current, options: boundaryOptions(current) };
  return (
    <>
      {sel.isSplitProposal
        ? (
          <p className={NOTICE_CLASS}>
            Choose deliveries or <strong>Keep as one card</strong> — not both.
          </p>
        )
        : null}
      <BatchOptionList
        cardId={cardId}
        current={shown}
        isSplitProposal={sel.isSplitProposal}
        splitKeepLabel={sel.splitKeepLabel}
        selected={sel.selected}
        onPick={sel.pick}
        onOpenArtifact={onOpenArtifact}
      />
      <CustomAndSkip sel={sel} current={current} copy={copy} allowSkip={allowSkip} />
      <AnswerStatus splitNotice={splitNotice} error={error} />
    </>
  );
}

/** The split reminder plus any submit error, below the options. Split from
 * the answer body because status rendering is not answer rendering, and the
 * body file sits at its size budget. */
function AnswerStatus({ splitNotice, error }: {
  splitNotice: { text: string } | null;
  error: string | null;
}) {
  return (
    <>
      {splitNotice
        ? (
          <p role="status" className="rounded-md border border-primary/40 bg-primary/10 p-2 text-xs leading-5 text-foreground">
            {splitNotice.text}
          </p>
        )
        : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </>
  );
}

/** How far along the batch is, and what is still owed. Both can show at once. */
function ProgressNotes({
  sel,
  current,
  copy,
  questions,
  allowSkip,
}: {
  sel: AnswerFooterState & AnswerBodyState;
  current: BatchItem;
  copy: Copy;
  questions: BatchItem[];
  allowSkip: boolean;
}) {
  const multi = questions.length > 1;
  return (
    <>
      {multi
        ? <p className={MUTED_CLASS}>{copy.batchProgress(sel.doneCount, questions.length, allowSkip)}</p>
        : null}
      {!multi && current.multiple && !sel.isSplitProposal
        ? <p className={MUTED_CLASS}>{copy.pickOneOrMore}</p>
        : null}
      {sel.isLastQuestion && !sel.complete
        ? (
          <p role="status" className="text-xs text-amber-900/70 dark:text-amber-200/70">
            {copy.answersRemaining(sel.remainingCount, allowSkip)}
          </p>
        )
        : null}
    </>
  );
}

function FooterButtons({
  sel,
  questions,
  copy,
  busy,
  submitLabel,
  blockReason,
  onSubmit,
}: {
  sel: AnswerFooterState;
  questions: BatchItem[];
  copy: Copy;
  busy: boolean;
  submitLabel: string;
  blockReason: string | null;
  onSubmit: (answers: string[][]) => void;
}) {
  const multi = questions.length > 1;
  const lastIndex = questions.length - 1;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {blockReason ? <p role="note" className="w-full text-xs text-amber-900/80 dark:text-amber-200/80">{blockReason}</p> : null}
      {multi
        ? (
          <Button size="sm" variant="outline" disabled={sel.index === 0 || busy} onClick={() => sel.setIndex(Math.max(0, sel.index - 1))}>
            {copy.back}
          </Button>
        )
        : null}
      {multi && sel.index < lastIndex
        ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => sel.setIndex(Math.min(lastIndex, sel.index + 1))}>
            {copy.next}
          </Button>
        )
        : null}
      {sel.isLastQuestion
        ? (
          <Button size="sm" disabled={!sel.complete || busy || blockReason !== null} onClick={() => onSubmit(questions.map((q) => sel.merged(q.id)))}>
            {busy ? copy.sending : submitLabel}
          </Button>
        )
        : null}
    </div>
  );
}

export function BatchFooter({
  sel,
  questions,
  copy,
  busy,
  allowSkip,
  submitLabel,
  onSubmit,
}: {
  sel: AnswerFooterState & AnswerBodyState;
  questions: BatchItem[];
  copy: Copy;
  busy: boolean;
  allowSkip: boolean;
  submitLabel: string;
  onSubmit: (answers: string[][]) => void;
}) {
  const current = questions[Math.min(sel.index, questions.length - 1)];
  if (!current) return null;
  const blockReason = submitBlockReason(questions, sel.selected, sel.custom);
  return (
    <>
      <ProgressNotes sel={sel} current={current} copy={copy} questions={questions} allowSkip={allowSkip} />
      <FooterButtons
        sel={sel}
        questions={questions}
        copy={copy}
        busy={busy}
        submitLabel={submitLabel}
        blockReason={blockReason}
        onSubmit={onSubmit}
      />
    </>
  );
}

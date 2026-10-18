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
import { incompleteBatchReason } from "../../lib/question-presentation.mjs";
import { SPLIT_KEEP_LABEL } from "../../lib/split-proposal.mjs";
import type { BatchItem, OpenArtifactHandler } from "./batch-types";
import type { questionCopy } from "../../lib/question-presentation.mjs";

type Copy = ReturnType<typeof questionCopy>;

const NOTICE_CLASS =
  "rounded-md border border-border bg-background/50 p-2 text-xs leading-5 "
  + "text-muted-foreground";

/** The local needs-note refusal. It keeps amber because it names the one
 * blocking condition and the exit; the split reminder below is a status, not a
 * warning, so it takes the neutral surface. */
const BLOCKED_CLASS =
  "text-xs leading-5 text-amber-700 dark:text-amber-300";

/** The subset of the stepper's selection state the answer controls read. */
export type AnswerBodyState = {
  isSplitProposal: boolean;
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
  invalid = false,
  error = null,
}: {
  copy: Copy;
  value: string;
  onType: (value: string) => void;
  /** The field is the reason the submit was refused, not the batch. */
  invalid?: boolean;
  error?: string | null;
}) {
  // The field-level refusal. The batch's `submitBlockReason` line under the
  // footer is the right place for "question 3 still needs an answer" — the
  // reader is looking at the footer when they press the button. It is the WRONG
  // place for "this note is required", because the keyboard layer lets someone
  // press Cmd/Ctrl+Enter from inside this field: the refusal then lands below the
  // fold of their attention, next to a button they did not touch. So the note
  // owns its own refusal, with the reason attached to the input it is about, and
  // focus stays here with the text intact.
  return (
    <label className="block text-xs font-medium text-muted-foreground">
      <span>{copy.other}</span>
      <input
        value={value}
        onChange={(event) => onType(event.target.value)}
        placeholder={copy.customPlaceholder}
        className={INPUT_CLASS}
        data-batch-note=""
        aria-invalid={invalid ? true : undefined}
        aria-describedby={invalid && error ? "batch-note-error" : undefined}
      />
      {invalid && error ? (
        <span id="batch-note-error" role="alert" className="mt-1 block text-xs leading-5 text-amber-700 dark:text-amber-300">
          {error}
        </span>
      ) : null}
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
      <button onClick={onSkip} className="min-h-11 cursor-pointer text-xs text-muted-foreground hover:underline">
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
        invalid={missingNote !== null}
        error={missingNote}
      />
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
        splitKeepLabel={SPLIT_KEEP_LABEL}
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
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </>
  );
}

function FooterReason({ blockReason, incompleteReason }: {
  blockReason: string | null;
  incompleteReason: string | null;
}) {
  // A refusal outranks the count: it says what to fix, while the count only says
  // how much is left. Both render in the same slot so the footer never grows two
  // stacked notes for one dead button.
  const line = blockReason ?? incompleteReason;
  return line ? <p role="note" className={BLOCKED_CLASS + " w-full"}>{line}</p> : null;
}

function FooterButtons({
  sel,
  questions,
  copy,
  busy,
  submitLabel,
  blockReason,
  incompleteReason,
  onSubmit,
}: {
  sel: AnswerFooterState;
  questions: BatchItem[];
  copy: Copy;
  busy: boolean;
  submitLabel: string;
  blockReason: string | null;
  incompleteReason: string | null;
  onSubmit: (answers: string[][]) => void;
}) {
  const multi = questions.length > 1;
  const lastIndex = questions.length - 1;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <FooterReason blockReason={blockReason} incompleteReason={incompleteReason} />
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

/**
 * The footer's two reasons, and why one of them had no copy.
 *
 * The submit button is disabled by `!sel.complete || blockReason !== null`, but
 * only the refusal half used to render a sentence — so an unanswered batch
 * showed a dead button with no stated cause. `incompleteBatchReason` is that
 * missing half, and it names the door (answer it, or skip it) because the answer
 * is still the reader's to give.
 */
export function BatchFooter({
  sel,
  questions,
  copy,
  busy,
  submitLabel,
  isDone,
  onSubmit,
}: {
  sel: AnswerFooterState & AnswerBodyState;
  questions: BatchItem[];
  copy: Copy;
  busy: boolean;
  submitLabel: string;
  isDone: (id: string) => boolean;
  onSubmit: (answers: string[][]) => void;
}) {
  const current = questions[Math.min(sel.index, questions.length - 1)];
  if (!current) return null;
  const blockReason = submitBlockReason(questions, sel.selected, sel.custom);
  const incompleteReason = incompleteBatchReason(questions, isDone);
  // The reason is stated TWICE on purpose, and a UX review flagged the
  // duplication before this note existed.
  //
  // The field carries it because that is where the fix is: the note input is
  // marked `aria-invalid` with the refusal attached, and the caret is already
  // there when the reader pressed the chord from inside it.
  //
  // The footer carries it because the submit button is DISABLED by the same
  // reason, and a disabled control with no stated cause is a dead end — the
  // failure this codebase refuses everywhere else ("a refusal without an exit").
  // Suppressing it here to avoid repeating a sentence traded a mild redundancy
  // for an unexplained dead button, which the needs-note UI test correctly
  // refused.
  return (
    <FooterButtons
      sel={sel}
      questions={questions}
      copy={copy}
      busy={busy}
      submitLabel={submitLabel}
      blockReason={blockReason}
      incompleteReason={incompleteReason}
      onSubmit={onSubmit}
    />
  );
}

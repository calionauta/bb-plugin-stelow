import { useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { Button } from "@/components/ui/button";
import { DisclosureChevron } from "../disclosure";
import { questionCopy } from "../../lib/question-presentation.mjs";
import { expiredAnswerPayload } from "../../lib/expired-question-answers.mjs";
import { isSplitQuestion, splitQuestionText, splitSelectionNotice } from "../../lib/split-question-presentation.mjs";
import { SPLIT_KEEP_LABEL } from "../../lib/split-proposal.mjs";
import { BatchOptionList } from "./batch-options";
import type {
  BatchItem,
  ExpiredQuestionItem,
  OpenArtifactHandler,
  QuestionStalenessNotice,
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
  ExpiredQuestionItem,
  OpenArtifactHandler,
  QuestionStalenessNotice,
} from "./batch-types";

// One class for both disclosures (preview and touched paths) so a keyboard
// focus ring reads identically wherever a disclosure appears.
const DISCLOSURE_SUMMARY_CLASS = [
  "inline-flex min-h-11 cursor-pointer items-center gap-1.5",
  "text-xs font-medium hover:underline",
  "focus-visible:outline focus-visible:outline-2",
].join(" ");

// Advisory only: names what moved since a question was asked — a revised or
// removed document, a moved checkout with the touched paths — and points at
// the existing exits (re-open the doc, request changes, regress the stage).
// It never blocks answering and adds no new actions of its own.
// Advisory only: names what moved since a question was asked — a revised or
// removed document, a moved checkout with the touched paths — and points at
// the existing exits (re-open the doc, request changes, regress the stage).
// It never blocks answering and adds no new actions of its own.
//
// The file paths are what made this unusable: on a real card the notice
// listed seven paths and pushed the actual question off the screen. The
// reader needs the WARNING first and the paths only if they are auditing
// which files moved, so the paths collapse behind a summary that still shows
// the count. "What this means" is stated before "what changed", because the
// first thing a person has to decide is whether it matters.
function StalenessNotice({ staleness }: { staleness: QuestionStalenessNotice }) {
  if (!staleness.docRevised && !staleness.docRemoved && !staleness.checkoutMoved) return null;
  const paths = staleness.touchedPaths;
  return (
    <div className="rounded-md border border-amber-600/40 bg-amber-600/10 p-2 text-xs leading-relaxed text-amber-900 dark:text-amber-200" role="note" aria-label="Evidence changed since asked">
      <p className="font-semibold">Something changed since this question was asked</p>
      <p className="mt-1">
        {staleness.docRemoved
          ? "A document this question relies on can no longer be opened."
          : staleness.docRevised
            ? "A document this question relies on was revised."
            : `${staleness.commitCount} commit${staleness.commitCount === 1 ? "" : "s"} landed.`}
        {" "}Check the linked document before answering if your choice depends on it.
      </p>
      {paths.length > 0 ? (
        <details className="mt-1">
          <summary
            className={DISCLOSURE_SUMMARY_CLASS}

          >
            <DisclosureChevron />
            {paths.length} file{paths.length === 1 ? "" : "s"} touched
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 font-mono text-[11px]">
            {paths.map((path) => <li key={path} className="break-all">{path}</li>)}
          </ul>
        </details>
      ) : null}
      <p className="mt-1 text-amber-900/70 dark:text-amber-200/70">If the plan no longer matches the code, request changes or return it to an earlier stage from Workflow progress.</p>
    </div>
  );
}

// Batch selection state: stepper position, per-question picks, free-text
// customs, and explicit skips — plus the merged answers each question
// contributes to the atomic submit. One hook so the dots, the options,
// and the footer always read the same decisions.
// Exception to the 50-line function rule (2026-09-23): this hook is one
// cohesive selection state machine (position, picks, customs, skips plus
// the split keep/clear rule). Its parts are coupled — splitting custom
// from skip or pick from merged would scatter one decision across hooks
// for the metric's sake (KISS wins). Revisit if it grows past 70.
function useBatchSelection(questions: BatchItem[]) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  // Nullable: the stepper renders nothing for an empty batch, but hooks
  // run unconditionally — the shell guards before reading current.
  const current = questions.length === 0 ? null : (questions[Math.min(index, questions.length - 1)] as BatchItem);
  const isSplitProposal = current ? isSplitQuestion(current) : false;
  const splitKeepLabel = SPLIT_KEEP_LABEL;
  const merged = (id: string): string[] => {
    if (skipped.has(id)) return [];
    const out = [...(selected[id] ?? [])];
    const text = (custom[id] ?? "").trim();
    if (text) out.push(text);
    return out;
  };
  const doneCount = questions.filter((q) => skipped.has(q.id) || merged(q.id).length > 0).length;
  const remainingCount = questions.length - doneCount;
  const complete = remainingCount === 0;
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
        if (label === splitKeepLabel) return { ...prev, [question.id]: has ? [] : [splitKeepLabel] };
        const withoutKeep = (prev[question.id] ?? []).filter((item) => item !== splitKeepLabel);
        return { ...prev, [question.id]: has ? withoutKeep.filter((item) => item !== label) : [...withoutKeep, label] };
      }
      if (question.multiple) return { ...prev, [question.id]: has ? prev[question.id]!.filter((item) => item !== label) : [...(prev[question.id] ?? []), label] };
      // Single-select: an option and a custom text are mutually exclusive.
      if (!has) setCustom((c) => ({ ...c, [question.id]: "" }));
      return { ...prev, [question.id]: has ? [] : [label] };
    });
  };
  const typeCustom = (question: BatchItem, value: string) => {
    setCustom((prev) => ({ ...prev, [question.id]: value }));
    if (value.trim() && !question.multiple) setSelected((prev) => ({ ...prev, [question.id]: [] }));
    if (value.trim()) setSkipped((prev) => { const next = new Set(prev); next.delete(question.id); return next; });
  };
  const skip = (question: BatchItem) => {
    setSkipped((prev) => new Set(prev).add(question.id));
    setSelected((prev) => ({ ...prev, [question.id]: [] }));
    setCustom((prev) => ({ ...prev, [question.id]: "" }));
  };
  const unskip = (question: BatchItem) => setSkipped((prev) => { const next = new Set(prev); next.delete(question.id); return next; });
  return { index, setIndex, selected, custom, skipped, current, isSplitProposal, splitKeepLabel, merged, pick, typeCustom, skip, unskip, doneCount, remainingCount, complete, isLastQuestion };
}

// Stepper dots: one step per question, done steps checked, exactly one tab
// stop on the current step.
function BatchStepDots({ questions, index, onSelect, isDone, copy }: {
  questions: BatchItem[];
  index: number;
  onSelect: (index: number) => void;
  isDone: (id: string) => boolean;
  copy: ReturnType<typeof questionCopy>;
}) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={copy.questions}>
      {questions.map((q, i) => {
        const done = isDone(q.id);
        return (
          <button
            key={q.id}
            aria-current={i === index ? "step" : undefined}
            aria-label={`${copy.questionOf(i + 1, questions.length)}${done ? ` (${copy.answered})` : ""}`}
            onClick={() => onSelect(i)}
            className={`inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md border px-2 text-xs font-medium ${i === index ? "border-primary bg-primary/15 text-foreground" : done ? "border-emerald-500/50 bg-emerald-500/10 text-foreground" : "border-border bg-background/40 text-muted-foreground"}`}
          >
            {done && i !== index ? "✓ " : ""}{i + 1}
          </button>
        );
      })}
    </div>
  );
}

// Question heading: progress counters, step dots, title, prompt, the
// staleness advisory, and the split exclusivity notice.
function BatchQuestionHeading({ questions, index, showHeading, copy, current, prompt, onSelectDot, isDone }: {
  questions: BatchItem[];
  index: number;
  showHeading?: boolean;
  copy: ReturnType<typeof questionCopy>;
  current: BatchItem;
  prompt: string;
  onSelectDot: (index: number) => void;
  isDone: (id: string) => boolean;
}) {
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {showHeading ? <div className="text-sm font-medium text-amber-900 dark:text-amber-200">
          {questions.length > 1 ? copy.answersNeeded(questions.length) : copy.answerNeeded}
        </div> : null}
        {questions.length > 1 ? <div className="text-xs text-amber-900/70 dark:text-amber-200/70">{copy.questionOf(index + 1, questions.length)}</div> : null}
      </div>
      {questions.length > 1 ? (
        <BatchStepDots questions={questions} index={index} onSelect={onSelectDot} isDone={isDone} copy={copy} />
      ) : null}
      {current.title ? <div className="text-sm font-medium text-amber-900 dark:text-amber-200">{current.title}</div> : null}
      {prompt ? <p className="text-sm text-amber-900/80 dark:text-amber-200/80">{prompt}</p> : null}
      {current.staleness ? <StalenessNotice staleness={current.staleness} /> : null}
    </>
  );
}

// Free-text "Other": an option and a custom text stay mutually exclusive
// on single-select (the hook clears the other side on each keystroke).
function BatchCustomInput({ copy, value, onType }: {
  copy: ReturnType<typeof questionCopy>;
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
        className="mt-1 min-h-11 w-full cursor-text rounded-md border border-border bg-background/60 px-2 text-sm font-normal text-foreground placeholder:text-muted-foreground"
      />
    </label>
  );
}

// radio (single) / checkbox (multi) options plus a free-text "Other", explicit
// skip, and a single atomic submit — one worker resume, one inbox resolution.
export function BatchStepper({ questions, allowSkip, busy, error, submitLabel, showHeading = true, onSubmit, onOpenArtifact }: {
  questions: BatchItem[];
  allowSkip: boolean;
  busy: boolean;
  error: string | null;
  submitLabel: string;
  showHeading?: boolean;
  onSubmit: (answers: string[][]) => void;
  onOpenArtifact?: OpenArtifactHandler;
}) {
  const sel = useBatchSelection(questions);
  if (questions.length === 0) return null;
  const current = sel.current!;
  const copy = questionCopy();
  const prompt = sel.isSplitProposal ? splitQuestionText(current.prompt) : current.prompt;
  const splitNotice = sel.isSplitProposal ? splitSelectionNotice(current.options, sel.selected[current.id] ?? []) : null;
  const isDone = (id: string): boolean => sel.skipped.has(id) || sel.merged(id).length > 0;
  return (
    <div role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300">?</span>
        <div className="min-w-0 flex-1 space-y-2">
          <BatchQuestionHeading questions={questions} index={sel.index} showHeading={showHeading} copy={copy} current={current} prompt={prompt} onSelectDot={sel.setIndex} isDone={isDone} />
          {sel.isSplitProposal ? <p className="rounded-md border border-amber-500/30 bg-background/50 p-2 text-xs leading-5 text-amber-900/80 dark:text-amber-100/80">Choose deliveries or <strong className="text-amber-900 dark:text-amber-100">Keep as one card</strong> — not both.</p> : null}
          <BatchOptionList current={current} isSplitProposal={sel.isSplitProposal} splitKeepLabel={sel.splitKeepLabel} selected={sel.selected} onPick={sel.pick} onOpenArtifact={onOpenArtifact} />
          {splitNotice ? <p role="status" className="rounded-md border border-primary/40 bg-primary/10 p-2 text-xs leading-5 text-foreground">{splitNotice.text}</p> : null}
          {!sel.isSplitProposal ? <BatchCustomInput copy={copy} value={sel.custom[current.id] ?? ""} onType={(value) => sel.typeCustom(current, value)} /> : null}
          {allowSkip && !sel.isSplitProposal ? (
            sel.skipped.has(current.id)
              ? <button onClick={() => sel.unskip(current)} className="min-h-11 cursor-pointer text-xs font-medium text-primary hover:underline">{copy.skipped}</button>
              : <button onClick={() => sel.skip(current)} className="min-h-11 cursor-pointer text-xs text-amber-900/70 hover:underline dark:text-amber-200/70">{copy.skip}</button>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {questions.length > 1 ? (
            <p className="text-xs text-amber-900/60 dark:text-amber-200/60">{copy.batchProgress(sel.doneCount, questions.length, allowSkip)}</p>
          ) : current.multiple && !sel.isSplitProposal ? (
            <p className="text-xs text-amber-900/60 dark:text-amber-200/60">{copy.pickOneOrMore}</p>
          ) : null}
          {sel.isLastQuestion && !sel.complete ? <p role="status" className="text-xs text-amber-900/70 dark:text-amber-200/70">{copy.answersRemaining(sel.remainingCount, allowSkip)}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            {questions.length > 1 ? <Button size="sm" variant="outline" disabled={sel.index === 0 || busy} onClick={() => sel.setIndex((i) => Math.max(0, i - 1))}>{copy.back}</Button> : null}
            {questions.length > 1 && sel.index < questions.length - 1 ? <Button size="sm" variant="outline" disabled={busy} onClick={() => sel.setIndex((i) => Math.min(questions.length - 1, i + 1))}>{copy.next}</Button> : null}
            {sel.isLastQuestion ? <Button size="sm" disabled={!sel.complete || busy} onClick={() => onSubmit(questions.map((q) => sel.merged(q.id)))}>{busy ? copy.sending : submitLabel}</Button> : null}
          </div>
        </div>
      </div>
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
  const rpc = useRpc<typeof rpcContract>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (questions.length === 0) return null;
  const copy = questionCopy();
  async function submit(all: string[][]) {
    setBusy(true); setError(null);
    try {
      if (mode === "live") {
        const result = await rpc.call("answerQuestions", { cardId, answers: questions.map((q, i) => ({ questionId: q.id, answers: all[i] ?? [] })) });
        if (!result.ok) { setError(result.error ?? "Could not send the answers."); return; }
      } else {
        // Timed-out questions retain every selected option. The batch stays
        // atomic, so a later answer cannot revise work already resumed.
        const payload = expiredAnswerPayload(questions, all);
        if (payload.length === 0) return;
        const result = await rpc.call("answerExpiredQuestions", { cardId, answers: payload });
        if (!result.ok) { setError(result.error ?? "Could not send the answers."); return; }
      }
      onAnswered();
    } finally {
      setBusy(false);
    }
  }
  return (
      <BatchStepper
        questions={questions}
        allowSkip={mode === "live"}
        busy={busy}
        error={error}
        submitLabel={questions.length > 1 ? copy.submitAnswers : copy.submitAnswer}
        showHeading={mode !== "expired"}
        onSubmit={(all) => void submit(all)}
        onOpenArtifact={onOpenArtifact}
      />
  );
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
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">{copy.recoveryHeading}</h3>
        <QuestionBatch
          cardId={cardId}
          mode="expired"
          questions={questions.map((q) => ({ id: q.id, title: "", prompt: q.question, multiple: q.multiple, kind: q.kind, options: q.options, staleness: q.staleness ?? null }))}
          onAnswered={onAnswered}
          onOpenArtifact={onOpenArtifact}
        />
    </section>
  );
}

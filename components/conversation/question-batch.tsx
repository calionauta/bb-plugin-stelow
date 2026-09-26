import { useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { Button } from "@/components/ui/button";
import { DisclosureChevron } from "../disclosure";
import { questionCopy } from "../../lib/question-presentation.mjs";
import { expiredAnswerPayload } from "../../lib/expired-question-answers.mjs";
import { isSplitQuestion, splitOptionDescription, splitQuestionText, splitSelectionNotice } from "../../lib/split-question-presentation.mjs";
import { SPLIT_KEEP_LABEL } from "../../lib/split-proposal.mjs";

// Question conversation: the stepper (radio/checkbox options, free-text
// Other, explicit skip, atomic submit), the live batch (answerQuestions),
// and the expired batch (answerExpiredQuestions, every selected option
// retained). Every track renders the same conversation — one home, not
// three pasted steppers.

export type AskArtifact = { path: string; display: string; absolutePath: string | null; hostId: string | null };
export type ArtifactViewerMode = "review" | "comment";
export type QuestionStalenessNotice = { docRevised: boolean; docRemoved: boolean; checkoutMoved: boolean; commitCount: number; touchedPaths: string[] };
export type BatchOption = {
  label: string;
  description: string;
  preview: string | null;
  artifact: AskArtifact | null;
  // True when the document came from a sibling rather than this option.
  artifactInherited?: boolean;
};

export type BatchItem = {
  id: string;
  title: string;
  prompt: string;
  multiple: boolean;
  kind?: "standard" | "split";
  options: BatchOption[];
  staleness?: QuestionStalenessNotice | null;
};
// Structural view of a timed-out question: the section maps it into a
// BatchItem, so the card never imports the detail contract for this.
export type ExpiredQuestionItem = { id: string; question: string; multiple: boolean; kind?: "standard" | "split"; options: BatchItem["options"]; staleness?: QuestionStalenessNotice | null };

function artifactViewerModeForOption(label: string): ArtifactViewerMode {
  // An approval is a decision after reading, not a request to alter the
  // document. All other choices — especially Request/Review changes — keep
  // the full quote-and-comment path to communicate precise feedback.
  return /\b(approve|accept|proceed)\b/i.test(label) ? "review" : "comment";
}

// Per-option evidence: the document opens from inside the option row
// (right side), the inline glance expands below. The artifact opens in the
// viewer where a file opener exists (card), and degrades to a plain
// filename where it doesn't (thread) — never a dead button pretending
// to open, never one shared button after the options.
function OptionPreview({ preview }: { preview: string | null }) {
  if (!preview) return null;
  return (
    <div className="ml-1 space-y-1 border-l-2 border-muted pl-2">
      <details className="group">
        <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-xs font-medium text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><DisclosureChevron />Preview</summary>
        <pre className="whitespace-pre-wrap rounded-md border bg-background/60 p-2 font-mono text-[11px] leading-relaxed">{preview}</pre>
      </details>
    </div>
  );
}

// Advisory only: names what moved since a question was asked — a revised or
// removed document, a moved checkout with the touched paths — and points at
// the existing exits (re-open the doc, request changes, regress the stage).
// It never blocks answering and adds no new actions of its own.
function StalenessNotice({ staleness }: { staleness: QuestionStalenessNotice }) {
  if (!staleness.docRevised && !staleness.docRemoved && !staleness.checkoutMoved) return null;
  return (
    <div className="rounded-md border border-amber-600/40 bg-amber-600/10 p-2 text-xs leading-relaxed text-amber-900 dark:text-amber-200" role="note" aria-label="Evidence changed since asked">
      <p className="font-semibold">Something changed since this question was asked</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {staleness.docRevised ? <li>A linked document was revised — open the current version from the options below before answering.</li> : null}
        {staleness.docRemoved ? <li>A linked document can no longer be opened at its recorded path.</li> : null}
        {staleness.checkoutMoved ? <li>{staleness.commitCount > 0
          ? `${staleness.commitCount} commit${staleness.commitCount === 1 ? "" : "s"} landed since${staleness.touchedPaths.length > 0 ? `, touching ${staleness.touchedPaths.join(", ")}` : ""}. The plan may assume code that changed.`
          : "The checkout moved since this question was asked. The plan may assume code that changed."}</li> : null}
      </ul>
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

// One option row: the select control, the label, the per-option document,
// and the inline preview glance.
function BatchOptionRow({ option, active, multiple, isKeepOption, description, onPick, onOpenArtifact }: {
  option: BatchItem["options"][number];
  active: boolean;
  multiple: boolean;
  isKeepOption: boolean;
  description: string;
  onPick: () => void;
  onOpenArtifact?: (artifact: AskArtifact, mode: ArtifactViewerMode) => void;
}) {
  const artifact = option.artifact;
  const artifactInherited = option.artifactInherited === true;
  return (
    <div className={`space-y-1 ${isKeepOption ? "mt-2 border-t border-amber-500/30 pt-2" : ""}`}>
      <div className={`flex min-h-11 items-stretch overflow-hidden rounded-md border ${active ? "border-primary bg-primary/10" : "border-border bg-background/40 hover:border-primary/50"}`}>
        <button
          role={multiple ? "checkbox" : "radio"}
          aria-checked={active}
          onClick={onPick}
          className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-start gap-3 p-3 text-left text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          <span aria-hidden className={`mt-0.5 flex size-5 shrink-0 items-center justify-center border-2 text-xs font-bold ${multiple && !isKeepOption ? "rounded-sm" : "rounded-full"} ${active ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/70 bg-background"}`}>{active ? "✓" : ""}</span>
          <span className="min-w-0"><span className="block font-medium">{option.label}</span>{description ? <span className="mt-1 block whitespace-pre-line text-xs leading-5 text-muted-foreground">{description}</span> : null}</span>
        </button>
        {artifact ? (
          onOpenArtifact ? (
            // The option's own document, not a second decision: it
            // sits inside the row instead of forming a slab beside
            // it, and borrows the shared outline treatment so it
            // harmonizes with the amber panel and the primary
            // accents instead of introducing a third color.
            //
            // The label names the FILE. "Open document" alone made the
            // reader guess what they were about to open, and a filename
            // buried in a hover-only title is not a label. When the
            // document was inherited from a sibling it says so, because
            // the same brief on four rows otherwise reads as four pieces
            // of evidence about four different options.
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenArtifact(artifact, artifactViewerModeForOption(option.label))}
              title={artifactInherited
                ? `${artifact.display} — the brief shared by every option, not this option's own document`
                : `${artifact.display} — this option's own document`}
              aria-label={artifactInherited
                ? `Open the shared brief ${artifact.display}, the same document every option links to`
                : `Open this option's document ${artifact.display}`}
              className="mr-2 min-h-11 max-w-[16rem] shrink-0 gap-1 self-center"
            >
              <span className="truncate">
                {artifactInherited ? "Shared brief" : "Open"}: {artifact.display}
              </span>
              <span aria-hidden>↗</span>
            </Button>
          ) : (
            <span className="inline-flex shrink-0 items-center self-center px-1 text-[11px] text-muted-foreground" title={artifact.path}>{artifact.display}</span>
          )
        ) : null}
      </div>
      <OptionPreview preview={option.preview} />
    </div>
  );
}

// Option list: one row per option of the current question, with split
// descriptions resolved per row.
function BatchOptionList({ current, isSplitProposal, splitKeepLabel, selected, onPick, onOpenArtifact }: {
  current: BatchItem;
  isSplitProposal: boolean;
  splitKeepLabel: string;
  selected: Record<string, string[]>;
  onPick: (question: BatchItem, label: string) => void;
  onOpenArtifact?: (artifact: AskArtifact, mode: ArtifactViewerMode) => void;
}) {
  return (
    <div className="grid gap-1" role={current.multiple ? "group" : "radiogroup"} aria-label={current.title}>
      {current.options.map((option) => {
        const active = (selected[current.id] ?? []).includes(option.label);
        const isKeepOption = isSplitProposal && option.label === splitKeepLabel;
        return (
          <BatchOptionRow
            key={option.label}
            option={option}
            active={active}
            multiple={current.multiple}
            isKeepOption={isKeepOption}
            description={isSplitProposal ? splitOptionDescription(option.description) : option.description}
            onPick={() => onPick(current, option.label)}
            onOpenArtifact={onOpenArtifact}
          />
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
  onOpenArtifact?: (artifact: AskArtifact, mode: ArtifactViewerMode) => void;
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

export function QuestionBatch({ cardId, questions, mode, onAnswered, onOpenArtifact }: { cardId: string; questions: BatchItem[]; mode: "live" | "expired"; onAnswered: () => void; onOpenArtifact?: (artifact: AskArtifact, mode: ArtifactViewerMode) => void }) {
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

export function ExpiredQuestionsSection({ cardId, questions, onAnswered, onOpenArtifact }: { cardId: string; questions: ExpiredQuestionItem[]; onAnswered: () => void; onOpenArtifact?: (artifact: AskArtifact, mode: ArtifactViewerMode) => void }) {
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

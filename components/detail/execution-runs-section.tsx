import { useState } from "react";
import { cn } from "../../lib/utils";
import { DisclosureSection, DisclosureChevron } from "../disclosure";
import { executionRunRowId } from "../../lib/execution-deep-link.mjs";
import { ExecutionRunDetail } from "./execution-run-detail";
import { liveProgressNote } from "../../lib/execution-run-presentation.mjs";
import { runStatusLabel } from "../../lib/execution-run-ledger.mjs";
import { stageLabel } from "../../lib/workflow-vocabulary.mjs";
import { RunActions } from "./execution-run-actions";
import type { RunCard } from "./execution-run-row-types";
import type { ExecutionRun } from "./use-execution-runs";

type ExecutionRunsSectionProps = {
  card: RunCard;
  runs: ExecutionRun[];
  focusRunId: string | null;
  stoppingRunId: string | null;
  retryingRunId: string | null;
  /** The run holding the card at its current stage, decided by the server by
   * the same rule the advance gate uses. Null when nothing is blocked. */
  blockingRunId: string | null;
  onCancel: (runId: string) => void | Promise<void>;
  onRetry: (runId: string) => void | Promise<void>;
};


// A run waiting on a person is the one state the card must never understate:
// it is not stalled and not broken. The question is the run's own words, so
// it is quoted rather than summarized, and the tone is informational-amber
// rather than the muted grey of a passive status.
function waitingForYou(run: ExecutionRun) {
  if (run.normalizedStatus !== "needs_input") return null;
  const question = typeof run.boundaryQuestion === "string" ? run.boundaryQuestion.trim() : "";
  return {
    question: question.length > 0 ? question : null,
    label: question.length > 0 ? "Waiting for you" : "Waiting for you — the run asked a question the card could not read",
  };
}

// One run's identity line. A run waiting on a person quotes its own question
// so the card reads as a question, not a stalled spinner; everything else
// keeps the plain status line.
//
// The stage is NOT repeated here: the row's own title already names it, in the
// card's own words. It used to appear a second time as the raw slug — so a row
// read "planning-research / Running · planning" while every other surface on the
// card said "Tech Planning", and a reader had no way to tell those were the same
// stage. One fact, one place, in the vocabulary the rest of the card uses.
function RunSummary({ run, waiting }: { run: ExecutionRun; waiting: ReturnType<typeof waitingForYou> }) {
  const live = liveProgressNote(run.normalizedStatus);
  if (!waiting) {
    return (
      <p className="text-xs text-muted-foreground">
        {runStatusLabel(run.normalizedStatus)}
        {live ? ` · ${live}` : ""}
      </p>
    );
  }
  return (
    <>
      <p className="text-xs font-medium text-amber-900 dark:text-amber-200">{waiting.label}</p>
      {waiting.question ? <p className="mt-1 text-sm text-foreground">{waiting.question}</p> : null}
      <p className="mt-1 text-xs text-muted-foreground">The run is paused until you answer on the card.</p>
    </>
  );
}

/**
 * What the section's header says about the runs it lists.
 *
 * While work is in flight the active count is the only thing that matters, so
 * it leads. Once nothing is running, the interesting fact is the tally: a
 * card that failed twice and then succeeded is a different story from one that
 * succeeded first time, and neither is visible in a list of labels. Failures
 * come before successes, because a card that ended green after two failures is
 * exactly the one where the failures are the context.
 */
function runOutcomeHint(runs: ExecutionRun[], active: number): string {
  if (active > 0) return `${active} active`;
  const failed = runs.filter((run) => run.normalizedStatus === "failed").length;
  const cancelled = runs.filter((run) => run.normalizedStatus === "cancelled").length;
  const succeeded = runs.filter((run) => run.normalizedStatus === "succeeded").length;
  const parts: string[] = [];
  if (failed > 0) parts.push(`${failed} failed`);
  if (succeeded > 0) parts.push(`${succeeded} succeeded`);
  if (cancelled > 0) parts.push(`${cancelled} cancelled`);
  return parts.length > 0 ? parts.join(" · ") : `${runs.length} queued`;
}

// The disclosure toggle's affordances, named so the row reads as a row: the
// same hit target as a button, the same focus ring as every other control on
// the card, and quiet until the reader reaches for it.
const CHEVRON_BUTTON = [
  "-ml-1 flex min-h-11 shrink-0 cursor-pointer items-center rounded-md px-1",
  "text-muted-foreground hover:text-foreground",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
].join(" ");

/**
 * The row's own disclosure toggle.
 *
 * "Open" navigates: it centres the row and rings it, which is right when the
 * reader arrives from a deep link. But the common case is someone already
 * looking at this list, asking why a run failed — and for them the answer was
 * a button that moved the page without adding anything. So the row also opens
 * in place, showing the run's own account of itself.
 *
 * A run a deep link just opened starts expanded. The link exists because
 * someone asked "what happened to this run" from somewhere the card could not
 * answer; landing on a collapsed row would answer that question with a status
 * label the link was meant to replace. It is not forced — the reader can close
 * it — because a disclosure nobody can close is a dialog.
 */
function RunChevron({ run, open, onToggle }: { run: ExecutionRun; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      className={CHEVRON_BUTTON}
      title={open ? "Hide this run's details" : "Show this run's details"}
      onClick={onToggle}
    >
      {/* The shared chevron, not a second one. This row drew its own `▶` span
          with a copy of the rotation classes one commit after the shared one was
          made the rule — the exact leak the rule exists to stop, introduced by
          the change that announced it. */}
      <DisclosureChevron open={open} />
      <span className="sr-only">{open ? "Hide" : "Show"} details for the {run.recipeId} run</span>
    </button>
  );
}

/**
 * One run's row. Extracted from the section so the section reads as a list and
 * this reads as a card: the tone, the focus anchor, and the two actions are
 * decided once, here, instead of inside a mapping callback.
 *
 * The row names ITSELF — `executionRunRowId`, never the deep link's focus id.
 * It used to borrow that helper, which for a run waiting on a person returns
 * the card's question section, so the row and that section both claimed one id
 * while the focus effect searched for a third. A row's identity and a link's
 * destination are different questions, and conflating them made "Open" a
 * no-op.
 *
 * A run a deep link just opened starts EXPANDED. The link exists because
 * someone asked what happened to this run from somewhere the card could not
 * answer; landing on a collapsed row would answer that with the status label
 * the link was meant to replace. It is seeded rather than forced — the reader
 * can still close it, because a disclosure nobody can dismiss is a dialog.
 *
 * The outline for a focused row rides `focusRunId` rather than
 * :focus-visible, because a programmatically focused div never raises
 * :focus-visible at all — and a deep link that lands silently is
 * indistinguishable from a button that does nothing.
 */
function ExecutionRunRow({
  card,
  run,
  focusRunId,
  stoppingRunId,
  retryingRunId,
  blockingRunId,
  onCancel,
  onRetry,
}: {
  card: ExecutionRunsSectionProps["card"];
  run: ExecutionRun;
  focusRunId: string | null;
  stoppingRunId: string | null;
  retryingRunId: string | null;
  blockingRunId: string | null;
  onCancel: ExecutionRunsSectionProps["onCancel"];
  onRetry: ExecutionRunsSectionProps["onRetry"];
}) {
  const waiting = waitingForYou(run);
  const [open, setOpen] = useState(focusRunId === run.id);
  return (
    <div
      id={executionRunRowId(run.id) ?? undefined}
      tabIndex={focusRunId === run.id ? -1 : undefined}
      className={cn(
        "rounded-md border px-3 py-2",
        waiting ? "border-amber-500/40 bg-amber-500/10" : "bg-background/60",
        focusRunId === run.id && "outline-2 outline-offset-2 outline-primary",
      )}
    >
      <RunHeader
        card={card}
        run={run}
        waiting={waiting}
        open={open}
        stopping={stoppingRunId === run.id}
        retrying={retryingRunId === run.id}
        blocking={blockingRunId === run.id}
        onToggle={() => setOpen((value) => !value)}
        onCancel={onCancel}
        onRetry={onRetry}
      />
      {/* The details sit OUTSIDE the header flex line, so a long failure reason
          wraps under the whole row instead of being squeezed between the
          chevron and the Open button. */}
      {open ? <ExecutionRunDetail run={run} /> : null}
    </div>
  );
}

/** The row's single line: who it is, how it reads, and the two actions. */
function RunHeader({
  card,
  run,
  waiting,
  open,
  stopping,
  retrying,
  blocking,
  onToggle,
  onCancel,
  onRetry,
}: {
  card: ExecutionRunsSectionProps["card"];
  run: ExecutionRun;
  waiting: ReturnType<typeof waitingForYou>;
  open: boolean;
  stopping: boolean;
  retrying: boolean;
  blocking: boolean;
  onToggle: () => void;
  onCancel: ExecutionRunsSectionProps["onCancel"];
  onRetry: ExecutionRunsSectionProps["onRetry"];
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-1">
        <RunChevron run={run} open={open} onToggle={onToggle} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{stageLabel(run.stage)}</p>
          <RunSummary run={run} waiting={waiting} />
        </div>
      </div>
      <RunActions
        card={card}
        run={run}
        active={["queued", "running", "needs_input"].includes(run.normalizedStatus)}
        stopping={stopping}
        retrying={retrying}
        blocking={blocking}
        onCancel={onCancel}
        onRetry={onRetry}
      />
    </div>
  );
}

/**
 * The run list, as a disclosure.
 *
 * It was a permanently-open bordered box holding one bordered row per run — so
 * a card with a dozen finished runs pushed everything below it a dozen rows
 * down the page, on the one card kind where the reader usually came for
 * something else. Runs that have finished are history; history is exactly what
 * a disclosure is for.
 *
 * It starts OPEN while work is in flight, because then it is the live surface
 * — someone watching a run wants to see it move, not open a section. It starts
 * CLOSED once nothing is running, and the header keeps the tally visible so
 * closing it costs the reader the outcomes and nothing else.
 */
export function ExecutionRunsSection({ card, runs, focusRunId, stoppingRunId, retryingRunId, blockingRunId, onCancel, onRetry }: ExecutionRunsSectionProps) {
  const active = runs.filter((run) => ["queued", "running", "needs_input"].includes(run.normalizedStatus)).length;
  if (runs.length === 0) return null;
  // A deep link names a run. Landing on a section that is not showing that run
  // would repeat the original bug in a new costume, so the link opens it.
  //
  // A BLOCKING run opens it too, and that is the same rule the rest of the card
  // follows — a section starts closed unless it is live or blocking. A failed
  // run holding the card at its stage is blocking by definition, and leaving
  // the section shut put the Retry button — the door the advance refusal names
  // — one undisclosed click away from the message telling the reader to press
  // it. A gate whose door is hidden is a gate that reads as a dead end.
  const [open, setOpen] = useState(active > 0 || focusRunId !== null || blockingRunId !== null);
  return (
    <DisclosureSection
      title="Execution runs"
      subtitle="what each run did"
      hint={runOutcomeHint(runs, active)}
      open={open}
      onToggle={setOpen}
    >
      <div className="space-y-2">
        {runs.map((run) => (
          <ExecutionRunRow
            key={run.id}
            card={card}
            run={run}
            focusRunId={focusRunId}
            stoppingRunId={stoppingRunId}
            retryingRunId={retryingRunId}
            blockingRunId={blockingRunId}
            onCancel={onCancel}
            onRetry={onRetry}
          />
        ))}
      </div>
    </DisclosureSection>
  );
}

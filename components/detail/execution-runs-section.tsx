import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { goToExecutionRun } from "../app-support/navigation";
import { executionRunFocus } from "../../lib/execution-deep-link.mjs";
import type { ExecutionRun } from "./use-execution-runs";

type ExecutionRunsSectionProps = {
  card: { id: string; kind: "build" | "research" | "explore" };
  runs: ExecutionRun[];
  focusRunId: string | null;
  stoppingRunId: string | null;
  onCancel: (runId: string) => void | Promise<void>;
};

const stateLabel: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  needs_input: "Needs input",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
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
// keeps the plain status-and-stage line.
function RunSummary({ run, waiting }: { run: ExecutionRun; waiting: ReturnType<typeof waitingForYou> }) {
  if (!waiting) {
    return (
      <p className="text-xs text-muted-foreground">
        {stateLabel[run.normalizedStatus] ?? run.normalizedStatus}
        {run.stage ? ` · ${run.stage}` : ""}
      </p>
    );
  }
  return (
    <>
      <p className="text-xs font-medium text-amber-900 dark:text-amber-200">{waiting.label}</p>
      {waiting.question ? <p className="mt-1 text-sm text-foreground">{waiting.question}</p> : null}
      <p className="mt-1 text-xs text-muted-foreground">
        {run.stage ? `${run.stage} · ` : ""}The run is paused until you answer on the card.
      </p>
    </>
  );
}

/** What a person can do with a run: open its transcript, or stop it. */
function RunActions({
  card,
  run,
  active,
  stopping,
  onCancel,
}: {
  card: ExecutionRunsSectionProps["card"];
  run: ExecutionRun;
  active: boolean;
  stopping: boolean;
  onCancel: ExecutionRunsSectionProps["onCancel"];
}) {
  const navigate = useBbNavigate();
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        className="min-h-11 cursor-pointer rounded-md border px-3 text-xs hover:bg-muted"
        onClick={() => goToExecutionRun(navigate, card, run)}
      >
        Open
      </button>
      {active ? (
        <button
          type="button"
          className="min-h-11 cursor-pointer rounded-md border px-3 text-xs text-destructive hover:bg-muted"
          disabled={stopping}
          onClick={() => void onCancel(run.id)}
        >
          {stopping ? "Stopping…" : "Stop"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * One run's row. Extracted from the section so the section reads as a list and
 * this reads as a card: the tone, the focus anchor, and the two actions are
 * decided once, here, instead of inside a mapping callback.
 */
function ExecutionRunRow({
  card,
  run,
  focusRunId,
  stoppingRunId,
  onCancel,
}: {
  card: ExecutionRunsSectionProps["card"];
  run: ExecutionRun;
  focusRunId: string | null;
  stoppingRunId: string | null;
  onCancel: ExecutionRunsSectionProps["onCancel"];
}) {
  const focusId = executionRunFocus({
    localRunId: run.id,
    status: run.normalizedStatus,
    hasQuestion: run.normalizedStatus === "needs_input",
  });
  const waiting = waitingForYou(run);
  return (
    <div
      id={focusId ?? undefined}
      tabIndex={focusRunId === run.id ? -1 : undefined}
      className={waiting
        ? "flex min-h-11 items-start justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
        : "flex min-h-11 items-center justify-between gap-3 rounded-md border bg-background/60 px-3 py-2"}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{run.recipeId}</p>
        <RunSummary run={run} waiting={waiting} />
      </div>
      <RunActions
        card={card}
        run={run}
        active={["queued", "running", "needs_input"].includes(run.normalizedStatus)}
        stopping={stoppingRunId === run.id}
        onCancel={onCancel}
      />
    </div>
  );
}

export function ExecutionRunsSection({ card, runs, focusRunId, stoppingRunId, onCancel }: ExecutionRunsSectionProps) {
  const active = runs.filter((run) => ["queued", "running", "needs_input"].includes(run.normalizedStatus)).length;
  if (runs.length === 0) return null;
  return (
    <section aria-label="Execution runs" className="rounded-lg border bg-card/60 p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Execution runs</h2>
        <span className="text-xs text-muted-foreground">{active} active</span>
      </div>
      <div className="space-y-2">
        {runs.map((run) => (
          <ExecutionRunRow
            key={run.id}
            card={card}
            run={run}
            focusRunId={focusRunId}
            stoppingRunId={stoppingRunId}
            onCancel={onCancel}
          />
        ))}
      </div>
    </section>
  );
}

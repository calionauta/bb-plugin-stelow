import { formatDuration } from "../../lib/card-metrics.mjs";
import { relativeTime } from "../../lib/relative-time.mjs";
import type { ExecutionRun } from "./use-execution-runs";

/**
 * One run's own account of itself.
 *
 * The row above it says "succeeded" or "failed" — a label. This is the part a
 * person opening a card to find out what happened cannot get anywhere else:
 * why it failed, how long it ran, whether it is a retry. The RPC already
 * returns every field here, so showing them costs a disclosure, not a query.
 *
 * Nothing here invents a value. A run that has not finished has no duration,
 * and a run that failed with no recorded reason says so in those words rather
 * than dressing the absence up as a cause.
 */
function Field({ label, value }: { label: string; value: string }) {
  return (
    // The label column is fixed on a desktop and proportional on a phone. `7rem` is right
    // when the card is 768px wide and takes 19% of a 375px one, where "Failed with" beside a
    // long error code leaves the value about 230px to wrap in. Below `sm` the split is
    // `minmax(0,auto)`, so the label takes what it needs and the value gets the rest.
    <div className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-2 py-0.5 text-xs sm:grid-cols-[7rem_minmax(0,1fr)]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{value}</dd>
    </div>
  );
}

// "3s" beats "started 3 seconds ago" here: the reader is comparing runs, not
// reading a feed, and a relative clock re-bases every second.
function duration(run: ExecutionRun): string | null {
  if (typeof run.startedAt !== "number") return null;
  const end = typeof run.completedAt === "number" ? run.completedAt : Date.now();
  const ms = end - run.startedAt;
  if (!Number.isFinite(ms) || ms < 0) return null;
  return formatDuration(ms);
}

export function ExecutionRunDetail({ run }: { run: ExecutionRun }) {
  const length = duration(run);
  const finished = typeof run.completedAt === "number";
  return (
    <div className="mt-2 space-y-1 border-t pt-2">
      <dl>
        {typeof run.startedAt === "number"
          ? <Field label="Started" value={`${relativeTime(run.startedAt)}${length ? ` · ran ${length}` : " · still running"}`} />
          : null}
        {finished
          ? <Field label="Finished" value={relativeTime(run.completedAt as number)} />
          : null}
        {run.runId
          ? <Field label="Host run" value={run.runId} />
          : null}
        {run.adapter
          ? <Field label="Adapter" value={run.adapter} />
          : null}
        {run.resumeOf
          ? <Field label="Retries" value={`resumes ${run.resumeOf}`} />
          : null}
        {run.errorCode
          ? <Field label="Failed with" value={run.errorCode} />
          : null}
        {run.normalizedStatus === "failed" && !run.errorCode
          ? (
            <Field
              label="Failed with"
              value="no reason was recorded — the host reported the failure without one"
            />
          )
          : null}
      </dl>
      {run.boundaryQuestion
        ? (
          <div className="pt-1">
            <p className="text-xs font-medium text-foreground">Question it asked</p>
            <p className="mt-0.5 text-xs leading-relaxed text-foreground">{run.boundaryQuestion}</p>
          </div>
        )
        : null}
    </div>
  );
}

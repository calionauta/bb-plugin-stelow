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

export function ExecutionRunsSection({ card, runs, focusRunId, stoppingRunId, onCancel }: ExecutionRunsSectionProps) {
  const navigate = useBbNavigate();
  if (runs.length === 0) return null;
  return (
    <section aria-label="Execution runs" className="rounded-lg border bg-card/60 p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Execution runs</h2>
        <span className="text-xs text-muted-foreground">
          {runs.filter((run) => ["queued", "running", "needs_input"].includes(run.normalizedStatus)).length} active
        </span>
      </div>
      <div className="space-y-2">
        {runs.map((run) => {
          const focusId = executionRunFocus({
            localRunId: run.id,
            status: run.normalizedStatus,
            hasQuestion: run.normalizedStatus === "needs_input",
          });
          const active = ["queued", "running", "needs_input"].includes(run.normalizedStatus);
          return (
            <div
              id={focusId ?? undefined}
              tabIndex={focusRunId === run.id ? -1 : undefined}
              key={run.id}
              className="flex min-h-11 items-center justify-between gap-3 rounded-md border bg-background/60 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{run.recipeId}</p>
                <p className="text-xs text-muted-foreground">{stateLabel[run.normalizedStatus] ?? run.normalizedStatus}{run.stage ? ` · ${run.stage}` : ""}</p>
              </div>
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
                    disabled={stoppingRunId === run.id}
                    onClick={() => void onCancel(run.id)}
                  >
                    {stoppingRunId === run.id ? "Stopping…" : "Stop"}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

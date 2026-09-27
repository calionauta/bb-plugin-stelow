import { useCallback, useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { executionRunFocus, executionRunRowId } from "../../lib/execution-deep-link.mjs";
import type { rpcContract } from "../../server";

type ExecutionRunState = "queued" | "running" | "needs_input" | "succeeded" | "failed" | "cancelled";
export type ExecutionRun = {
  id: string;
  normalizedStatus: ExecutionRunState;
  recipeId: string;
  stage: string;
  // Present when the run is waiting on a person. Carrying the run's own
  // words lets the card show the actual question instead of a status label
  // the reader has to open a trail to decode.
  boundaryQuestion?: string | null;
};

export function useExecutionRuns(cardId: string, focusRunId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const [runs, setRuns] = useState<ExecutionRun[]>([]);
  const [stoppingRunId, setStoppingRunId] = useState<string | null>(null);
  const load = useCallback(async () => {
    const result = await rpc.call("executionRuns", { cardId });
    setRuns(result.runs as ExecutionRun[]);
  }, [cardId, rpc]);

  useEffect(() => { void load().catch(() => undefined); }, [load]);
  // A deep link has to be observable, or "Open" is a button that does nothing.
  // Two things made it invisible: the scroll asked for the "nearest" block,
  // which is defined to move nothing when the target is already on screen, and
  // the focus was told not to scroll. So opening a run while the Execution runs
  // section was already visible produced no motion and no change at all — the
  // card did navigate, and the reader saw precisely nothing. Centering brings
  // the run to the middle of the viewport every time, and the opened row draws a
  // ring so it is obvious WHICH run.
  //
  // The target comes from the shared helper, not a hand-written id: a run
  // waiting on a person aims at the card's question section, and hardcoding
  // `execution-run-<id>` there found nothing and silently did nothing.
  useEffect(() => {
    if (!focusRunId) return;
    const run = runs.find((entry) => entry.id === focusRunId);
    const targetId = run
      ? executionRunFocus({
          localRunId: run.id,
          status: run.normalizedStatus,
          hasQuestion: run.normalizedStatus === "needs_input",
        })
      : null;
    const target = targetId ? document.getElementById(targetId) : null;
    target?.scrollIntoView({ block: "center" });
    (target ?? document.getElementById(executionRunRowId(focusRunId) ?? ""))?.focus();
  }, [focusRunId, runs]);

  const cancel = useCallback(async (runId: string) => {
    setStoppingRunId(runId);
    try {
      await rpc.call("cancelExecutionRun", { runId });
      await load();
    } finally {
      setStoppingRunId(null);
    }
  }, [load, rpc]);

  return { runs, stoppingRunId, cancel };
}

import { useCallback, useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";

type ExecutionRunState = "queued" | "running" | "needs_input" | "succeeded" | "failed" | "cancelled";
export type ExecutionRun = {
  id: string;
  normalizedStatus: ExecutionRunState;
  recipeId: string;
  stage: string;
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
  useEffect(() => {
    if (!focusRunId) return;
    const target = document.getElementById(`execution-run-${focusRunId}`);
    target?.scrollIntoView({ block: "nearest" });
    target?.focus({ preventScroll: true });
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

import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { ResearchStrategyOption } from "../creation/creation-settings";
import { useDetailComment } from "../conversation/use-detail-comment";
import { useDetailRecoveryActions } from "../manage/detail-recovery-actions";
import type { ResearchIndexState } from "./research-detail-dialogs";
import type { ViewerFile } from "./research-detail-types";
import type { rpcContract } from "../../server";

export function useResearchIndex(cardId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [index, setIndex] = useState<ResearchIndexState | null>(null);
  const [strategies, setStrategies] = useState<ResearchStrategyOption[]>([]);
  const [refresh, setRefresh] = useState(0);
  const loadIndex = useCallback(async () => {
    try {
      const [nextIndex, nextStrategies] = await Promise.all([
        rpc.call("researchIndex", { cardId }),
        rpc.call("researchStrategies", {}).catch(() => ({ strategies: [] })),
      ]);
      setIndex(nextIndex);
      setStrategies(nextStrategies.strategies);
    } catch {
      setIndex({ found: false, indexPath: null, content: null, truncated: false, opportunities: [], rounds: [], error: "Unable to load the index." });
    }
  }, [cardId, rpc]);

  useEffect(() => { void loadIndex(); }, [loadIndex, refresh]);
  const refreshIndex = () => setRefresh((value) => value + 1);
  return { index, strategies, loadIndex, refreshIndex };
}

function useWorkerActions(cardId: string, onChanged: () => void) {
  const rpc = useRpc<typeof rpcContract>();
  const [starting, setStarting] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const { retrying, doRetry, repairing, doQualityRepair } = useDetailRecoveryActions({
    cardId,
    trackNoun: "research",
    onChanged,
  });

  async function start() {
    setStarting(true);
    try {
      const result = await rpc.call("startWorker", { cardId });
      if (!result.ok) toast.error(result.error ?? "Start failed.");
      else toast.success("Worker started — the research is now Doing.");
      onChanged();
    } finally {
      setStarting(false);
    }
  }

  return { starting, restarting, retrying, repairing, start, doRetry, doQualityRepair, setRestarting };
}

export function useResearchDetailState(cardId: string, cardStatus: string | undefined, onChanged: () => void) {
  const rpc = useRpc<typeof rpcContract>();
  const { index, strategies, loadIndex, refreshIndex } = useResearchIndex(cardId);
  const { comment, setComment, submitComment } = useDetailComment({ cardId, onChanged });
  const actions = useWorkerActions(cardId, onChanged);
  const [restartWorkerOpen, setRestartWorkerOpen] = useState(false);
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [viewerFile, setViewerFile] = useState<ViewerFile | null>(null);
  const [fanOutOpen, setFanOutOpen] = useState(false);
  const [strategyRunOpen, setStrategyRunOpen] = useState(false);
  const inboxEventRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (cardStatus === "completed") void rpc.call("markCardNotificationsRead", { cardId, kind: "completed" }).catch(() => {});
  }, [cardId, cardStatus, rpc]);

  async function restartWorker() {
    setRestartWorkerOpen(false);
    actions.setRestarting(true);
    try {
      const result = await rpc.call("restartWorker", { cardId });
      if (!result.ok) toast.error(result.error ?? "Restart failed.");
      else toast.success("Worker restarted — continuing the research.");
      onChanged();
    } finally {
      actions.setRestarting(false);
    }
  }

  const onQuestionsChanged = () => { onChanged(); void loadIndex(); };
  return {
    index, strategies, comment, setComment, submitComment, actions, restartWorker,
    restartWorkerOpen, setRestartWorkerOpen, presetDialogOpen, setPresetDialogOpen,
    viewerFile, setViewerFile, fanOutOpen, setFanOutOpen, strategyRunOpen,
    setStrategyRunOpen, inboxEventRef, onQuestionsChanged, refreshIndex,
  };
}

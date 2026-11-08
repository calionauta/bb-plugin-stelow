import { useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import type { ResearchStrategyOption } from "../creation/creation-settings";
import { useDetailComment } from "../conversation/use-detail-comment";
import { useDetailRecoveryActions } from "../manage/detail-recovery-actions";
import { runTrackRestart, runTrackStart } from "./use-track-worker-actions";
import type { ViewerFile } from "./research-detail-types";

function useExploreWorkerActions(cardId: string, onChanged: () => void) {
  const rpc = useRpc<typeof rpcContract>();
  const [starting, setStarting] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const recovery = useDetailRecoveryActions({ cardId, trackNoun: "exploration", onChanged });

  async function start() {
    return runTrackStart(rpc, cardId, onChanged, "exploration", setStarting);
  }

  return { ...recovery, starting, restarting, setRestarting, start };
}

export function useExploreDetailState(cardId: string, cardStatus: string | undefined, onChanged: () => void) {
  const rpc = useRpc<typeof rpcContract>();
  const [stages, setStages] = useState<ResearchStrategyOption[]>([]);
  const { comment, setComment, submitComment } = useDetailComment({ cardId, onChanged });
  const actions = useExploreWorkerActions(cardId, onChanged);
  const [restartWorkerOpen, setRestartWorkerOpen] = useState(false);
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [viewerFile, setViewerFile] = useState<ViewerFile | null>(null);
  const inboxEventRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    rpc.call("stageCatalog", {}).then((result) => setStages(result.stages)).catch(() => {});
  }, [rpc]);
  useEffect(() => {
    if (cardStatus === "completed") void rpc.call("markCardNotificationsRead", { cardId, kind: "completed" }).catch(() => {});
  }, [cardId, cardStatus, rpc]);

  async function restartWorker() {
    setRestartWorkerOpen(false);
    return runTrackRestart(rpc, cardId, onChanged, "exploration", actions.setRestarting);
  }

  return {
    stages, comment, setComment, submitComment, actions, restartWorker,
    restartWorkerOpen, setRestartWorkerOpen, presetDialogOpen, setPresetDialogOpen,
    viewerFile, setViewerFile, inboxEventRef,
  };
}

import { useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../../server";
import type { ResearchStrategyOption } from "../creation/creation-settings";
import { useDetailComment } from "../conversation/use-detail-comment";
import { useDetailRecoveryActions } from "../manage/detail-recovery-actions";
import type { ViewerFile } from "./research-detail-types";

function useExploreWorkerActions(cardId: string, onChanged: () => void) {
  const rpc = useRpc<typeof rpcContract>();
  const [starting, setStarting] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const recovery = useDetailRecoveryActions({ cardId, trackNoun: "exploration", onChanged });

  async function start() {
    setStarting(true);
    try {
      const result = await rpc.call("startWorker", { cardId });
      if (!result.ok) toast.error(result.error ?? "Start failed.");
      else toast.success("Worker started — the exploration is now Doing.");
      onChanged();
    } finally {
      setStarting(false);
    }
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
    actions.setRestarting(true);
    try {
      const result = await rpc.call("restartWorker", { cardId });
      if (!result.ok) toast.error(result.error ?? "Restart failed.");
      else toast.success("Worker restarted — continuing the exploration.");
      onChanged();
    } finally {
      actions.setRestarting(false);
    }
  }

  return {
    stages, comment, setComment, submitComment, actions, restartWorker,
    restartWorkerOpen, setRestartWorkerOpen, presetDialogOpen, setPresetDialogOpen,
    viewerFile, setViewerFile, inboxEventRef,
  };
}

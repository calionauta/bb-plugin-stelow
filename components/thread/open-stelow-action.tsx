import { useEffect, useState } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { STELOW_PANEL_ID, cardSubPath } from "../panel/stelow-route.mjs";
import { rememberStelowReturnFocusCardId } from "../panel/stelow-focus.mjs";
import {
  openCardTargetForThread,
  normalizeOpenCardTarget,
  type LoadedOpenCardTarget,
} from "../../lib/message-directives.mjs";
import type { rpcContract } from "../../server";

type OpenStelowActionProps = {
  threadId: string;
};

export function OpenStelowAction({ threadId }: OpenStelowActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [loadedTarget, setLoadedTarget] = useState<LoadedOpenCardTarget | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoadedTarget(null);
    void rpc.call("cardByWorkerThread", { threadId })
      .then((result) => {
        const target = normalizeOpenCardTarget(result);
        if (!cancelled && target) setLoadedTarget({ threadId, target });
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [rpc, threadId]);
  const target = openCardTargetForThread(loadedTarget, threadId);
  if (!target) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      className="shrink-0 self-center"
      onClick={() => {
        rememberStelowReturnFocusCardId(target.cardId);
        navigate.toPluginPanel(STELOW_PANEL_ID, { subPath: cardSubPath(target, target.cardId) });
      }}
      title="Open this card"
    >
      Stelow card ↗
    </Button>
  );
}

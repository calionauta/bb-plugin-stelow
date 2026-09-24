import { useEffect, useState } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { STELOW_PANEL_ID, cardSubPath } from "../panel/stelow-route.mjs";
import { rememberStelowReturnFocusCardId } from "../panel/stelow-focus.mjs";
import { normalizeOpenCardTarget, type OpenCardTarget } from "../../lib/message-directives.mjs";
import type { rpcContract } from "../../server";

type OpenStelowActionProps = {
  threadId: string;
};

export function OpenStelowAction({ threadId }: OpenStelowActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [target, setTarget] = useState<OpenCardTarget | null>(null);
  useEffect(() => {
    let cancelled = false;
    setTarget(null);
    void rpc.call("cardByWorkerThread", { threadId })
      .then((result) => {
        if (!cancelled) setTarget(normalizeOpenCardTarget(result));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [rpc, threadId]);
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

import { useEffect, useState } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { STELOW_PANEL_ID } from "../panel/stelow-route.mjs";

const NUDGE_STORAGE_KEY = "stelow-hide-graph-nudge";

/**
 * Whether the host can show a live graph right now. Null while the probe is
 * in flight; false covers both "not installed" and "the host did not
 * answer", because in either case there is no action to offer.
 */
export function useAgentGraphAvailable(): boolean | null {
  const rpc = useRpc<typeof rpcContract>();
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void rpc.call("agentGraphStatus", {}).then((result) => {
      if (!cancelled) setAvailable(result.available === true);
    }).catch(() => {
      if (!cancelled) setAvailable(false);
    });
    return () => { cancelled = true; };
  }, [rpc]);
  return available;
}

/**
 * The contextual mention when the capability is absent: benefit-worded, sent
 * to About where the reader goes on purpose, and dismissable — never a
 * permanent badge in the working surface.
 */
export function GraphNudge({ threadId }: { threadId: string | null | undefined }) {
  const navigate = useBbNavigate();
  const available = useAgentGraphAvailable();
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(NUDGE_STORAGE_KEY) === "1") setDismissed(true);
    } catch {
      setDismissed(false);
    }
  }, []);
  if (!threadId || available !== false || dismissed) return null;
  function dismiss() {
    try {
      window.localStorage.setItem(NUDGE_STORAGE_KEY, "1");
    } catch {
      // A full store is not a reason to keep nagging; hide for this view.
    }
    setDismissed(true);
  }
  return (
    <span className="flex w-full flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>See what this card&apos;s agent is doing live — the About tab lists the capability.</span>
      <button
        type="button"
        onClick={() => navigate.toPluginPanel(STELOW_PANEL_ID, { subPath: "about" })}
        className="cursor-pointer min-h-11 font-medium text-primary hover:underline"
      >
        Open About
      </button>
      <button
        type="button"
        onClick={dismiss}
        className="cursor-pointer min-h-11 font-medium text-muted-foreground hover:underline"
      >
        Dismiss
      </button>
    </span>
  );
}

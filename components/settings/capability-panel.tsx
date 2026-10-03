import { useCallback, useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";

type AgentGraphStatus = {
  id: "agent-graph";
  name: "Agent Graph";
  installed: boolean;
  enabled: boolean;
  running: boolean;
  available: boolean;
  version: string | null;
  detail: string;
};

function statusLabel(status: AgentGraphStatus) {
  if (status.available) return "Running";
  if (status.installed && status.enabled) return "Starting";
  if (status.installed) return "Installed but disabled";
  return "Not installed";
}

/**
 * The capability panel: what the host can do for a card, and whether it is
 * present. Read-only on purpose — a plugin install changes the host, so this
 * panel detects and points to BB Extensions but never installs, enables, or
 * otherwise changes anything itself.
 */
export function CapabilityPanel() {
  const rpc = useRpc<typeof rpcContract>();
  const [status, setStatus] = useState<AgentGraphStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void rpc.call("agentGraphStatus", {}).then((result) => {
      setStatus(result as AgentGraphStatus);
      setError(null);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [rpc]);

  useEffect(refresh, [refresh]);

  return (
    <section
      className="rounded-lg border bg-muted/20 p-3"
      aria-label="Live-graph capability"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">Live agent graph</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Watch a card&apos;s agent as a live node graph — threads, turns, and
            tool calls — from the card itself.
          </p>
        </div>
        <span className={`shrink-0 text-xs font-medium ${status?.available ? "text-emerald-600" : "text-muted-foreground"}`}>
          {status ? statusLabel(status) : "Checking…"}
        </span>
      </div>
      {status ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {status.detail}{status.version ? ` · v${status.version}` : ""}
        </p>
      ) : null}
      {status && !status.installed ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Find it in BB → Extensions as Agent Graph.
        </p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-destructive" role="alert">{error}</p> : null}
    </section>
  );
}

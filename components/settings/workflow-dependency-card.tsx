import { useCallback, useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../../server";
import { Button } from "../ui/button";

type WorkflowDependencyStatus = {
  id: "workflows";
  name: "BB Workflows";
  installed: boolean;
  enabled: boolean;
  running: boolean;
  available: boolean;
  version: string | null;
  action: "install" | "enable" | null;
  detail: string;
};

function statusLabel(status: WorkflowDependencyStatus) {
  if (status.available) return "Enabled and ready";
  if (status.installed && status.enabled) return "Enabled; starting";
  if (status.installed) return "Installed but disabled";
  return "Not installed";
}

function actionLabel(action: "install" | "enable", busy: boolean) {
  if (busy) return "Configuring…";
  return action === "install" ? "Install BB Workflows" : "Enable BB Workflows";
}

function DependencyHeader({ status }: { status: WorkflowDependencyStatus | null }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-foreground">BB Workflows integration</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Durable native execution for Stelow recipes, including status tracking, resume,
          cancellation, structured outputs, and safe parallel fan-out when supported.
        </p>
      </div>
      <span className={`shrink-0 text-xs font-medium ${status?.available ? "text-emerald-600" : "text-muted-foreground"}`}>
        {status ? statusLabel(status) : "Checking…"}
      </span>
    </div>
  );
}

/** The one primary action the card offers, plus the state it reports back. */
function DependencyAction({
  status,
  busy,
  onAction,
}: {
  status: WorkflowDependencyStatus | null;
  busy: boolean;
  onAction: () => void;
}) {
  if (status?.action) {
    return (
      <Button className="mt-3" size="sm" disabled={busy} onClick={onAction}>
        {actionLabel(status.action, busy)}
      </Button>
    );
  }
  if (status?.available) {
    return (
      <p className="mt-2 text-xs text-emerald-600">
        Native execution is available for eligible Stelow recipes.
      </p>
    );
  }
  return null;
}

export function WorkflowDependencyCard() {
  const rpc = useRpc<typeof rpcContract>();
  const [status, setStatus] = useState<WorkflowDependencyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void rpc.call("workflowDependencyStatus", {}).then((result) => {
      setStatus(result as WorkflowDependencyStatus);
      setError(null);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [rpc]);

  useEffect(refresh, [refresh]);

  const applyAction = useCallback(async () => {
    const action = status?.action;
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      const result = action === "install"
        ? await rpc.call("installWorkflowDependency", {})
        : await rpc.call("enableWorkflowDependency", {});
      setStatus(result.status as WorkflowDependencyStatus);
      if (!result.ok) throw new Error(result.error || "BB Workflows could not be configured.");
      toast.success(action === "install" ? "BB Workflows installed" : "BB Workflows enabled");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }, [rpc, status?.action]);

  return (
    <section className="rounded-lg border bg-muted/20 p-3" aria-label="BB Workflows integration">
      <DependencyHeader status={status} />
      {status ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {status.detail}{status.version ? ` · v${status.version}` : ""}
        </p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-destructive" role="alert">{error}</p> : null}
      <DependencyAction status={status} busy={busy} onAction={() => void applyAction()} />
    </section>
  );
}

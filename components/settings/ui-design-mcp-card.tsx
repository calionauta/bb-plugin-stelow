import { useCallback, useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { Button } from "../ui/button";

type ServerId = "inspo";

/** Shared shape, so the card and the About panel cannot drift apart. */
export type UiDesignMcpServer = {
  id: ServerId;
  name: string;
  repo: string;
  package: string;
  register: string;
  plain: string;
  feeds: string;
  note: string;
  clients: Array<{
    client: string;
    name: string;
    state: "registered" | "unregistered" | "not-installed" | "not-allowed" | "unsupported";
    detail: string;
  }>;
  usable: number;
  pending: number;
  missing: string[];
  state: "ready" | "available" | "absent";
};

export type UiDesignMcpStatus = {
  servers: UiDesignMcpServer[];
  bbProviders: string[];
  unmappedProviders: string[];
  unsupported: Array<{ client: string; name: string; note: string }>;
};

/**
 * The one read both the About panel and the onboarding card depend on.
 *
 * Re-reads on mount rather than caching: registration is per agent CLI, so a
 * CLI installed since the last visit is the entire reason to re-check. Errors
 * are keyed by server so the full panel can show one failure without hiding a
 * neighbouring server's state.
 */
export function useUiDesignMcp() {
  const rpc = useRpc<typeof rpcContract>();
  const [status, setStatus] = useState<UiDesignMcpStatus | null>(null);
  const [busyId, setBusyId] = useState<ServerId | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const refresh = useCallback(() => {
    void rpc
      .call("uiDesignMcpStatus", {})
      .then((result) => setStatus(result as UiDesignMcpStatus))
      .catch((reason) => {
        setErrors((previous) => ({ ...previous, _read: String(reason) }));
      });
  }, [rpc]);

  useEffect(refresh, [refresh]);

  function register(serverId: ServerId) {
    setBusyId(serverId);
    setErrors((previous) => ({ ...previous, [serverId]: "" }));
    void rpc
      .call("registerUiDesignMcp", { serverId })
      .then((result) => {
        setStatus(result.status as UiDesignMcpStatus);
        if (!result.ok) {
          setErrors((previous) => ({
            ...previous,
            [serverId]: result.error || "Registration did not take effect.",
          }));
        }
      })
      .catch((reason: unknown) => {
        setErrors((previous) => ({
          ...previous,
          [serverId]: reason instanceof Error ? reason.message : String(reason),
        }));
      })
      .finally(() => setBusyId(null));
  }

  return { status, busyId, errors, register, refresh };
}

/**
 * The onboarding-sized card. Deliberately not the About panel's full listing:
 * a modal already runs three steps and is shown once per track, so this states
 * the one fact that matters — installed or not, and what you get.
 *
 * The copy never implies a dependency. Nothing in the workflow needs this
 * server: without it, Interface Alternatives proposes from its archetype
 * library and the audit is unchanged. So the ask is a quality offer, and it is
 * opt-in in the strict sense — one click, never on visit.
 */
export function UiDesignMcpCard() {
  const { status, busyId, errors, register } = useUiDesignMcp();
  const server = status?.servers[0] ?? null;
  const installed = (server?.usable ?? 0) > 0;
  const error = server ? errors[server.id] : undefined;

  return (
    <section
      className="rounded-lg border bg-muted/20 p-3"
      aria-label="UI design reference (optional)"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">UI design reference — optional</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Lets a worker look at real shipped sites before it writes an interface, instead of
            reconstructing a layout from memory — the usual source of generic-looking UI.
            Nothing depends on it: without it, proposals still come from the archetype library.
          </p>
        </div>
        <span
          className={`shrink-0 text-xs font-medium ${installed ? "text-emerald-600" : "text-muted-foreground"}`}
        >
          {!status ? "Checking…" : installed ? "Installed" : "Not installed"}
        </span>
      </div>
      {status && !installed && server && server.pending > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          bb can use {server.missing.join(", ")} — installing registers it for{" "}
          {server.pending === 1 ? "that one" : "all of them"}.
        </p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-destructive" role="alert">{error}</p> : null}
      {status && !installed && server ? (
        <Button
          className="mt-3"
          size="sm"
          disabled={busyId === server.id}
          onClick={() => register(server.id)}
        >
          {busyId === server.id ? "Installing…" : "Install design reference"}
        </Button>
      ) : null}
    </section>
  );
}

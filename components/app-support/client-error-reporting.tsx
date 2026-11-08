import * as React from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { Button } from "../ui/button";

/**
 * Client failures, sent to the server so they stop dying in the console.
 *
 * The plugin records what the host did (`rpc.call`, `cli.call`, `run.finished`)
 * and had no row for the one surface a person actually looks at. A render that
 * throws inside a panel unmounts Stelow and leaves a blank frame; a rejected
 * promise inside an effect vanishes; both are invisible in every server log,
 * because neither ever reached the server.
 *
 * Two doors, one reporter:
 *
 *   the boundary   catches render/lifecycle errors in the trees we register,
 *                  reports, and shows a small fallback instead of a blank
 *                  surface;
 *   the listeners  catch `error` and `unhandledrejection` for failures outside
 *                  React's reach while any Stelow surface is mounted.
 *
 * The reporter is module-level because the global listeners outlive any one
 * component and cannot call a hook. A mounted boundary sets it and clears it on
 * unmount; a failure with no mounted surface is genuinely unreportable (there
 * is no client), and that is a smaller gap than a second fetch layer nobody
 * asked for.
 *
 * Reporting is best-effort and rate-limited by the server's own action log:
 * the cause is a fingerprint of the message, so a loop of the same render error
 * is one row with `occurrences`, never a flood.
 */
type Reporter = (failure: { message: string; stack?: string; surface: string }) => void;

let reporter: Reporter | null = null;
let listenersInstalled = false;

export function ClientErrorBoundary({
  surface,
  cardId,
  children,
}: {
  surface: string;
  cardId?: string;
  children: React.ReactNode;
}) {
  const rpc = useRpc<typeof rpcContract>();
  React.useEffect(() => {
    const report: Reporter = ({ message, stack, surface: from }) => {
      void rpc
        .call("reportClientError", {
          surface: from,
          message,
          ...(stack ? { stack } : {}),
          ...(cardId ? { cardId } : {}),
        })
        .catch(() => undefined);
    };
    reporter = report;
    installGlobalListeners();
    return () => {
      if (reporter === report) reporter = null;
    };
  }, [rpc, surface, cardId]);

  return (
    <Boundary
      onError={(error, info) => {
        reporter?.({
          surface,
          message: error.message || "Unknown client error",
          stack: info.componentStack ?? error.stack,
        });
      }}
    >
      {children}
    </Boundary>
  );
}

type BoundaryProps = {
  onError: (error: Error, info: React.ErrorInfo) => void;
  children: React.ReactNode;
};

class Boundary extends React.Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.props.onError(error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
        <p className="text-xs font-medium text-destructive">This part of Stelow failed to render.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          The error was recorded. Try again, or reopen the panel.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-2 min-h-11"
          onClick={() => this.setState({ failed: false })}
        >
          Try again
        </Button>
      </div>
    );
  }
}

function installGlobalListeners(): void {
  if (listenersInstalled || typeof window === "undefined") return;
  listenersInstalled = true;
  window.addEventListener("error", (event) => {
    reporter?.({
      surface: "window",
      message: event.message || "Unknown window error",
      stack: event.error instanceof Error ? event.error.stack : undefined,
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason;
    reporter?.({
      surface: "promise",
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}

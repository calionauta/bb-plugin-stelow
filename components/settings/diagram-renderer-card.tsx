import { useCallback, useEffect, useState } from "react";
import { UrlLink, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import {
  PELE_HOMEPAGE,
  PELE_INSTALL,
  PELE_PIN,
  PELE_PLAYGROUND,
  PELE_REPO,
} from "../../lib/diagram-strategy.mjs";

type DiagramRendererStatus = {
  present: boolean;
  version: string | null;
  detail: string;
};

function RendererLinks() {
  const linkClass = [
    "inline-flex h-8 cursor-pointer items-center justify-center gap-2",
    "whitespace-nowrap rounded-md border bg-card px-3 text-xs font-medium shadow-sm",
    "hover:border-primary/50",
  ].join(" ");
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <UrlLink href={PELE_REPO} title="pele repository" className={linkClass}>
        pele repo ↗
      </UrlLink>
      <UrlLink href={PELE_HOMEPAGE} title="pele homepage" className={linkClass}>
        pele.run ↗
      </UrlLink>
      <UrlLink href={PELE_PLAYGROUND} title="pele playground" className={linkClass}>
        Playground ↗
      </UrlLink>
    </div>
  );
}

/**
 * The bundled diagram renderer card: whether pele resolves in this install.
 *
 * Read-only like the live-graph capability: pele ships with the plugin
 * (`dependencies`, exact pin), so bb installs it together with the plugin
 * and there is no host install to dispatch. A missing renderer reads as
 * absent with the reinstall path, never as a throw.
 */
export function DiagramRendererCard() {
  const rpc = useRpc<typeof rpcContract>();
  const [status, setStatus] = useState<DiagramRendererStatus | null>(null);

  const refresh = useCallback(() => {
    void rpc
      .call("diagramRendererStatus", {})
      .then((result) => setStatus(result as DiagramRendererStatus))
      .catch(() => setStatus(null));
  }, [rpc]);

  useEffect(refresh, [refresh]);

  return (
    <section className="rounded-lg border bg-muted/20 p-3" aria-label="Diagram renderer">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">Diagram renderer · pele v{PELE_PIN}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Breadboard, scope map, and tech-sequence views are derived diagrams: the JSON or
            Markdown stays the source of truth, the `.mmd` is its projection, and the sibling
            `.html` page is the durable view. The viewer renders `.mmd` inline and keeps the
            source beside it.
          </p>
        </div>
        <span className={`shrink-0 text-xs font-medium ${status?.present ? "text-emerald-600" : "text-muted-foreground"}`}>
          {status ? (status.present ? `Ready · v${status.version ?? PELE_PIN}` : "Absent") : "Checking…"}
        </span>
      </div>
      {status ? (
        <p className="mt-2 text-xs text-muted-foreground">{status.detail}</p>
      ) : null}
      <RendererLinks />
      <pre className="mt-2 overflow-x-auto rounded-md border bg-background/60 p-2 font-mono text-xs leading-relaxed">
        {PELE_INSTALL}
      </pre>
    </section>
  );
}

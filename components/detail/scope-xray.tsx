export type ScopeXrayView = {
  source: "server-projection";
  mutable: false;
  mapId: string;
  mapVersion: string;
  freshness: "current" | "stale" | "unknown";
  nodes: Array<{
    id: string;
    title: string;
    capabilities: string[];
    state: "current" | "stale" | "blocked" | "unknown";
    provenance: string[];
  }>;
  edges: Array<{
    from: string;
    to: string;
    kind: "depends-on";
    state: "current" | "stale" | "blocked" | "unknown";
    provenance: string[];
  }>;
};

export function ScopeXray({ xray }: { xray: ScopeXrayView }) {
  const dependencies = xray.edges
    .map((edge) => `${edge.from} → ${edge.to}`)
    .join(" · ");
  return (
    <section
      className="space-y-2 rounded-md border bg-muted/20 p-3"
      aria-label="Scope X-ray"
    >
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold">Scope X-ray</h3>
        <span className="text-[11px] text-muted-foreground">
          Read-only · {xray.freshness}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Server projection of the approved map; it does not change scope
        ownership.
      </p>
      <ul className="space-y-1">
        {xray.nodes.map((node) => (
          <li key={node.id} className="flex flex-wrap items-center gap-1 text-xs">
            <span className="font-mono text-muted-foreground">{node.id}</span>
            <span>{node.title}</span>
            <span className="text-muted-foreground">· {node.state}</span>
            {node.capabilities.length > 0 ? (
              <span className="text-muted-foreground">
                · {node.capabilities.join(", ")}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {dependencies ? (
        <p className="text-[11px] text-muted-foreground">
          Dependencies: {dependencies}
        </p>
      ) : null}
    </section>
  );
}

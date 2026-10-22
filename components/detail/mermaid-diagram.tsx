import { useEffect, useState } from "react";
import { UrlLink } from "@get-bb/plugin-sdk/app";
import { PELE_PLAYGROUND } from "../../lib/diagram-strategy.mjs";

type PeleModule = { render: (source: string) => { svg?: string } };

/** Render state for one Mermaid source: the SVG, or the refusal to draw it. */
function useMermaidSvg(source: string) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setFailed(false);
    void import("pele")
      .then((mod) => {
        if (cancelled) return;
        try {
          const result = (mod as unknown as PeleModule).render(source);
          if (result?.svg) setSvg(result.svg);
          else setFailed(true);
        } catch {
          setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  return { svg, failed };
}

function RenderFailed() {
  return (
    <p className="text-xs text-muted-foreground">
      Diagram did not render in this install — the source below is intact.{" "}
      <UrlLink
        href={PELE_PLAYGROUND}
        className="cursor-pointer underline decoration-dotted underline-offset-2 hover:text-foreground"
      >
        Open in pele.run playground ↗
      </UrlLink>
    </p>
  );
}

/**
 * A derived diagram (`.mmd`) rendered inline with the bundled pele renderer.
 *
 * The source stays the view beside it: while the renderer loads, and whenever
 * it is absent or refuses the source, the reader gets the source text (from
 * the caller) plus the playground link — never a blank box presented as a
 * diagram. A failed render is a fallback, not an error: the `.mmd` file
 * itself is intact and the durable `.html` sibling still renders as a page.
 */
export function MermaidDiagram({ source, title }: { source: string; title: string }) {
  const { svg, failed } = useMermaidSvg(source);
  if (svg) {
    return (
      <div
        className="pele overflow-auto rounded-md border border-border bg-background p-3"
        role="img"
        aria-label={title}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }
  if (failed) return <RenderFailed />;
  return <p className="text-xs text-muted-foreground">Rendering diagram…</p>;
}

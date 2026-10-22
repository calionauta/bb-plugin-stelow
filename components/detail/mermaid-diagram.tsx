import { useEffect, useRef, useState } from "react";
import { UrlLink } from "@get-bb/plugin-sdk/app";
import { PELE_PLAYGROUND } from "../../lib/diagram-strategy.mjs";
import { ZOOM_STEP, isZoomed, pointerInCanvas, zoomAtPoint } from "../../lib/diagram-zoom.mjs";

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
 * Pan-and-zoom over the rendered SVG. The plain wheel is never seized — it
 * scrolls the page, because a reader stuck inside a tall diagram is the
 * failure mode. Ctrl/Cmd+wheel zooms at the pointer; dragging pans while
 * zoomed. Buttons do the same for touch and keyboard users.
 */
function useMermaidPan(view: { scale: number; x: number; y: number }, setView: React.Dispatch<React.SetStateAction<{ scale: number; x: number; y: number }>>) {
  const dragFrom = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (event: React.PointerEvent) => {
      if (!isZoomed(view)) return;
      dragFrom.current = { x: event.clientX - view.x, y: event.clientY - view.y };
    },
    onPointerMove: (event: React.PointerEvent) => {
      if (!dragFrom.current) return;
      const from = dragFrom.current;
      setView((current) => ({ ...current, x: event.clientX - from.x, y: event.clientY - from.y }));
    },
    onPointerUp: () => { dragFrom.current = null; },
    onPointerCancel: () => { dragFrom.current = null; },
  };
}

function useMermaidZoom() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const pan = useMermaidPan(view, setView);

  function zoomCenter(factor: number) {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setView((current) => zoomAtPoint(current, factor, pointerInCanvas(
      rect,
      { left: container.scrollLeft, top: container.scrollTop },
      { left: 0, top: 0 },
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    )));
  }

  function onWheel(event: React.WheelEvent) {
    if (!event.ctrlKey && !event.metaKey) return;
    const container = containerRef.current;
    if (!container) return;
    event.preventDefault();
    const rect = container.getBoundingClientRect();
    setView((current) => zoomAtPoint(current, event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, pointerInCanvas(
      rect,
      { left: container.scrollLeft, top: container.scrollTop },
      { left: 0, top: 0 },
      event.clientX,
      event.clientY,
    )));
  }

  return {
    containerRef,
    view,
    zoomed: isZoomed(view),
    zoomIn: () => zoomCenter(ZOOM_STEP),
    zoomOut: () => zoomCenter(1 / ZOOM_STEP),
    reset: () => setView({ scale: 1, x: 0, y: 0 }),
    onWheel,
    pan,
  };
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
  const zoom = useMermaidZoom();
  if (failed) return <RenderFailed />;
  if (!svg) return <p className="text-xs text-muted-foreground">Rendering diagram…</p>;
  const percent = Math.round(zoom.view.scale * 100);
  const controlClass = [
    "min-h-11 cursor-pointer rounded-md border border-border bg-card px-2",
    "text-xs text-foreground hover:border-primary/50",
  ].join(" ");
  return (
    <div className="relative">
      <div
        ref={zoom.containerRef}
        role="img"
        aria-label={`${title} — Ctrl plus scroll zooms, drag pans while zoomed`}
        tabIndex={0}
        onWheel={zoom.onWheel}
        onPointerDown={zoom.pan.onPointerDown}
        onPointerMove={zoom.pan.onPointerMove}
        onPointerUp={zoom.pan.onPointerUp}
        onPointerCancel={zoom.pan.onPointerCancel}
        className="pele max-h-[46dvh] overflow-auto rounded-md border border-border bg-background p-3"
        style={{ cursor: zoom.zoomed ? "grab" : undefined }}
      >
        <div
          style={{
            width: "max-content",
            margin: "0 auto",
            transform: `translate(${zoom.view.x}px, ${zoom.view.y}px) scale(${zoom.view.scale})`,
            transformOrigin: "0 0",
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      <div className="absolute bottom-2 right-2 flex items-center gap-1" role="group" aria-label="Diagram zoom">
        <button type="button" onClick={zoom.zoomOut} disabled={!svg} title="Zoom out" className={`${controlClass} min-w-11`}>−</button>
        <span className="min-w-11 text-center text-xs text-muted-foreground" aria-live="off">{percent}%</span>
        <button type="button" onClick={zoom.zoomIn} disabled={!svg} title="Zoom in" className={`${controlClass} min-w-11`}>+</button>
        <button type="button" onClick={zoom.reset} disabled={!svg} title="Reset zoom" className={controlClass}>Reset</button>
      </div>
    </div>
  );
}

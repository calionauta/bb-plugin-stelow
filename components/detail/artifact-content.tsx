import { useEffect, useState } from "react";
import {
  Markdown,
  UrlLink,
  experimental_SourceCode as SourceCode,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { MOCKUP_SANDBOX, artifactRenderKind } from "../../lib/artifact-render.mjs";
import { PELE_PLAYGROUND } from "../../lib/diagram-strategy.mjs";
import { derivedDiagram } from "../../lib/artifact-diagram.mjs";
import { MermaidDiagram } from "./mermaid-diagram";
import type { rpcContract } from "../../server";

// How one artifact file is loaded and shown. Split out of the dialog so the
// navigation state and the rendering budget stay separate: the dialog decides
// WHICH file, this decides what that file looks like.

export type ArtifactFile = { display: string; path: string } | null;

export function useArtifactContent(open: boolean, cardId: string, file: ArtifactFile) {
  const rpc = useRpc<typeof rpcContract>();
  const [content, setContent] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !file) return;
    setContent(null);
    setTruncated(false);
    setLoadError(null);
    setLoading(true);
    let cancelled = false;
    void rpc.call("readCardFile", { cardId, path: file.path }).then((result) => {
      if (cancelled) return;
      if (result.error) setLoadError(result.error);
      else { setContent(result.content); setTruncated(result.truncated); }
    }).catch((error) => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : "Could not load the file.");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, file, cardId, rpc]);

  return { rpc, content, truncated, loadError, loading };
}

type ArtifactContentProps = {
  file: ArtifactFile;
  content: string | null;
  truncated: boolean;
  loadError: string | null;
  loading: boolean;
  // The scroll container the option lookup needs, so the clicked option can be
  // brought into view inside the document rather than quoted above it.
  scrollRef?: React.Ref<HTMLDivElement>;
};

// A generated interface mockup, shown as the page it is.
//
// Rendering its source shows the reader the recipe instead of the dish, and the
// option under decision is a layout — the one thing source text cannot answer.
// `srcdoc` rather than a URL because the file has no address of its own: it is
// a workspace file, and the point is to read it without starting a server.
//
// The sandbox is the load-bearing part. A mockup is worker-authored, so
// `allow-scripts` stays (an interactive mockup IS the evidence) and
// `allow-same-origin` is withheld: together they would let the framed document
// reach this app's origin, where the reader's session lives.
//
// ponytail: a mockup that references a sibling file by relative path (a CSS or
// image next to it) will not resolve — srcdoc has no base URL. Self-contained
// pages are what `interface-alternatives` produces, so this is the ceiling. If
// mockups start shipping asset folders, serve the directory instead of the
// file and point `src` at that address.
function MockupFrame({ html, title }: { html: string; title: string }) {
  return (
    <iframe
      srcDoc={html}
      title={title}
      sandbox={MOCKUP_SANDBOX}
      referrerPolicy="no-referrer"
      className="h-[46dvh] w-full rounded-md border border-border bg-background"
    />
  );
}

export function ArtifactContent({ file, content, truncated, loadError, loading, scrollRef }: ArtifactContentProps) {
  // `display` is the manifest's human label ("spec tech v1"), never a file
  // name. Every fixture in the suite spelled the two the same, so the kind was
  // read from the label for months: a title has no extension, so a document
  // rendered as source and `derivedDiagram` never saw a Markdown fence either.
  // Anything that inspects the name asks `path`; the label only labels.
  const label = file?.display ?? "";
  const path = file?.path ?? "";
  const kind = artifactRenderKind(path);
  // A truncated page is not the artifact: a mockup cut off mid-document
  // renders as a broken layout presented as evidence, which is worse than the
  // source it would otherwise have shown. Only a complete file is a page.
  const asMockup = kind === "html" && !truncated;
  // A truncated file never derives a diagram: a partial map, a cut fence, or
  // a half-written projection would render a hole as a decision. Only a
  // complete file is a picture; the truncation note below says so.
  const derived = derivedDiagram(path, content, { truncated });
  return (
    <div ref={scrollRef} className="max-h-[46dvh] overflow-auto rounded-md border bg-muted/20 p-3">
      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}
      {!loading && !loadError && content !== null ? (
        derived ? (
          <div className="space-y-2">
            <MermaidDiagram source={derived.mermaid} title={`${label || path} — derived diagram`} />
            {kind === "markdown"
              ? <div className="text-sm leading-relaxed"><Markdown content={content} /></div>
              : <SourceCode content={content} path={path || "file.txt"} />}
            <p className="text-xs text-muted-foreground">
              {derived.caption}{" "}
              <UrlLink href={PELE_PLAYGROUND} className="cursor-pointer underline decoration-dotted underline-offset-2 hover:text-foreground">
                Open in pele.run playground ↗
              </UrlLink>
            </p>
          </div>
        ) : kind === "markdown" ? <div className="text-sm leading-relaxed"><Markdown content={content} /></div>
          : asMockup ? <MockupFrame html={content} title={`${label || path} — interface mockup`} />
            : <SourceCode content={content} path={path || "file.txt"} />
      ) : null}
      {truncated ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {kind === "html"
            ? "Truncated — shown as source, because a partial page is not the mockup."
            : "Truncated preview — open in the editor for the full file."}
        </p>
      ) : null}
    </div>
  );
}

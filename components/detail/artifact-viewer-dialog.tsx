import { useEffect, useRef, useState } from "react";
import {
  Markdown,
  experimental_SourceCode as SourceCode,
  experimental_FileLink as FileLink,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { ArtifactViewerMode } from "../conversation/question-batch";
import { OptionSection } from "./option-section";
import type { HostFileTarget, WorkspaceFileTarget } from "../artifacts/artifact-inventory";
import type { rpcContract } from "../../server";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Read-only artifact viewer with discuss-to-agent. Markdown and source render
// for inspection; card comments route selected excerpts to the worker.
type ArtifactFile = { display: string; path: string } | null;
type EditorTarget = WorkspaceFileTarget | HostFileTarget | null;
type Draft = { id: number; quote: string; comment: string };
type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

function useArtifactContent(open: boolean, cardId: string, file: ArtifactFile) {
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

function commentBody(file: NonNullable<ArtifactFile>, drafts: Draft[]) {
  return [`Re ${file.display}:`, ...drafts.map((draft, index) => {
    const quoted = draft.quote.split("\n").map((line) => `> ${line}`).join("\n");
    const note = draft.comment.trim() || "(no note — for context)";
    return `#### Excerpt ${index + 1}\n${quoted}\n\n${note}`;
  })].join("\n\n");
}

function useCommentDrafts(rpc: Rpc, open: boolean, cardId: string, file: ArtifactFile, onCommented: () => void) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [sending, setSending] = useState(false);
  const nextDraftId = useRef(1);

  useEffect(() => {
    if (open && file) setDrafts([]);
  }, [open, file, cardId, rpc]);

  function quoteSelection() {
    const text = typeof window !== "undefined" ? window.getSelection()?.toString().trim() ?? "" : "";
    if (!text) {
      toast.message("Select a passage in the preview first, then quote it.");
      return;
    }
    const id = nextDraftId.current++;
    setDrafts((current) => [...current, { id, quote: text.slice(0, 2000), comment: "" }]);
  }

  async function sendAll() {
    if (drafts.length === 0 || !file) return;
    setSending(true);
    try {
      const result = await rpc.call("addCardComment", { cardId, target: "card", targetId: cardId, body: commentBody(file, drafts) });
      if (result.error) toast.error(result.error);
      else {
        setDrafts([]);
        toast.success(drafts.length === 1 ? "Comment sent to the agent." : `${drafts.length} comments sent to the agent.`);
        onCommented();
      }
    } finally {
      setSending(false);
    }
  }

  return { drafts, sending, quoteSelection, sendAll, setDrafts };
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

function ArtifactContent({ file, content, truncated, loadError, loading, scrollRef }: ArtifactContentProps) {
  const isMarkdown = file ? /\.mdx?$/i.test(file.display) || /\.mdx?$/i.test(file.path) : false;
  return (
    <div ref={scrollRef} className="max-h-[46dvh] overflow-auto rounded-md border bg-muted/20 p-3">
      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}
      {!loading && !loadError && content !== null ? (
        isMarkdown ? <div className="text-sm leading-relaxed"><Markdown content={content} /></div> : <SourceCode content={content} path={file?.display ?? "file.txt"} />
      ) : null}
      {truncated ? <p className="mt-2 text-xs text-muted-foreground">Truncated preview — open in the editor for the full file.</p> : null}
    </div>
  );
}

function DraftRow({ draft, index, sendAll, setDrafts }: { draft: Draft; index: number; sendAll: () => Promise<void>; setDrafts: React.Dispatch<React.SetStateAction<Draft[]>> }) {
  function remove() {
    setDrafts((current) => current.filter((entry) => entry.id !== draft.id));
  }
  return (
    <div className="space-y-1 rounded-md border bg-muted/20 p-2">
      <div className="flex items-start gap-2">
        <span className="text-xs font-semibold text-muted-foreground">#{index + 1}</span>
        <blockquote className="min-w-0 flex-1 border-l-2 border-primary/50 pl-2 text-xs text-muted-foreground">{draft.quote.length > 300 ? `${draft.quote.slice(0, 300)}…` : draft.quote}</blockquote>
        <button onClick={remove} aria-label={`Remove excerpt ${index + 1}`} className="cursor-pointer rounded px-1 text-muted-foreground hover:text-foreground">×</button>
      </div>
      <textarea value={draft.comment} onChange={(event) => setDrafts((current) => current.map((entry) => entry.id === draft.id ? { ...entry, comment: event.target.value } : entry))} rows={2} className="min-h-16 w-full rounded-md border bg-background p-2 text-sm leading-relaxed focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" placeholder={`Comment on excerpt ${index + 1}… (Cmd/Ctrl+Enter sends all)`} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void sendAll(); }} />
    </div>
  );
}

function CommentDrafts({ drafts, quoteSelection, sendAll, setDrafts }: ReturnType<typeof useCommentDrafts>) {
  return (
    <div className="space-y-2 pb-1">
      <span className="flex min-h-11 items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        <span>Discuss excerpts with the agent{drafts.length ? ` (${drafts.length})` : ""}</span>
        <button onClick={quoteSelection} className="cursor-pointer rounded-md border px-2 py-1 text-xs hover:bg-muted" title="Quote the passage currently selected in the preview above as a new draft">Quote selection</button>
      </span>
      {drafts.length === 0 ? <p className="text-xs text-muted-foreground">Select passages above and quote each one, then send them together.</p> : null}
      {drafts.map((draft, index) => <DraftRow key={draft.id} draft={draft} index={index} sendAll={sendAll} setDrafts={setDrafts} />)}
    </div>
  );
}

export function ArtifactViewerDialog({ open, onOpenChange, cardId, file, editorTarget, mode = "comment", onCommented, optionLabel }: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  cardId: string;
  file: ArtifactFile;
  editorTarget: EditorTarget;
  mode?: ArtifactViewerMode;
  onCommented: () => void;
  // The option whose control opened this. The document is a shared brief, so
  // without it the reader lands on the first line of every proposal instead
  // of the one they asked about.
  optionLabel?: string;
}) {
  const { rpc, content, truncated, loadError, loading } = useArtifactContent(open, cardId, file);
  const drafts = useCommentDrafts(rpc, open, cardId, file, onCommented);
  const canComment = mode === "comment";
  // The document's own scroll container, so the clicked option can be brought
  // into view inside the document instead of quoted above it.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] max-w-4xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="truncate">{file?.display ?? "Artifact"}</DialogTitle>
          <DialogDescription>{canComment ? "Read-only preview. Discuss below — notes go to the agent." : "Read the document before deciding. This review does not modify it."}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          <OptionSection content={content} optionLabel={optionLabel} containerRef={scrollRef} />
          <ArtifactContent file={file} content={content} truncated={truncated} loadError={loadError} loading={loading} scrollRef={scrollRef} />
          {canComment ? <CommentDrafts {...drafts} /> : null}
        </div>
        <DialogFooter>
          {canComment && editorTarget ? <FileLink target={editorTarget} location={null} className="mr-auto inline-flex min-h-11 cursor-pointer items-center rounded-md px-2 text-xs font-medium text-primary hover:underline">Open in bb editor ↗</FileLink> : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {canComment ? <Button disabled={drafts.drafts.length === 0 || drafts.sending} onClick={() => void drafts.sendAll()}>{drafts.sending ? "Sending…" : drafts.drafts.length > 1 ? `Send ${drafts.drafts.length} to agent` : "Send to agent"}</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

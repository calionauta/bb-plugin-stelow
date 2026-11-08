import { useEffect, useMemo, useRef, useState } from "react";
import { experimental_FileLink as FileLink, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { ArtifactViewerMode } from "../conversation/batch-types";
import { OptionSection } from "./option-section";
import { ArtifactFileList } from "./artifact-file-list";
import { useArtifactNavigation, type ViewerDocument } from "./use-artifact-navigation";
import { artifactLinkTarget } from "../../lib/artifact-nav.mjs";
import { ArtifactContent, useArtifactContent, type ArtifactFile } from "./artifact-content";
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
//
// The renderer lives in artifact-content.tsx so the navigation state and the
// rendering stay separate; this module owns which file and the comment flow.

type EditorTarget = WorkspaceFileTarget | HostFileTarget | null;
type Draft = { id: number; quote: string; comment: string };
type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

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
        // A comment written while the card waits on an answer is saved, not
        // sent: it rides that answer. Saying "sent to the agent" here is the
        // lie this line exists to stop.
        if (result.deliveryLine) toast.message(result.deliveryLine);
        else if (result.delivery === "sent") {
          toast.success(drafts.length === 1 ? "Comment sent to the agent." : `${drafts.length} comments sent to the agent.`);
        } else {
          // No verdict and no line: claim nothing.
          toast.message("Comment saved.");
        }
        onCommented();
      }
    } finally {
      setSending(false);
    }
  }

  return { drafts, sending, quoteSelection, sendAll, setDrafts };
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
  const viewer = useArtifactViewer({ open, cardId, file, editorTarget, mode, onCommented });
  const { nav, current, drafts, canComment } = viewer;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] max-w-4xl flex-col overflow-hidden">
        <ViewerDialogHeader display={current?.display ?? null} canComment={canComment} />
        <ArtifactFileList
          files={nav.files}
          currentPath={current?.path ?? ""}
          canGoBack={nav.canGoBack}
          onOpen={nav.openFile}
          onBack={nav.back}
        />
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1" onClick={viewer.followLink}>
          <OptionSection content={viewer.content} optionLabel={optionLabel} containerRef={viewer.scrollRef} />
          <ArtifactContent
            file={current}
            content={viewer.content}
            truncated={viewer.truncated}
            loadError={viewer.loadError}
            loading={viewer.loading}
            scrollRef={viewer.scrollRef}
          />
          {canComment ? <CommentDrafts {...drafts} /> : null}
        </div>
        <ArtifactViewerFooter
          canComment={canComment}
          target={current?.target ?? null}
          drafts={drafts}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ViewerDialogHeader({ display, canComment }: { display: string | null; canComment: boolean }) {
  return (
    <DialogHeader>
      <DialogTitle className="truncate">{display ?? "Artifact"}</DialogTitle>
      <DialogDescription>
        {canComment
          ? "Read-only preview. Follow the links or the file row to compare the stage's documents. Notes go to the agent."
          : "Read the document before deciding. This review does not modify it."}
      </DialogDescription>
    </DialogHeader>
  );
}

/**
 * The dialog's state, kept out of its markup: the navigator, the current
 * document load, the comment drafts, and the one link rule. The component
 * below then reads as the layout it is.
 */
function useArtifactViewer({ open, cardId, file, editorTarget, mode, onCommented }: {
  open: boolean;
  cardId: string;
  file: ArtifactFile;
  editorTarget: EditorTarget;
  mode: ArtifactViewerMode;
  onCommented: () => void;
}) {
  // One stable location for the navigator: the parent re-renders on every RPC
  // reply, and an inline object would reset the reader back to the first file
  // each time the content loaded.
  const initial = useMemo<ViewerDocument | null>(
    () => (file ? { display: file.display, path: file.path, target: editorTarget } : null),
    [file?.display, file?.path, editorTarget],
  );
  const nav = useArtifactNavigation(open, initial, cardId);
  const current = nav.current;
  const { rpc, content, truncated, loadError, loading } = useArtifactContent(open, cardId, current);
  const drafts = useCommentDrafts(rpc, open, cardId, current, onCommented);
  // The document's own scroll container, so the clicked option can be brought
  // into view inside the document instead of quoted above it.
  const scrollRef = useRef<HTMLDivElement | null>(null);

  /**
   * A relative link in the document opens the next document in the SAME
   * viewer. Without this, `alternatives.md` in a brief is a filename the reader
   * has to find on the card; with it, the summary and the proposals it
   * summarizes are one reading session. Modified clicks are left alone on
   * purpose: opening in a new tab is a browser contract, not a navigation bug.
   */
  const followLink = (event: React.MouseEvent<HTMLDivElement>) =>
    followArtifactLink(event, current?.path ?? null, nav.openPath);

  return {
    nav,
    current,
    drafts,
    canComment: mode === "comment",
    content,
    truncated,
    loadError,
    loading,
    scrollRef,
    followLink,
  };
}

function followArtifactLink(
  event: React.MouseEvent<HTMLDivElement>,
  currentPath: string | null,
  openPath: (path: string) => void,
) {
  const anchor = (event.target as HTMLElement).closest("a");
  const path = artifactLinkTarget(
    {
      defaultPrevented: event.defaultPrevented,
      button: event.button,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      href: anchor?.getAttribute("href") ?? null,
    },
    currentPath,
  );
  if (!path) return;
  event.preventDefault();
  event.stopPropagation();
  openPath(path);
}

function ArtifactViewerFooter({ canComment, target, drafts, onClose }: {
  canComment: boolean;
  target: EditorTarget;
  drafts: ReturnType<typeof useCommentDrafts>;
  onClose: () => void;
}) {
  return (
    <DialogFooter>
      {canComment && target ? (
        <FileLink
          target={target}
          location={null}
          className="mr-auto inline-flex min-h-11 cursor-pointer items-center rounded-md px-2 text-xs font-medium text-primary hover:underline"
        >
          Open in bb editor ↗
        </FileLink>
      ) : null}
      <Button variant="outline" onClick={onClose}>Close</Button>
      {canComment ? (
        <Button
          disabled={drafts.drafts.length === 0 || drafts.sending}
          onClick={() => void drafts.sendAll()}
        >
          {drafts.sending
            ? "Sending…"
            : drafts.drafts.length > 1
              ? `Send ${drafts.drafts.length} to agent`
              : "Send to agent"}
        </Button>
      ) : null}
    </DialogFooter>
  );
}

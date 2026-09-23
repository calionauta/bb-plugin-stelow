import { useState, type ReactNode } from "react";
import { experimental_Diff as DiffView, useRpc } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DisclosureChevron, DisclosureSection } from "../disclosure";
import { fileLinkTarget, type HostFileTarget, type WorkspaceFileTarget } from "../artifacts/artifact-inventory";
import { formatChangedSymbols, formatEntitySummary } from "../../lib/build-diff-presentation.mjs";
import type { rpcContract } from "../../server";

type CardDiff = Awaited<ReturnType<ReturnType<typeof useRpc<typeof rpcContract>>["call"]>> extends infer Result
  ? Extract<Result, { found: boolean; isRepo: boolean; files: unknown[] }>
  : never;

type DiffViewerFile = { display: string; path: string; target: WorkspaceFileTarget | HostFileTarget };
type CardDiffFile = CardDiff["files"][number];

type BuildDiffProps = {
  cardId: string;
  workspaceKind: string;
  fileEnvironmentId: string | null;
  onOpenFile: (file: DiffViewerFile) => void;
};

function diffHint(diffData: CardDiff | null): string {
  if (!diffData) return "working tree vs HEAD";
  return diffData.isRepo ? `${diffData.files.length} files` : "not a git repository";
}

function DiffFile({ file, workspaceKind, fileEnvironmentId, onOpenFile }: {
  file: CardDiffFile;
  workspaceKind: string;
  fileEnvironmentId: string | null;
  onOpenFile: (file: DiffViewerFile) => void;
}) {
  if (file.patch) {
    return <div className="space-y-1">
      <p className="text-[11px] font-semibold text-muted-foreground">{file.display}{file.isNew ? " · new" : ""}</p>
      {DiffView ? <DiffView patch={file.patch} path={file.path} view="unified" /> : <pre className="whitespace-pre-wrap rounded-md border bg-background/60 p-2 font-mono text-[11px] leading-relaxed">{file.patch.slice(0, 4000)}</pre>}
    </div>;
  }
  return <div className="space-y-1">
    <p className="text-[11px] font-semibold text-muted-foreground">{file.display}{file.isNew ? " · new" : ""}</p>
    <Button type="button" onClick={() => onOpenFile({ display: file.display, path: file.absolutePath, target: fileLinkTarget(workspaceKind === "exploratory", fileEnvironmentId, file.path, file.hostId, file.absolutePath) })} className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-xs text-foreground hover:bg-sky-500/20" title={`Open ${file.display}`}>
      <span aria-hidden>📄</span><span>Open {file.display}</span>
    </Button>
  </div>;
}

function DiffFiles({ diffData, workspaceKind, fileEnvironmentId, onOpenFile }: {
  diffData: CardDiff;
  workspaceKind: string;
  fileEnvironmentId: string | null;
  onOpenFile: (file: DiffViewerFile) => void;
}) {
  const entitySummary = formatEntitySummary(diffData.entitySummary);
  const changedSymbols = formatChangedSymbols(diffData.changedSymbols);
  return <div className="space-y-3">
    {entitySummary ? <p className="text-[11px] text-muted-foreground">{entitySummary}</p> : null}
    {changedSymbols ? <p className="text-[11px] text-muted-foreground" title="Changed symbols with caller impact (cymbal)">{changedSymbols}</p> : null}
    {diffData.files.map((file) => <DiffFile key={file.path} file={file} workspaceKind={workspaceKind} fileEnvironmentId={fileEnvironmentId} onOpenFile={onOpenFile} />)}
    {diffData.truncated ? <p className="text-xs text-muted-foreground">Truncated — the full diff is larger than shown.</p> : null}
  </div>;
}

function DiffContent({ diffData, error, workspaceKind, fileEnvironmentId, onOpenFile }: {
  diffData: CardDiff | null;
  error: string | null;
  workspaceKind: string;
  fileEnvironmentId: string | null;
  onOpenFile: (file: DiffViewerFile) => void;
}) {
  if (!diffData && !error) return <p className="text-xs text-muted-foreground">Loading…</p>;
  return <>
    {error ? <p className="text-xs text-destructive">{error}</p> : null}
    {diffData && !diffData.isRepo ? <p className="text-xs text-muted-foreground">This card&apos;s workspace is not a git repository — no diff to review.</p> : null}
    {diffData?.isRepo && diffData.files.length === 0 ? <p className="text-xs text-muted-foreground">Working tree clean — nothing to review.</p> : null}
    {diffData && diffData.files.length > 0 ? <DiffFiles diffData={diffData} workspaceKind={workspaceKind} fileEnvironmentId={fileEnvironmentId} onOpenFile={onOpenFile} /> : null}
  </>;
}

export function BuildDiff({ cardId, workspaceKind, fileEnvironmentId, onOpenFile }: BuildDiffProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [open, setOpen] = useState(false);
  const [diffData, setDiffData] = useState<CardDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadDiff() {
    try {
      const result = await rpc.call("cardDiff", { cardId }) as CardDiff;
      setDiffData(result);
      if (!result.found && result.error) setError(result.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load diff.");
    }
  }

  return <DisclosureSection
    title="Diff"
    hint={diffHint(diffData)}
    open={open}
    onToggle={(next) => {
      setOpen(next);
      if (next && !diffData) void loadDiff();
    }}
  >
    <DiffContent diffData={diffData} error={error} workspaceKind={workspaceKind} fileEnvironmentId={fileEnvironmentId} onOpenFile={onOpenFile} />
  </DisclosureSection>;
}

type PublicationCommitDiff = z.infer<typeof rpcContract.publicationCommitDiff.output>;
type CommitDiffFile = PublicationCommitDiff["files"][number];

function commitFileState(file: CommitDiffFile): string {
  if (file.binary) return " · binary";
  if (!file.patch) return file.loadMode === "too_large" ? " · too large" : " · no patch";
  return "";
}

function CommitDiffFileView({ file, open }: { file: CommitDiffFile; open: boolean }) {
  return <details open={open} className="group rounded-md border">
    <summary className="flex cursor-pointer items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
      <DisclosureChevron />{file.path} · {file.changeKind} · +{file.additions}/-{file.deletions}{commitFileState(file)}
    </summary>
    <div className="space-y-1 border-t p-2">
      {file.binary ? <p className="text-xs text-muted-foreground">Binary file — BB does not render its patch.</p> : file.patch ? DiffView ? <DiffView patch={file.patch} path={file.path} view="unified" /> : <pre className="whitespace-pre-wrap rounded-md border bg-background/60 p-2 font-mono text-[11px] leading-relaxed">{file.patch.slice(0, 4000)}</pre> : file.loadMode === "too_large" ? <p className="text-xs text-muted-foreground">This file is too large for BB to render its patch.</p> : <p className="text-xs text-muted-foreground">BB did not return a patch for this file.</p>}
      {file.truncated ? <p className="text-xs text-muted-foreground">This file&apos;s patch is truncated.</p> : null}
    </div>
  </details>;
}

function CommitDiffFiles({ diff, commitSha, filesExpanded, filesEpoch, onExpandAll, onCollapseAll }: {
  diff: PublicationCommitDiff;
  commitSha: string;
  filesExpanded: boolean;
  filesEpoch: number;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}) {
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground">{diff.shortstat || `${diff.files.length} changed files`}</p>
      {diff.files.length > 1 ? <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={onExpandAll}>Expand all</Button><Button size="sm" variant="ghost" onClick={onCollapseAll}>Collapse all</Button></div> : null}
    </div>
    {diff.files.map((file) => <CommitDiffFileView key={`${commitSha}-${filesEpoch}-${file.path}`} file={file} open={filesExpanded} />)}
    {diff.truncated ? <p className="text-xs text-muted-foreground">The commit diff is truncated — some files may be missing.</p> : null}
  </div>;
}

function CommitDiffDialog({ commitSha, diff, loading, filesExpanded, filesEpoch, onExpandAll, onCollapseAll, onClose }: {
  commitSha: string;
  diff: PublicationCommitDiff | null;
  loading: boolean;
  filesExpanded: boolean;
  filesEpoch: number;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onClose: () => void;
}) {
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
    <DialogHeader><DialogTitle>Commit {commitSha.slice(0, 7)}</DialogTitle><DialogDescription>This is the diff BB recorded for this card&apos;s local commit. Viewing it never changes the workspace or remote repository.</DialogDescription></DialogHeader>
    {loading ? <p className="text-xs text-muted-foreground">Loading commit diff from BB…</p> : null}
    {diff?.error ? <p className="text-xs text-destructive">{diff.error}</p> : null}
    {diff?.found ? <CommitDiffFiles diff={diff} commitSha={commitSha} filesExpanded={filesExpanded} filesEpoch={filesEpoch} onExpandAll={onExpandAll} onCollapseAll={onCollapseAll} /> : null}
  </DialogContent></Dialog>;
}

export function CommitDiffReview({ cardId, children }: { cardId: string; children: (openCommit: (sha: string) => void) => ReactNode }) {
  const rpc = useRpc<typeof rpcContract>();
  const [commitSha, setCommitSha] = useState<string | null>(null);
  const [commitDiff, setCommitDiff] = useState<PublicationCommitDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [filesExpanded, setFilesExpanded] = useState(false);
  const [filesEpoch, setFilesEpoch] = useState(0);

  async function openCommit(sha: string) {
    setCommitSha(sha);
    setCommitDiff(null);
    setLoading(true);
    setFilesExpanded(false);
    setFilesEpoch((epoch) => epoch + 1);
    try {
      setCommitDiff(await rpc.call("publicationCommitDiff", { cardId, commitSha: sha }));
    } catch (err) {
      setCommitDiff({ found: false, commitSha: null, shortstat: null, files: [], truncated: false, error: err instanceof Error ? err.message : "Unable to load this commit." });
    } finally {
      setLoading(false);
    }
  }

  function setFileExpansion(expanded: boolean) {
    setFilesExpanded(expanded);
    setFilesEpoch((epoch) => epoch + 1);
  }

  function closeCommit() {
    setCommitSha(null);
    setCommitDiff(null);
  }

  return <>
    {children(openCommit)}
    {commitSha ? <CommitDiffDialog commitSha={commitSha} diff={commitDiff} loading={loading} filesExpanded={filesExpanded} filesEpoch={filesEpoch} onExpandAll={() => setFileExpansion(true)} onCollapseAll={() => setFileExpansion(false)} onClose={closeCommit} /> : null}
  </>;
}

import { useState } from "react";
import { experimental_Diff as DiffView, useRpc } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { DisclosureSection } from "../disclosure";
import { fileLinkTarget, type HostFileTarget, type WorkspaceFileTarget } from "../artifacts/artifact-inventory";
import { formatChangedSymbols, formatEntitySummary } from "../../lib/build-diff-presentation.mjs";
import type { rpcContract } from "../../server";

type CardDiff = Awaited<ReturnType<ReturnType<typeof useRpc<typeof rpcContract>>["call"]>> extends infer Result
  ? Extract<Result, { found: boolean; isRepo: boolean; files: unknown[] }>
  : never;

type DiffViewerFile = { display: string; path: string; target: WorkspaceFileTarget | HostFileTarget };

type BuildDiffProps = {
  cardId: string;
  visible: boolean;
  workspaceKind: string;
  fileEnvironmentId: string | null;
  onOpenFile: (file: DiffViewerFile) => void;
};

export function BuildDiff({ cardId, visible, workspaceKind, fileEnvironmentId, onOpenFile }: BuildDiffProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [open, setOpen] = useState(false);
  const [diffData, setDiffData] = useState<CardDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!visible) return null;

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
    hint={diffData ? (diffData.isRepo ? `${diffData.files.length} files` : "not a git repository") : "working tree vs HEAD"}
    open={open}
    onToggle={(next) => {
      setOpen(next);
      if (next && !diffData) void loadDiff();
    }}
  >
    {!diffData && !error ? <p className="text-xs text-muted-foreground">Loading…</p> : null}
    {error ? <p className="text-xs text-destructive">{error}</p> : null}
    {diffData && !diffData.isRepo ? <p className="text-xs text-muted-foreground">This card&apos;s workspace is not a git repository — no diff to review.</p> : null}
    {diffData && diffData.isRepo && diffData.files.length === 0 ? <p className="text-xs text-muted-foreground">Working tree clean — nothing to review.</p> : null}
    {diffData && diffData.files.length > 0 ? <div className="space-y-3">
      {formatEntitySummary(diffData.entitySummary) ? <p className="text-[11px] text-muted-foreground">{formatEntitySummary(diffData.entitySummary)}</p> : null}
      {formatChangedSymbols(diffData.changedSymbols) ? <p className="text-[11px] text-muted-foreground" title="Changed symbols with caller impact (cymbal)">{formatChangedSymbols(diffData.changedSymbols)}</p> : null}
      {diffData.files.map((file) => <div key={file.path} className="space-y-1">
        <p className="text-[11px] font-semibold text-muted-foreground">{file.display}{file.isNew ? " · new" : ""}</p>
        {file.patch ? DiffView ? <DiffView patch={file.patch} path={file.path} view="unified" /> : <pre className="whitespace-pre-wrap rounded-md border bg-background/60 p-2 font-mono text-[11px] leading-relaxed">{file.patch.slice(0, 4000)}</pre> : <Button onClick={() => onOpenFile({ display: file.display, path: file.absolutePath, target: fileLinkTarget(workspaceKind === "exploratory", fileEnvironmentId, file.path, file.hostId, file.absolutePath) })} className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-xs text-foreground hover:bg-sky-500/20" title={`Open ${file.display}`}><span aria-hidden>📄</span><span>Open {file.display}</span></Button>}
      </div>)}
      {diffData.truncated ? <p className="text-xs text-muted-foreground">Truncated — the full diff is larger than shown.</p> : null}
    </div> : null}
  </DisclosureSection>;
}

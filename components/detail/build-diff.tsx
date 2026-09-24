import { useState } from "react";
import {
  experimental_Diff as DiffView,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { DisclosureSection } from "../disclosure";
import {
  fileLinkTarget,
  type HostFileTarget,
  type WorkspaceFileTarget,
} from "../artifacts/artifact-inventory";
import {
  formatChangedSymbols,
  formatEntitySummary,
} from "../../lib/build-diff-presentation.mjs";
import type { rpcContract } from "../../server";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type RpcResult = Awaited<ReturnType<Rpc["call"]>>;
type CardDiff = Extract<
  RpcResult,
  { found: boolean; isRepo: boolean; files: unknown[] }
>;
type CardDiffFile = CardDiff["files"][number];

type DiffViewerFile = {
  display: string;
  path: string;
  target: WorkspaceFileTarget | HostFileTarget;
};

type BuildDiffProps = {
  cardId: string;
  workspaceKind: string;
  fileEnvironmentId: string | null;
  onOpenFile: (file: DiffViewerFile) => void;
};

type DiffFileProps = Pick<
  BuildDiffProps,
  "workspaceKind" | "fileEnvironmentId" | "onOpenFile"
> & {
  file: CardDiffFile;
};

type DiffFilesProps = Pick<
  BuildDiffProps,
  "workspaceKind" | "fileEnvironmentId" | "onOpenFile"
> & {
  diffData: CardDiff;
};

type DiffContentProps = Pick<
  BuildDiffProps,
  "workspaceKind" | "fileEnvironmentId" | "onOpenFile"
> & {
  diffData: CardDiff | null;
  error: string | null;
};

function diffHint(diffData: CardDiff | null): string {
  if (!diffData) return "working tree vs HEAD";
  return diffData.isRepo ? `${diffData.files.length} files` : "not a git repository";
}

function DiffFile(props: DiffFileProps) {
  const fileLabel = (
    <p className="text-[11px] font-semibold text-muted-foreground">
      {props.file.display}{props.file.isNew ? " · new" : ""}
    </p>
  );
  if (props.file.patch) {
    return (
      <div className="space-y-1">
        {fileLabel}
        {DiffView
          ? (
            <DiffView
              patch={props.file.patch}
              path={props.file.path}
              view="unified"
            />
          )
          : (
            <pre className="whitespace-pre-wrap rounded-md border bg-background/60 p-2 font-mono text-[11px] leading-relaxed">
              {props.file.patch.slice(0, 4000)}
            </pre>
          )}
      </div>
    );
  }
  const openFile = () => props.onOpenFile({
    display: props.file.display,
    path: props.file.absolutePath,
    target: fileLinkTarget(
      props.workspaceKind === "exploratory",
      props.fileEnvironmentId,
      props.file.path,
      props.file.hostId,
      props.file.absolutePath,
    ),
  });
  return (
    <div className="space-y-1">
      {fileLabel}
      <Button
        type="button"
        onClick={openFile}
        className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md border
          border-sky-500/30 bg-sky-500/10 px-2 py-1 text-xs text-foreground
          hover:bg-sky-500/20"
        title={`Open ${props.file.display}`}
      >
        <span aria-hidden>📄</span>
        <span>Open {props.file.display}</span>
      </Button>
    </div>
  );
}

function DiffFiles(props: DiffFilesProps) {
  const entitySummary = formatEntitySummary(props.diffData.entitySummary);
  const changedSymbols = formatChangedSymbols(props.diffData.changedSymbols);
  return (
    <div className="space-y-3">
      {entitySummary
        ? <p className="text-[11px] text-muted-foreground">{entitySummary}</p>
        : null}
      {changedSymbols
        ? (
          <p
            className="text-[11px] text-muted-foreground"
            title="Changed symbols with caller impact (cymbal)"
          >
            {changedSymbols}
          </p>
        )
        : null}
      {props.diffData.files.map((file) => (
        <DiffFile
          key={file.path}
          file={file}
          workspaceKind={props.workspaceKind}
          fileEnvironmentId={props.fileEnvironmentId}
          onOpenFile={props.onOpenFile}
        />
      ))}
      {props.diffData.truncated
        ? (
          <p className="text-xs text-muted-foreground">
            Truncated — the full diff is larger than shown.
          </p>
        )
        : null}
    </div>
  );
}

function DiffContent(props: DiffContentProps) {
  if (!props.diffData && !props.error) {
    return <p className="text-xs text-muted-foreground">Loading…</p>;
  }
  return (
    <>
      {props.error
        ? <p className="text-xs text-destructive">{props.error}</p>
        : null}
      {props.diffData && !props.diffData.isRepo
        ? (
          <p className="text-xs text-muted-foreground">
            This card&apos;s workspace is not a git repository — no diff to review.
          </p>
        )
        : null}
      {props.diffData?.isRepo && props.diffData.files.length === 0
        ? <p className="text-xs text-muted-foreground">Working tree clean — nothing to review.</p>
        : null}
      {props.diffData && props.diffData.files.length > 0
        ? (
          <DiffFiles
            diffData={props.diffData}
            workspaceKind={props.workspaceKind}
            fileEnvironmentId={props.fileEnvironmentId}
            onOpenFile={props.onOpenFile}
          />
        )
        : null}
    </>
  );
}

export function BuildDiff(props: BuildDiffProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [open, setOpen] = useState(false);
  const [diffData, setDiffData] = useState<CardDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadDiff() {
    try {
      const result = await rpc.call("cardDiff", { cardId: props.cardId }) as CardDiff;
      setDiffData(result);
      if (!result.found && result.error) setError(result.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load diff.");
    }
  }

  return (
    <DisclosureSection
      title="Diff"
      hint={diffHint(diffData)}
      open={open}
      onToggle={(next) => {
        setOpen(next);
        if (next && !diffData) void loadDiff();
      }}
    >
      <DiffContent
        diffData={diffData}
        error={error}
        workspaceKind={props.workspaceKind}
        fileEnvironmentId={props.fileEnvironmentId}
        onOpenFile={props.onOpenFile}
      />
    </DisclosureSection>
  );
}

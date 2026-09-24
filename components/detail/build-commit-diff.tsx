import { useState, type ReactNode } from "react";
import {
  experimental_Diff as DiffView,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DisclosureChevron } from "../disclosure";
import { commitFileState } from "../../lib/build-diff-presentation.mjs";
import type { rpcContract } from "../../server";

type PublicationCommitDiff = z.infer<typeof rpcContract.publicationCommitDiff.output>;
type CommitDiffFile = PublicationCommitDiff["files"][number];

type CommitDiffFilesProps = {
  diff: PublicationCommitDiff;
  commitSha: string;
  filesExpanded: boolean;
  filesEpoch: number;
  onExpandAll: () => void;
  onCollapseAll: () => void;
};

type CommitDiffDialogProps = Omit<
  CommitDiffFilesProps,
  "diff" | "onExpandAll" | "onCollapseAll"
> & {
  diff: PublicationCommitDiff | null;
  loading: boolean;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onClose: () => void;
};

type CommitDiffReviewProps = {
  cardId: string;
  children: (openCommit: (sha: string) => void) => ReactNode;
};

function CommitPatch({ file }: { file: CommitDiffFile }) {
  if (file.binary) {
    return <p className="text-xs text-muted-foreground">Binary file — BB does not render its patch.</p>;
  }
  if (file.patch && DiffView) {
    return <DiffView patch={file.patch} path={file.path} view="unified" />;
  }
  if (file.patch) {
    return (
      <pre className="whitespace-pre-wrap rounded-md border bg-background/60 p-2 font-mono text-[11px] leading-relaxed">
        {file.patch.slice(0, 4000)}
      </pre>
    );
  }
  if (file.loadMode === "too_large") {
    return <p className="text-xs text-muted-foreground">This file is too large for BB to render its patch.</p>;
  }
  return <p className="text-xs text-muted-foreground">BB did not return a patch for this file.</p>;
}

function CommitDiffFileView(props: { file: CommitDiffFile; open: boolean }) {
  const file = props.file;
  return (
    <details open={props.open} className="group rounded-md border">
      <summary className="flex cursor-pointer items-center gap-1.5 px-2 py-1.5
        text-[11px] font-semibold text-muted-foreground hover:text-foreground
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
        <DisclosureChevron />
        {file.path} · {file.changeKind} · +{file.additions}/-{file.deletions}
        {commitFileState(file)}
      </summary>
      <div className="space-y-1 border-t p-2">
        <CommitPatch file={file} />
        {file.truncated
          ? <p className="text-xs text-muted-foreground">This file&apos;s patch is truncated.</p>
          : null}
      </div>
    </details>
  );
}

type CommitDiffFileActionsProps = Pick<
  CommitDiffFilesProps,
  "onExpandAll" | "onCollapseAll"
>;

function CommitDiffFileActions(props: CommitDiffFileActionsProps) {
  return (
    <div className="flex gap-1">
      <Button size="sm" variant="ghost" onClick={props.onExpandAll}>
        Expand all
      </Button>
      <Button size="sm" variant="ghost" onClick={props.onCollapseAll}>
        Collapse all
      </Button>
    </div>
  );
}

function CommitDiffFiles(props: CommitDiffFilesProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {props.diff.shortstat || `${props.diff.files.length} changed files`}
        </p>
        {props.diff.files.length > 1
          ? (
            <CommitDiffFileActions
              onExpandAll={props.onExpandAll}
              onCollapseAll={props.onCollapseAll}
            />
          )
          : null}
      </div>
      {props.diff.files.map((file) => (
        <CommitDiffFileView
          key={`${props.commitSha}-${props.filesEpoch}-${file.path}`}
          file={file}
          open={props.filesExpanded}
        />
      ))}
      {props.diff.truncated
        ? (
          <p className="text-xs text-muted-foreground">
            The commit diff is truncated — some files may be missing.
          </p>
        )
        : null}
    </div>
  );
}

function CommitDiffDialog(props: CommitDiffDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Commit {props.commitSha.slice(0, 7)}</DialogTitle>
          <DialogDescription>
            This is the diff BB recorded for this card&apos;s local commit. Viewing it never
            changes the workspace or remote repository.
          </DialogDescription>
        </DialogHeader>
        {props.loading
          ? <p className="text-xs text-muted-foreground">Loading commit diff from BB…</p>
          : null}
        {props.diff?.error
          ? <p className="text-xs text-destructive">{props.diff.error}</p>
          : null}
        {props.diff?.found
          ? (
            <CommitDiffFiles
              diff={props.diff}
              commitSha={props.commitSha}
              filesExpanded={props.filesExpanded}
              filesEpoch={props.filesEpoch}
              onExpandAll={props.onExpandAll}
              onCollapseAll={props.onCollapseAll}
            />
          )
          : null}
      </DialogContent>
    </Dialog>
  );
}

type CommitDiffReviewState = {
  commitSha: string | null;
  commitDiff: PublicationCommitDiff | null;
  loading: boolean;
  filesExpanded: boolean;
  filesEpoch: number;
};

function commitDiffFailure(err: unknown): PublicationCommitDiff {
  return {
    found: false,
    commitSha: null,
    shortstat: null,
    files: [],
    truncated: false,
    error: err instanceof Error ? err.message : "Unable to load this commit.",
  };
}

function withFileExpansion(
  state: CommitDiffReviewState,
  expanded: boolean,
): CommitDiffReviewState {
  return {
    ...state,
    filesExpanded: expanded,
    filesEpoch: state.filesEpoch + 1,
  };
}

function useCommitDiffReview(cardId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<CommitDiffReviewState>({
    commitSha: null,
    commitDiff: null,
    loading: false,
    filesExpanded: false,
    filesEpoch: 0,
  });

  async function openCommit(sha: string) {
    setState((current) => ({
      ...current,
      commitSha: sha,
      commitDiff: null,
      loading: true,
      filesExpanded: false,
      filesEpoch: current.filesEpoch + 1,
    }));
    try {
      const diff = await rpc.call("publicationCommitDiff", { cardId, commitSha: sha });
      setState((current) => ({ ...current, commitDiff: diff }));
    } catch (err) {
      setState((current) => ({
        ...current,
        commitDiff: commitDiffFailure(err),
      }));
    } finally {
      setState((current) => ({ ...current, loading: false }));
    }
  }

  function setFileExpansion(expanded: boolean) {
    setState((current) => withFileExpansion(current, expanded));
  }

  function closeCommit() {
    setState((current) => ({ ...current, commitSha: null, commitDiff: null }));
  }

  return { ...state, openCommit, setFileExpansion, closeCommit };
}

export function CommitDiffReview(props: CommitDiffReviewProps) {
  const review = useCommitDiffReview(props.cardId);
  return (
    <>
      {props.children(review.openCommit)}
      {review.commitSha
        ? (
          <CommitDiffDialog
            commitSha={review.commitSha}
            diff={review.commitDiff}
            loading={review.loading}
            filesExpanded={review.filesExpanded}
            filesEpoch={review.filesEpoch}
            onExpandAll={() => review.setFileExpansion(true)}
            onCollapseAll={() => review.setFileExpansion(false)}
            onClose={review.closeCommit}
          />
        )
        : null}
    </>
  );
}

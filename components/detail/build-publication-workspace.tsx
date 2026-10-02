import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { z } from "zod";
import type { PublicationAction } from "./build-publication-actions";
import { copyText } from "./copy-text";
import type { rpcContract } from "../../server";

/**
 * The workspace half of the publication panel: where the card is checked out,
 * what was saved, and what is left to publish.
 *
 * Split from the pull-request half because a card can be in every combination
 * of the two — a local commit with no pull request, a pull request with no
 * local commit, both, neither — and reading one without the other tells the
 * reader half a story.
 *
 * Every component here is a pure function of values it is handed. The
 * polling, the push terminals and the action dialog all live in
 * build-publication.tsx, which is what makes these safe to read without
 * tracing an RPC lifecycle.
 */

type PublicationStatus = z.infer<typeof rpcContract.publicationStatus.output>;
export type BranchLinks = { treeUrl: string; compareUrl: string | null };

/** One push shell the host opened for this card, and what it recorded. */
export type PushShell = {
  id: string;
  title: string;
  pushState: "succeeded" | "failed" | "waiting" | "running";
  outputUnavailable: boolean;
  createdAt: number;
  pushExit: number | null;
  outputTail: string | null;
};
export type PushShellList = {
  ok: boolean;
  error: string | null;
  remote: { owner: string; repo: string; webUrl: string } | null;
  terminals: PushShell[];
};
type PushVerdict = { label: string; guidance: string | null; retryable: boolean };

/**
 * Where this card's work physically lives: the checkout BB gave it, the branch
 * it is on, and how far it has drifted from the base. One line, because every
 * number here is context for the buttons below rather than a finding.
 */
export function BranchContextLine({ publication }: { publication: NonNullable<PublicationStatus> }) {
  if (!publication.branch) return null;
  return (
    <div className="rounded-md bg-muted/60 p-2 text-muted-foreground">
      <span className="font-medium text-foreground">
        {publication.isWorktree ? "Worker worktree" : "Worker checkout"}
      </span>
      {publication.branch.current ? <> · branch <code>{publication.branch.current}</code></> : null}
      {publication.branch.default ? <> · base <code>{publication.branch.default}</code></> : null}
      {publication.workingTree ? (
        <> · {publication.workingTree.hasUncommittedChanges
          ? `${publication.workingTree.files} changed files`
          : "working tree clean"}</>
      ) : null}
      {publication.mergeBase ? (
        <> · {publication.mergeBase.ahead} ahead / {publication.mergeBase.behind} behind</>
      ) : null}
    </div>
  );
}

/**
 * What is true about the saved commit, and the two ways to act on it.
 */
export function SavedCommitSummary({ branch, savedSha, isCurrentHead, pushed, pushUnknown, openCommit }: {
  branch: string;
  savedSha: string;
  isCurrentHead: boolean;
  pushed: boolean;
  pushUnknown: boolean;
  openCommit: (sha: string) => void;
}) {
  return (
    <div>
      <p className="font-medium">Saved locally on <code>{branch}</code></p>
      <p className="mt-1 text-emerald-900/80 dark:text-emerald-100/80">
        <code>{savedSha.slice(0, 7)}</code> · working tree clean
        {isCurrentHead ? " · current local HEAD" : " · followed by a newer local commit"} ·{" "}
        {pushed ? "pushed to origin." : pushUnknown ? "last push outcome unknown — the shell ended." : "not pushed yet."}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => void openCommit(savedSha)}>View commit</Button>
        <Button size="sm" variant="outline" onClick={() => void copyText(savedSha, "Commit SHA")}>Copy SHA</Button>
      </div>
    </div>
  );
}

/**
 * The next step on a saved branch. Behind beats everything: pushing from a
 * stale branch is the one action that reliably produces a rejected push.
 */
export function BranchPublishStep({ pushed, behind, setAction }: {
  pushed: boolean;
  behind: number;
  setAction: (action: PublicationAction | null) => void;
}) {
  return (
    <div className="border-t border-emerald-500/20 pt-3">
      <p className="font-medium">
        {pushed ? "Published" : behind > 0 ? `Behind by ${behind} — sync first.` : "Next: publish the branch."}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {behind > 0 ? (
          <Button size="sm" variant="outline" title="Pull with rebase, then push — one click" onClick={() => setAction("sync")}>Sync &amp; push…</Button>
        ) : pushed ? null : (
          <Button size="sm" variant="outline" title="Run git push in this card's checkout" onClick={() => setAction("push")}>Push now…</Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          title="Copy the push command to run it yourself"
          onClick={() => void copyText("git push", "Push command")}
        >
          Copy command
        </Button>
      </div>
    </div>
  );
}

/**
 * GitHub links for a branch that reached a remote: the tree, and the compare
 * view that becomes a pull request. Absent without a remote, so the panel
 * never offers a link that cannot resolve.
 */
export function GitHubBranchLinks({ links, branch }: {
  links: BranchLinks | null;
  branch: string;
}) {
  if (!links) return null;
  return (
    <div className="border-t border-emerald-500/20 pt-3">
      <p className="font-medium">On GitHub</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" asChild>
          <a href={links.treeUrl} target="_blank" rel="noreferrer" title={`Open ${branch} on GitHub`}>View branch</a>
        </Button>
        {links.compareUrl ? (
          <Button size="sm" variant="outline" asChild>
            <a href={links.compareUrl} target="_blank" rel="noreferrer" title="Open a pull request for this branch on GitHub">Open pull request</a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The two states of the working tree, told apart by whether anything is saved
 * yet. Before a commit the panel's only job is to get one made; after it, the
 * branch has a shape worth describing.
 */
export function UnsavedWorkspace({ publication, verifiedHeadSha, publishesToDefaultBranch, publicationDefaultBranch, setAction }: {
  publication: NonNullable<PublicationStatus>;
  verifiedHeadSha: string | null;
  publishesToDefaultBranch: boolean;
  publicationDefaultBranch: string | null;
  setAction: (action: PublicationAction | null) => void;
}) {
  const files = publication.workingTree?.files ?? 0;
  const branch = publication.branch?.current ?? "this branch";
  const clean = !publication.workingTree?.hasUncommittedChanges;
  const savedSha = publication.events.find((event) => event.action === "commit" && event.commitSha)?.commitSha ?? null;
  return (
    <div>
      <p className="text-emerald-900/80 dark:text-emerald-100/80">
        {!savedSha && clean
          ? "Nothing saved yet."
          : !savedSha
            ? `${files} uncommitted changes on ${branch} — save them first.`
            : `${files} new changes since ${savedSha.slice(0, 7)}.`}
      </p>
      {verifiedHeadSha ? (
        <p className="mt-1 text-muted-foreground">
          Completed at {verifiedHeadSha.slice(0, 7)} — current dirt may be later work, not card leftovers.
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!publication.capabilities.commit.available}
          title={publication.capabilities.commit.reason ?? "Commit the BB workspace"}
          onClick={() => setAction("commit")}
        >
          {publishesToDefaultBranch
            ? `Save local commit to ${publicationDefaultBranch}…`
            : "Commit workspace…"}
        </Button>
      </div>
    </div>
  );
}

/**
 * What one push shell's recorded state means, as a sentence. Split out because
 * the reading is the whole value of the list: the raw state names tell a user
 * nothing about whether they need to act.
 */
function pushVerdict(terminal: PushShell): PushVerdict {
  if (terminal.outputUnavailable) {
    return {
      label: "○ Ended — output unavailable",
      guidance: "The shell already exited. Its result is in the Git history or remote instead.",
      retryable: false,
    };
  }
  if (terminal.pushState === "succeeded") {
    return { label: "✓ Pushed", guidance: null, retryable: false };
  }
  if (terminal.pushState === "failed") {
    const tail = terminal.outputTail ?? "";
    if (/STELOW_SYNC_ABORTED:1/.test(tail)) {
      return {
        label: "Pull conflicted — nothing changed",
        guidance: "The rebase aborted itself, so your checkout is unchanged. Resolve the conflict where you edit code, then come back.",
        retryable: false,
      };
    }
    const exit = /STELOW_SYNC_EXIT:([1-9][0-9]*)/.exec(tail);
    return {
      label: `Push failed${exit ? ` (exit ${exit[1]})` : ""}`,
      guidance: "The pull itself failed, on network or auth. Check the output above first.",
      retryable: true,
    };
  }
  if (terminal.pushState === "waiting") {
    return {
      label: "○ Waiting — git push typed but NOT sent",
      guidance: [
        "An older shell from before pushes ran themselves.",
        "Press Enter in BB's sidebar terminal to send it,",
        "or click Push now above for a fresh tracked run.",
      ].join(" "),
      retryable: false,
    };
  }
  return {
    label: "Running",
    guidance: "Push sent — waiting for the remote. If it asks for auth, finish it in BB's sidebar terminal, then Check result.",
    retryable: false,
  };
}

/**
 * One push shell, and the sentence that explains what its state means.
 *
 * The states are not self-evident from their names: a shell still `waiting`
 * has a command typed into it that was never sent, which is a different
 * problem from a push that failed and one from a push that succeeded.
 */
/**
 * The recorded output of a push shell, read-only. Labelled because a snapshot
 * that looks like a live terminal invites a user to type into it.
 */
function PushShellOutput({ output }: { output: string }) {
  return (
    <>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Snapshot — refresh with Check result; this view is not interactive.
      </p>
      <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-muted/60 p-2 font-mono text-[11px]">
        {output}
      </pre>
    </>
  );
}

function PushShellCard({
  terminal,
  onRetry,
  onCopy,
}: {
  terminal: PushShell;
  onRetry: () => void;
  onCopy: (value: string) => void;
}) {
  const verdict = pushVerdict(terminal);
  return (
    <div className="mt-2 rounded border border-emerald-500/20 bg-background/60 p-2 text-foreground">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs">
          <span className="font-medium">{terminal.title}</span> · {verdict.label} ·{" "}
          {new Date(terminal.createdAt).toLocaleString()}
        </p>
        <Button
          size="sm"
          variant="ghost"
          title="Copy this shell's ID — paste it in BB's sidebar terminal panel to jump to the exact shell that ran this"
          onClick={() => onCopy(terminal.id)}
        >
          Copy terminal ID
        </Button>
      </div>
      <p className="mt-1 font-mono text-[11px] text-muted-foreground">{terminal.id}</p>
      {verdict.guidance ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {verdict.guidance}
          {verdict.retryable ? (
            <>
              {" "}
              <Button size="sm" variant="outline" onClick={onRetry}>Sync &amp; push again…</Button>
            </>
          ) : null}
        </p>
      ) : null}
      {terminal.outputTail ? <PushShellOutput output={terminal.outputTail} /> : null}
    </div>
  );
}

/**
 * Every push shell BB opened for this card, with a button to re-read their
 * results.
 *
 * The panel never runs a push itself: the shells are the host's, and a shell
 * that has already ended is only knowable from what it recorded. That is why
 * this list exists at all — a push the user started by hand is invisible
 * everywhere else.
 */
export function PushShells({
  terminals,
  loading,
  onRefresh,
  onRetry,
  onCopy,
}: {
  terminals: PushShellList | null;
  loading: boolean;
  onRefresh: () => void | Promise<void>;
  onRetry: () => void;
  onCopy: (value: string) => void;
}) {
  return (
    <div className="mt-2 rounded-md border border-emerald-500/20 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-900/70 dark:text-emerald-100/70">
          Push shells
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={loading}
          onClick={() => void onRefresh()}
        >
          {loading ? "Checking…" : "Check result"}
        </Button>
      </div>
      {loading ? <ShellNote>Checking push shells…</ShellNote> : null}
      {!loading && terminals && !terminals.ok ? (
        <ShellNote>{terminals.error ?? "Unable to list push shells."}</ShellNote>
      ) : null}
      {!loading && terminals?.ok && terminals.terminals.length === 0 ? (
        <ShellNote>No push shell opened yet.</ShellNote>
      ) : null}
      {terminals?.ok
        ? terminals.terminals.map((terminal) => (
          <PushShellCard key={terminal.id} terminal={terminal} onRetry={onRetry} onCopy={onCopy} />
        ))
        : null}
    </div>
  );
}

function ShellNote({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-emerald-900/80 dark:text-emerald-100/80">{children}</p>;
}

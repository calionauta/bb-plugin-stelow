import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { UrlLink, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { z } from "zod";
import { branchWebLinks } from "../../lib/remote-url.mjs";
import { PublicationActions, type PublicationAction } from "./build-publication-actions";
import { Button } from "@/components/ui/button";
import { DisclosureChevron, DisclosureSection } from "../disclosure";
import { CommitDiffReview } from "./build-commit-diff";
import { WorktreeCleanupSuggestion } from "../worktree-cleanup-suggestion";
import type { rpcContract } from "../../server";

type PublicationStatus = z.infer<typeof rpcContract.publicationStatus.output>;
type PushTerminal = { id: string; title: string; pushState: "succeeded" | "failed" | "waiting" | "running"; outputUnavailable: boolean; createdAt: number; pushExit: number | null; outputTail: string | null };
type PushTerminals = { ok: boolean; error: string | null; remote: { owner: string; repo: string; webUrl: string } | null; terminals: PushTerminal[] };

type BuildPublicationProps = {
  cardId: string;
  verifiedHeadSha: string | null;
  recoveryContent?: ReactNode;
  onChanged: () => void | Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  onBranchChange: (branch: string | null) => void;
};

export function BuildPublication({ cardId, verifiedHeadSha, recoveryContent, onChanged, onDirtyChange, onBranchChange }: BuildPublicationProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [publication, setPublication] = useState<PublicationStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [pushTerminals, setPushTerminals] = useState<PushTerminals | null>(null);
  const [pushTerminalsLoading, setPushTerminalsLoading] = useState(false);
  const pushRefreshTimers = useRef<number[]>([]);

  const loadPublication = useCallback(async () => {
    setLoading(true);
    try {
      setPublication(await rpc.call("publicationStatus", { cardId }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to inspect publication status.");
    } finally {
      setLoading(false);
    }
  }, [cardId, rpc]);

  const loadPushTerminals = useCallback(async () => {
    setPushTerminalsLoading(true);
    try {
      setPushTerminals(await rpc.call("publicationPushTerminals", { cardId }));
    } catch (err) {
      setPushTerminals({ ok: false, error: err instanceof Error ? err.message : "Unable to list push shells.", remote: null, terminals: [] });
    } finally {
      setPushTerminalsLoading(false);
    }
  }, [cardId, rpc]);

  useEffect(() => { void loadPublication(); void loadPushTerminals(); }, [loadPublication, loadPushTerminals]);
  useEffect(() => { onDirtyChange(Boolean(publication?.workingTree?.hasUncommittedChanges)); }, [onDirtyChange, publication]);
  useEffect(() => { onBranchChange(publication?.branch?.current ?? null); }, [onBranchChange, publication]);
  useEffect(() => () => { for (const timer of pushRefreshTimers.current) window.clearTimeout(timer); pushRefreshTimers.current = []; }, []);

  function schedulePushRefresh(action: PublicationAction) {
    const delays = action === "sync" ? [10000, 25000] : [8000, 20000];
    pushRefreshTimers.current.push(...delays.map((delay) => window.setTimeout(() => void loadPushTerminals(), delay)));
  }

  return <PublicationSection cardId={cardId} verifiedHeadSha={verifiedHeadSha} recoveryContent={recoveryContent} publication={publication} loading={loading} pushTerminals={pushTerminals}
    pushTerminalsLoading={pushTerminalsLoading} loadPublication={loadPublication} loadPushTerminals={loadPushTerminals} schedulePushRefresh={schedulePushRefresh} onChanged={onChanged} />;
}

type PublicationSectionProps = {
  cardId: string;
  verifiedHeadSha: string | null;
  recoveryContent?: ReactNode;
  publication: PublicationStatus | null;
  loading: boolean;
  pushTerminals: PushTerminals | null;
  pushTerminalsLoading: boolean;
  loadPublication: () => Promise<void>;
  loadPushTerminals: () => Promise<void>;
  schedulePushRefresh: (action: PublicationAction) => void;
  onChanged: () => void | Promise<void>;
};

function PublicationSection(props: PublicationSectionProps) {
  const { cardId, verifiedHeadSha, recoveryContent, publication, loading, pushTerminals, pushTerminalsLoading, loadPublication, loadPushTerminals, schedulePushRefresh, onChanged } = props;
  const [action, setAction] = useState<PublicationAction | null>(null);
  const [advancedGitOpen, setAdvancedGitOpen] = useState(false);
  const [mergeMethod, setMergeMethod] = useState<"merge" | "rebase" | "squash">("squash");
  const savedCommit = publication?.events.find((event) => event.action === "commit" && event.commitSha);
  const savedSha = savedCommit?.commitSha ?? null;
  const isCurrentHead = Boolean(savedSha && publication?.branch?.headSha === savedSha);
  const latestPush = pushTerminals?.terminals[0] ?? null;
  const pushed = latestPush?.pushState === "succeeded" && !latestPush.outputUnavailable;
  const pushUnknown = !pushed && (latestPush?.outputUnavailable ?? false);
  const behind = publication?.mergeBase?.behind ?? 0;
  const branch = publication?.branch?.current ?? "this branch";
  const remoteKnown = pushTerminals?.remote ?? null;
  const links = publication && (pushed || publication.pullRequest) ? branchWebLinks(remoteKnown, publication.branch?.current ?? null, publication.mergeBase?.branch ?? publication.branch?.default ?? null) : null;
  const publicationDefaultBranch = publication?.branch?.default ?? null;
  const publishesToDefaultBranch = Boolean(publicationDefaultBranch && publication?.branch?.current === publicationDefaultBranch);

  return <>
    <CommitDiffReview cardId={cardId}>{ (openCommit) => <>
      <DisclosureSection title="Git changes" hint={loading ? "Checking BB workspace…" : publication?.source ?? "No live BB workspace"} defaultOpen action={<Button size="sm" variant="outline" disabled={loading} onClick={() => void loadPublication()} title="Re-check the workspace and pull-request state in BB">Refresh</Button>}>
        {!publication && !loading ? <p className="text-xs text-muted-foreground">Publication status is unavailable.</p> : null}
        {recoveryContent}
        {publication ? <div className="space-y-3 text-xs">
          {publication.message ? <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-amber-900 dark:text-amber-200">{publication.message}</p> : null}
          {publication.branch ? <div className="rounded-md bg-muted/60 p-2 text-muted-foreground"><span className="font-medium text-foreground">{publication.isWorktree ? "Worker worktree" : "Worker checkout"}</span>{publication.branch.current ? <> · branch <code>{publication.branch.current}</code></> : null}{publication.branch.default ? <> · base <code>{publication.branch.default}</code></> : null}{publication.workingTree ? <> · {publication.workingTree.hasUncommittedChanges ? `${publication.workingTree.files} changed files` : "working tree clean"}</> : null}{publication.mergeBase ? <> · {publication.mergeBase.ahead} ahead / {publication.mergeBase.behind} behind</> : null}</div> : null}
          {!savedSha || publication.workingTree?.hasUncommittedChanges ? <div><p className="text-emerald-900/80 dark:text-emerald-100/80">{!savedSha && !publication.workingTree?.hasUncommittedChanges ? "Nothing saved yet." : !savedSha ? `${publication.workingTree?.files ?? 0} uncommitted changes on ${publication.branch?.current ?? "this branch"} — save them first.` : `${publication.workingTree?.files ?? 0} new changes since ${savedSha.slice(0, 7)}.`}</p>{verifiedHeadSha ? <p className="mt-1 text-muted-foreground">Completed at {verifiedHeadSha.slice(0, 7)} — current dirt may be later work, not card leftovers.</p> : null}<div className="mt-2 flex flex-wrap gap-2"><Button size="sm" disabled={!publication.capabilities.commit.available} title={publication.capabilities.commit.reason ?? "Commit the BB workspace"} onClick={() => setAction("commit")}>{publishesToDefaultBranch ? `Save local commit to ${publicationDefaultBranch}…` : "Commit workspace…"}</Button></div></div> : <div className="space-y-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 text-emerald-950 dark:text-emerald-100"><div><p className="font-medium">✓ Saved locally on <code>{branch}</code></p><p className="mt-1 text-emerald-900/80 dark:text-emerald-100/80"><code>{savedSha.slice(0, 7)}</code> · working tree clean{isCurrentHead ? " · current local HEAD" : " · followed by a newer local commit"} · {pushed ? "pushed to origin." : pushUnknown ? "last push outcome unknown — the shell ended." : "not pushed yet."}</p><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void openCommit(savedSha)}>View commit</Button><Button size="sm" variant="outline" onClick={() => void copyText(savedSha, "Commit SHA")}>Copy SHA</Button></div></div><div className="border-t border-emerald-500/20 pt-3"><p className="font-medium">{pushed ? "✓ Published" : behind > 0 ? `Behind by ${behind} — sync first.` : "Next: publish the branch."}</p><div className="mt-2 flex flex-wrap gap-2">{behind > 0 ? <Button size="sm" variant="outline" title="Pull with rebase, then push — one click" onClick={() => setAction("sync")}>Sync &amp; push…</Button> : pushed ? null : <Button size="sm" variant="outline" title="Run git push in this card's checkout" onClick={() => setAction("push")}>Push now…</Button>}<Button size="sm" variant="ghost" title="Copy the push command to run it yourself" onClick={() => void copyText("git push", "Push command")}>Copy command</Button></div></div><PushShells terminals={pushTerminals} loading={pushTerminalsLoading} onRefresh={loadPushTerminals} onRetry={() => setAction("sync")} onCopy={(value) => void copyText(value, "Terminal ID")} />{links ? <div className="border-t border-emerald-500/20 pt-3"><p className="font-medium">On GitHub</p><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" asChild><a href={links.treeUrl} target="_blank" rel="noreferrer" title={`Open ${branch} on GitHub`}>View branch ↗</a></Button>{links.compareUrl ? <Button size="sm" variant="outline" asChild><a href={links.compareUrl} target="_blank" rel="noreferrer" title="Open a pull request for this branch on GitHub">Open pull request ↗</a></Button> : null}</div></div> : null}</div>}
          {publishesToDefaultBranch ? <p className="text-muted-foreground">This is the default checkout selected in BB. BB creates a local commit on <code>{publicationDefaultBranch}</code> only: it cannot fetch remote updates, merge incoming changes, push, or create a pull request from this panel. Before saving, confirm that this checkout is current and exclusively yours. Choose a feature branch or managed worktree in BB’s composer for a pull-request workflow.</p> : <p className="text-muted-foreground">BB owns commit execution on the workspace host. Stelow never stages or runs Git commands locally.</p>}
          {!publishesToDefaultBranch ? <details className="group border-t pt-3" open={advancedGitOpen} onToggle={(event) => setAdvancedGitOpen((event.currentTarget as HTMLDetailsElement).open)}><summary className="flex cursor-pointer items-center gap-1.5 font-medium text-foreground"><DisclosureChevron open={advancedGitOpen} />Advanced Git operations</summary><div className="mt-2 space-y-2 text-muted-foreground"><p>Squash branch locally combines this branch’s already committed changes into one commit on its local base branch. It does not fetch remote updates, push, or create a pull request. Use it only when you own local integration.</p><Button size="sm" variant="outline" disabled={!publication.capabilities.squashMerge.available} title={publication.capabilities.squashMerge.reason ?? "Squash committed branch changes into the local base branch"} onClick={() => setAction("squash")}>Squash branch locally…</Button></div></details> : null}
          {publication.pullRequest ? <div className="space-y-2 border-t pt-3"><p className="text-muted-foreground">Pull request <UrlLink href={publication.pullRequest.url} className="font-medium text-primary underline-offset-4 hover:underline">#{publication.pullRequest.number} · {publication.pullRequest.title}</UrlLink> · {publication.pullRequest.attention.replaceAll("_", " ")}</p><p className="text-muted-foreground">Review: {publication.pullRequest.review.replaceAll("_", " ")} · checks: {publication.pullRequest.checks.replaceAll("_", " ")} · mergeability: {publication.pullRequest.mergeability}</p><div className="flex flex-wrap gap-2">{publication.pullRequest.state === "draft" ? <Button size="sm" variant="outline" disabled={!publication.capabilities.markReady.available} title={publication.capabilities.markReady.reason ?? "Mark this pull request ready for review"} onClick={() => setAction("ready")}>Mark ready…</Button> : <Button size="sm" variant="outline" disabled={!publication.capabilities.markDraft.available} title={publication.capabilities.markDraft.reason ?? "Convert this pull request to draft"} onClick={() => setAction("draft")}>Mark draft…</Button>}<select value={mergeMethod} onChange={(event) => setMergeMethod(event.target.value as typeof mergeMethod)} className="min-h-9 cursor-pointer rounded-md border bg-background px-2 text-xs" aria-label="Merge method"><option value="squash">Squash merge</option><option value="merge">Merge commit</option><option value="rebase">Rebase merge</option></select><Button size="sm" disabled={!publication.capabilities.mergePullRequest.available} title={publication.capabilities.mergePullRequest.reason ?? "Merge this pull request through BB"} onClick={() => setAction("merge")}>Merge PR…</Button></div></div> : <p className="border-t pt-3 text-muted-foreground">{publication.pullRequestMessage ?? "No pull request is linked to this branch. BB can manage an existing pull request; create and push it through your Git provider or BB's native PR flow."}</p>}
          {publication.events.length > 0 ? <div className="border-t pt-3"><p className="mb-1 font-medium text-foreground">Publication history</p><ul className="space-y-1 text-muted-foreground">{publication.events.map((event) => <li key={event.id}>{event.action.replaceAll("_", " ")} · {event.commitSha ? event.message.replace(event.commitSha, event.commitSha.slice(0, 7)) : event.message}{event.commitSha ? <> · <button type="button" className="cursor-pointer text-primary underline-offset-2 hover:underline" onClick={() => void openCommit(event.commitSha!)} title={`View ${event.commitSha.slice(0, 7)} in BB`}>View commit</button></> : null}{event.pullRequestUrl ? <> · <UrlLink href={event.pullRequestUrl} className="text-primary underline-offset-2 hover:underline">Open PR</UrlLink></> : null}</li>)}</ul></div> : null}
          {publication.pullRequest?.state === "merged" ? <WorktreeCleanupSuggestion cardId={cardId} prMerged onChanged={() => { void loadPublication(); void onChanged(); }} /> : null}
        </div> : null}
      </DisclosureSection>
    </> }</CommitDiffReview>
    <PublicationActions
      cardId={cardId}
      action={action}
      setAction={setAction}
      publicationDefaultBranch={publicationDefaultBranch}
      publishesToDefaultBranch={publishesToDefaultBranch}
      behind={behind}
      mergeMethod={mergeMethod}
      loadPublication={loadPublication}
      loadPushTerminals={loadPushTerminals}
      schedulePushRefresh={schedulePushRefresh}
      onChanged={onChanged}
    />
  </>;
}

async function copyText(text: string, label: string) {
  try { await navigator.clipboard.writeText(text); toast.success(`${label} copied.`); return; } catch { /* fallback below */ }
  try {
    const area = document.createElement("textarea"); area.value = text; area.setAttribute("readonly", ""); area.style.position = "fixed"; area.style.opacity = "0"; document.body.appendChild(area); area.select();
    if (document.execCommand("copy")) { area.remove(); toast.success(`${label} copied.`); return; }
    area.remove();
  } catch { /* manual fallback below */ }
  toast.error(`Copy failed — select and copy by hand: ${text}`);
}

function PushShells({ terminals, loading, onRefresh, onRetry, onCopy }: { terminals: PushTerminals | null; loading: boolean; onRefresh: () => void | Promise<void>; onRetry: () => void; onCopy: (value: string) => void }) {
  return <div className="mt-2 rounded-md border border-emerald-500/20 p-2"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-wider text-emerald-900/70 dark:text-emerald-100/70">Push shells</p><Button size="sm" variant="outline" disabled={loading} onClick={() => void onRefresh()}>{loading ? "Checking…" : "Check result"}</Button></div>{loading ? <p className="mt-1 text-emerald-900/80 dark:text-emerald-100/80">Checking push shells…</p> : null}{!loading && terminals && !terminals.ok ? <p className="mt-1 text-emerald-900/80 dark:text-emerald-100/80">{terminals.error ?? "Unable to list push shells."}</p> : null}{!loading && terminals?.ok && terminals.terminals.length === 0 ? <p className="mt-1 text-emerald-900/80 dark:text-emerald-100/80">No push shell opened yet.</p> : null}{!loading && terminals?.ok ? terminals.terminals.map((terminal) => <div key={terminal.id} className="mt-2 rounded border border-emerald-500/20 bg-background/60 p-2 text-foreground"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs"><span className="font-medium">{terminal.title}</span> · {terminal.outputUnavailable ? "○ Ended — output unavailable" : terminal.pushState === "succeeded" ? "✓ Pushed" : terminal.pushState === "failed" ? `✗ Push failed${terminal.pushExit !== null ? ` (exit ${terminal.pushExit})` : ""}` : terminal.pushState === "waiting" ? "○ Waiting — git push typed but NOT sent" : "… Running"} · {new Date(terminal.createdAt).toLocaleString()}</p><Button size="sm" variant="ghost" title="Copy this shell's ID — paste it in BB's sidebar terminal panel to jump to the exact shell that ran this" onClick={() => onCopy(terminal.id)}>Copy terminal ID</Button></div><p className="mt-1 font-mono text-[11px] text-muted-foreground">{terminal.id}</p>{terminal.pushState === "waiting" && !terminal.outputUnavailable ? <p className="mt-1 text-xs text-muted-foreground">An older shell from before pushes ran themselves. Press Enter in BB’s sidebar terminal {terminal.id} to send it, or click Push now above for a fresh tracked run.</p> : null}{terminal.pushState === "running" && !terminal.outputUnavailable ? <p className="mt-1 text-xs text-muted-foreground">Push sent — waiting for the remote. If it asks for auth, finish it in BB’s sidebar terminal {terminal.id}, then Check result.</p> : null}{terminal.pushState === "failed" && !terminal.outputUnavailable ? (() => { const tail = terminal.outputTail ?? ""; if (/STELOW_SYNC_ABORTED:1/.test(tail)) return <p className="mt-1 text-xs text-muted-foreground">Pull conflicted — the rebase aborted itself, so your checkout is unchanged. Resolve the conflict where you edit code, then come back and Push now.</p>; if (/STELOW_SYNC_EXIT:([1-9][0-9]*)/.test(tail)) return <p className="mt-1 text-xs text-muted-foreground">Pull itself failed (network or auth?) — details above. <Button size="sm" variant="outline" onClick={onRetry}>Sync &amp; push again…</Button></p>; return <p className="mt-1 text-xs text-muted-foreground">The remote rejected the push (usually: your branch is behind). <Button size="sm" variant="outline" onClick={onRetry}>Sync &amp; push again…</Button> pulls with rebase, then pushes — one click, no sidebar needed.</p>; })() : null}{terminal.outputTail ? <><p className="mt-1 text-[11px] text-muted-foreground">Snapshot — refresh with Check result; this view is not interactive.</p><pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-muted/60 p-2 font-mono text-[11px]">{terminal.outputTail}</pre></> : null}{terminal.outputUnavailable ? <p className="mt-1 text-xs text-muted-foreground">Output unavailable — the shell already exited. Its result is in the Git history / remote instead.</p> : null}</div>) : null}</div>;
}

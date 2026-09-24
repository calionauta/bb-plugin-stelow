import { useCallback, useEffect, useState } from "react";
import { Markdown, UrlLink, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../../server";
import { Button } from "@/components/ui/button";
import { DisclosureSection } from "../disclosure";
import { useDebouncedRealtime } from "../use-debounced-realtime";

type LinkedDiscussionSnapshot = {
  linked: boolean;
  repo: string | null;
  number: number | null;
  url: string | null;
  comments: Array<{ author: string; body: string; createdAt: number }>;
  updatedAt: number | null;
  canCreate: boolean;
  repos: string[];
};

export function LinkedDiscussionSection({ cardId }: { cardId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [discussion, setDiscussion] = useState<LinkedDiscussionSnapshot | null>(null);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createRepo, setCreateRepo] = useState<string | null>(null);

  const loadDiscussion = useCallback(async () => {
    try {
      setDiscussion(await rpc.call("getLinkedDiscussion", { cardId }));
    } catch {
      setDiscussion(null);
    }
  }, [cardId, rpc]);

  useEffect(() => { void loadDiscussion(); }, [loadDiscussion]);
  useDebouncedRealtime(["github-discussion"], () => { void loadDiscussion(); });

  if (!discussion) return null;
  if (!discussion.linked) {
    if (!discussion.canCreate || discussion.repos.length === 0) return null;
    const selected = createRepo ?? discussion.repos[0] ?? null;
    const create = async () => {
      if (creating) return;
      setCreating(true);
      try {
        const link = await rpc.call("createLinkedGithubIssue", { cardId, repo: createRepo });
        if (link.ok) {
          toast.success(`GitHub issue #${link.number} created and linked.`);
          await loadDiscussion();
        } else {
          toast.error(link.error ?? "GitHub issue creation failed.");
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "GitHub issue creation failed.");
      } finally {
        setCreating(false);
      }
    };
    return (
      <DisclosureSection title="Linked discussion" subtitle="link it">
        <p className="text-xs text-muted-foreground">No linked issue yet — link one to mirror its thread here.</p>
        {discussion.repos.length > 1 ? (
          <select value={selected ?? ""} onChange={(event) => setCreateRepo(event.target.value || null)} className="h-10 cursor-pointer rounded-md border bg-background px-2 text-sm" aria-label="GitHub repository for the new issue">
            <option value="">Pick a repository</option>
            {discussion.repos.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        ) : null}
        <div><Button size="sm" disabled={creating} onClick={() => void create()}>{creating ? "Creating…" : `Create issue${discussion.repos.length === 1 ? ` in ${discussion.repos[0]}` : ""}`}</Button></div>
      </DisclosureSection>
    );
  }

  const post = async () => {
    if (posting || !draft.trim()) return;
    setPosting(true);
    setPostError(null);
    try {
      const result = await rpc.call("postIssueComment", { cardId, body: draft.trim() });
      if (result.ok) {
        setDraft("");
        setConfirming(false);
        toast.success("Comment posted on GitHub.");
        await loadDiscussion();
      } else {
        setPostError(result.error ?? "GitHub refused the comment.");
      }
    } catch (error) {
      setPostError(error instanceof Error ? error.message : "GitHub refused the comment.");
    } finally {
      setPosting(false);
    }
  };

  return (
    <DisclosureSection title="Linked discussion" hint={discussion.comments.length ? `${discussion.comments.length} · mirror` : "mirror"}>
      <div className="space-y-2">
        {discussion.url ? <div><UrlLink href={discussion.url} className="text-xs font-medium text-primary underline-offset-4 hover:underline">Open on GitHub ↗</UrlLink></div> : null}
        {discussion.comments.length ? discussion.comments.map((entry, index) => (
          <div key={`${entry.author}-${entry.createdAt}-${index}`} className="rounded-lg border border-border bg-muted/30 p-2.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{entry.author || "Someone"}</span>
              <span title={new Date(entry.createdAt).toLocaleString()}>{new Date(entry.createdAt).toLocaleString()}</span>
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px]">mirror</span>
            </div>
            <div className="mt-1 text-sm leading-relaxed"><Markdown content={entry.body} /></div>
          </div>
        )) : <p className="text-xs text-muted-foreground">No comments yet.</p>}
        {confirming ? (
          <div className="space-y-2 rounded-md border border-primary/25 bg-primary/5 p-2.5">
            <p className="text-xs font-medium">Post to {discussion.repo}#{discussion.number} as a comment — public and hard to undo.</p>
            <div className="max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">{draft.trim()}</div>
            {postError ? <p className="text-xs text-destructive">{postError}</p> : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={posting} onClick={() => void post()}>{posting ? "Posting…" : "Confirm post"}</Button>
              <Button size="sm" variant="outline" disabled={posting} onClick={() => { setConfirming(false); setPostError(null); }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Write to the issue</span>
              <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} className="min-h-24 w-full rounded-md border bg-background p-2 text-sm leading-relaxed focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" placeholder="Comment as yourself on the linked issue…" />
            </label>
            {postError ? <p className="text-xs text-destructive">{postError}</p> : null}
            <div><Button size="sm" variant="outline" disabled={!draft.trim() || posting} onClick={() => { setPostError(null); setConfirming(true); }}>Post to issue</Button></div>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">Read-only mirror of the issue thread — external text is never fed to workers.</p>
      </div>
    </DisclosureSection>
  );
}

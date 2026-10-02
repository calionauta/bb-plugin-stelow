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

  const createIssue = useCallback(async () => {
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
  }, [creating, createRepo, cardId, loadDiscussion, rpc]);

  if (!discussion) return null;
  if (!discussion.linked) {
    return (
      <UnlinkedDiscussionCard
        canCreate={discussion.canCreate}
        repos={discussion.repos}
        creating={creating}
        createRepo={createRepo}
        onRepoChange={setCreateRepo}
        onCreate={createIssue}
      />
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
    <DisclosureSection
      title="Linked discussion"
      // The linked issue's identity is the one fact this section owns, so it
      // leads. It used to be a line inside the worker section — a different
      // component, two scroll positions up — while the mirror sat here saying
      // "Open on GitHub" with no name or number, so a reader could see that a
      // link existed without ever learning which issue it was.
      subtitle={discussion.repo && discussion.number ? `mirrored from ${discussion.repo}#${discussion.number}` : "link it"}
      hint={discussion.comments.length ? `${discussion.comments.length} · mirror` : "mirror"}
    >
      <div className="space-y-2">
        {discussion.url ? <div><UrlLink href={discussion.url} className="text-xs font-medium text-primary underline-offset-4 hover:underline">Open on GitHub ↗</UrlLink></div> : null}
        {discussion.comments.length ? discussion.comments.map((entry, index) => (
          <MirroredComment key={`${entry.author}-${entry.createdAt}-${index}`} entry={entry} />
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
        <p className="text-xs text-muted-foreground">Read-only mirror of the issue thread — external text is never fed to workers.</p>
      </div>
    </DisclosureSection>
  );
}

/**
 * The unlinked half: create an issue and link it.
 *
 * Extracted from `LinkedDiscussionSection`, which was one function answering
 * two unrelated questions — "is there a mirror to show" and "would you like
 * to start one" — with their own state and their own lifecycle. The file
 * budget gate caught this after the merge scope pushed the file past its
 * recorded baseline, and the split is by question rather than by line count:
 * creation is an affordance, the mirror is a reader, and neither needs the
 * other's state.
 */
function UnlinkedDiscussionCard({
  canCreate,
  repos,
  creating,
  createRepo,
  onRepoChange,
  onCreate,
}: {
  canCreate: boolean;
  repos: string[];
  creating: boolean;
  createRepo: string | null;
  onRepoChange: (repo: string | null) => void;
  onCreate: () => Promise<void>;
}) {
  // A card with no GitHub access still renders this section — one that says
  // why there is nothing to link. Returning null made the affordance "closed
  // section, or nowhere": a card the user could not link showed nothing at all,
  // so a section they could not see was a section they could not want. Now the
  // shape is always present and never promises an action it cannot offer.
  const noRepos = !canCreate || repos.length === 0;
  const selected = createRepo ?? repos[0] ?? null;
  return (
    // Unlinked, this is an affordance rather than information: the import path
    // already supplies the common case where a card arrives linked, so
    // "create an issue" is something a reader goes looking for, not something
    // that should hold a place in the primary reading path. It stays a real
    // section — findable beats hidden — but it starts closed and names what it
    // is for.
    <DisclosureSection title="Linked discussion" subtitle="link an issue to mirror it here">
      {noRepos
        ? (
          <NoGitHubAccess />
        )
        : (
          <CreateIssueForm
            repos={repos}
            selected={selected}
            creating={creating}
            onRepoChange={onRepoChange}
            onCreate={onCreate}
          />
        )}
    </DisclosureSection>
  );
}

/**
 * The unlinked card that CAN create: pick a repository, create the issue.
 *
 * Its own component so the section above reads as "empty state or form" rather
 * than as one function holding two answers. The prompt asks when a repo list
 * is longer than one, so the select appears only when there is a choice to
 * make.
 */
function CreateIssueForm({
  repos,
  selected,
  creating,
  onRepoChange,
  onCreate,
}: {
  repos: string[];
  selected: string | null;
  creating: boolean;
  onRepoChange: (repo: string | null) => void;
  onCreate: () => Promise<void>;
}) {
  return (
    <>
      <p className="text-xs text-muted-foreground">
        No linked issue yet. Cards imported from GitHub arrive linked; this is here when you want to
        link one by hand.
      </p>
      {repos.length > 1 ? (
        <select
          value={selected ?? ""}
          onChange={(event) => onRepoChange(event.target.value || null)}
          className="h-10 cursor-pointer rounded-md border bg-background px-2 text-sm"
          aria-label="GitHub repository for the new issue"
        >
          <option value="">Pick a repository</option>
          {repos.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      ) : null}
      <div>
        <Button size="sm" disabled={creating} onClick={() => void onCreate()}>
          {creating ? "Creating…" : `Create issue${repos.length === 1 ? ` in ${repos[0]}` : ""}`}
        </Button>
      </div>
    </>
  );
}

/**
 * The unlinked card with no GitHub access: why there is nothing to link, and
 * where to go instead.
 *
 * Its own component because it is a different ANSWER from the create form, not
 * a shorter version of it — the form asks a question this card cannot ask, this
 * states the fact and stops. Both cases used to collapse to `null`, which is
 * what made the affordance invisible on exactly the cards that needed it.
 */
function NoGitHubAccess() {
  return (
    <p className="text-xs text-muted-foreground">
      No linked issue, and this card has no GitHub repository it can create one in. Link one from a
      repository mapped to this workspace, or create the issue on GitHub and link it from the
      card&apos;s actions.
    </p>
  );
}

/** One mirrored GitHub comment: who said it, when, and the body. */
function MirroredComment({ entry }: { entry: LinkedDiscussionSnapshot["comments"][number] }) {
  const when = new Date(entry.createdAt).toLocaleString();
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-2.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{entry.author || "Someone"}</span>
        <span title={when}>{when}</span>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px]">mirror</span>
      </div>
      <div className="mt-1 text-sm leading-relaxed"><Markdown content={entry.body} /></div>
    </div>
  );
}

import { Button } from "@/components/ui/button";
import { UrlLink } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import type { PublicationAction } from "./build-publication-actions";
import type { rpcContract } from "../../server";

/**
 * The pull-request half of the publication panel: which PR exists, whether it
 * can be merged, and the three actions that change it.
 *
 * Separate from the workspace half because the two are independent — a card
 * can have a local commit and no PR, a PR and no local commit, or either. A
 * reader asking "is this card landed?" needs both, and reading them in one
 * component made the section unreadable.
 *
 * The merge method is a closed set of the names the publication RPC accepts,
 * declared once so the <select> and the action cannot drift apart.
 */

type PublicationStatus = z.infer<typeof rpcContract.publicationStatus.output>;

/** Why the panel shows no pull request, when it has none to manage. */
const NO_PULL_REQUEST_MESSAGE = [
  "No pull request is linked to this branch.",
  "BB can manage an existing pull request;",
  "create and push it through your Git provider or BB's native PR flow.",
].join(" ");
export type MergeMethod = "merge" | "rebase" | "squash";

/**
 * Review, checks and mergeability as one sentence. These are the three facts
 * that decide whether the merge button is available, so they are read
 * together rather than as separate status lines.
 */
export function PullRequestGateState({ pullRequest }: {
  pullRequest: NonNullable<NonNullable<PublicationStatus>["pullRequest"]>;
}) {
  return (
    <p className="text-muted-foreground">
      Review: {pullRequest.review.replaceAll("_", " ")} · checks:{" "}
      {pullRequest.checks.replaceAll("_", " ")} · mergeability: {pullRequest.mergeability}
    </p>
  );
}

/**
 * Ready-for-review is a toggle with two names and one question: is the pull
 * request currently a draft? Both branches offer the move that changes it.
 */
export function PullRequestStateToggle({ pullRequest, capabilities, setAction }: {
  pullRequest: NonNullable<NonNullable<PublicationStatus>["pullRequest"]>;
  capabilities: NonNullable<PublicationStatus>["capabilities"];
  setAction: (action: PublicationAction | null) => void;
}) {
  if (pullRequest.state === "draft") {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={!capabilities.markReady.available}
        title={capabilities.markReady.reason ?? "Mark this pull request ready for review"}
        onClick={() => setAction("ready")}
      >
        Mark ready…
      </Button>
    );
  }
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={!capabilities.markDraft.available}
      title={capabilities.markDraft.reason ?? "Convert this pull request to draft"}
      onClick={() => setAction("draft")}
    >
      Mark draft…
    </Button>
  );
}

/**
 * The pull request block: identity, review state, and the three actions that
 * change it. Split out of the section because it is the one block whose
 * controls are the reason a reader opened this panel at all.
 */
export function PullRequestPanel({
  publication,
  mergeMethod,
  setMergeMethod,
  setAction,
}: {
  publication: NonNullable<PublicationStatus>;
  mergeMethod: MergeMethod;
  setMergeMethod: (method: MergeMethod) => void;
  setAction: (action: PublicationAction | null) => void;
}) {
  const pullRequest = publication.pullRequest;
  if (!pullRequest) {
    return (
      <p className="border-t pt-3 text-muted-foreground">
        {publication.pullRequestMessage ?? NO_PULL_REQUEST_MESSAGE}
      </p>
    );
  }
  return (
    <div className="space-y-2 border-t pt-3">
      <p className="text-muted-foreground">
        Pull request{" "}
        <UrlLink href={pullRequest.url} className="font-medium text-primary underline-offset-4 hover:underline">
          #{pullRequest.number} · {pullRequest.title}
        </UrlLink>{" "}
        · {pullRequest.attention.replaceAll("_", " ")}
      </p>
      <PullRequestGateState pullRequest={pullRequest} />
      <div className="flex flex-wrap gap-2">
        <PullRequestStateToggle
          pullRequest={pullRequest}
          capabilities={publication.capabilities}
          setAction={setAction}
        />
        <MergeMethodSelect value={mergeMethod} onChange={setMergeMethod} />
        <Button
          size="sm"
          disabled={!publication.capabilities.mergePullRequest.available}
          title={publication.capabilities.mergePullRequest.reason ?? "Merge this pull request through BB"}
          onClick={() => setAction("merge")}
        >
          Merge PR…
        </Button>
      </div>
    </div>
  );
}

/**
 * What this finished card still owes its repository, stated once at the top
 * of the panel — before the buttons that would fix it, so the reader knows
 * which of them to reach for.
 */
export function IntegrationPendingNotice({ pending }: { pending: { label: string; detail: string } }) {
  return (
    <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-amber-900 dark:text-amber-200">
      <span className="font-medium">Still to integrate.</span> {pending.detail}
    </p>
  );
}

/**
 * The three merge shapes as their own control, so the panel does not carry a
 * raw <select> next to the buttons it configures.
 */
export function MergeMethodSelect({ value, onChange }: {
  value: MergeMethod;
  onChange: (method: MergeMethod) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as MergeMethod)}
      className="min-h-9 cursor-pointer rounded-md border bg-background px-2 text-xs"
      aria-label="Merge method"
    >
      <option value="squash">Squash merge</option>
      <option value="merge">Merge commit</option>
      <option value="rebase">Rebase merge</option>
    </select>
  );
}

import { Button } from "@/components/ui/button";
import { z } from "zod";
import { branchWebLinks } from "../../lib/remote-url.mjs";
import { copyText } from "./copy-text";
import { CheckoutOwnershipNote, LocalSquashDisclosure } from "./build-publication-checkout";
import { IntegrationPendingNotice, PublicationHistory } from "./build-publication-history";
import { PullRequestPanel, type MergeMethod } from "./build-publication-pull-request";
import {
  BranchContextLine,
  BranchPublishStep,
  GitHubBranchLinks,
  PushShells,
  SavedCommitSummary,
  UnsavedWorkspace,
  type PushShellList,
} from "./build-publication-workspace";
import type { PublicationAction } from "./build-publication-actions";
import { WorktreeCleanupSuggestion } from "../worktree-cleanup-suggestion";
import type { rpcContract } from "../../server";

type PublicationStatus = z.infer<typeof rpcContract.publicationStatus.output>;


/**
 * Everything the publication panel renders, in the order a reader needs it:
 * what the card owes, where the work lives, what was saved, what the checkout
 * can do, then the pull request and the record of what was done.
 *
 * None of this owns state. The RPC polling, the push terminals and the
 * action dialog live in build-publication.tsx, which hands this block plain
 * values — so the whole surface can be read without tracing a lifecycle.
 */

export type PublicationRenderState = {
  publication: PublicationStatus | null;
  integrationPending: { label: string; detail: string } | null;
  verifiedHeadSha: string | null;
  facts: ReturnType<typeof sectionFacts>;
  pushTerminals: PushShellList | null;
  pushTerminalsLoading: boolean;
  loadPushTerminals: () => Promise<void>;
  advancedGitOpen: boolean;
  setAdvancedGitOpen: (open: boolean) => void;
  mergeMethod: MergeMethod;
  setMergeMethod: (method: MergeMethod) => void;
  setAction: (action: PublicationAction | null) => void;
  openCommit: (sha: string) => void;
  cardId: string;
  onChanged: () => void | Promise<void>;
  reloadPublication: () => Promise<void>;
};

/**
 * Everything the panel derives from the two sources it is handed.
 *
 * Named so the shape of "what this card still owes" is one reading rather than
 * a column of bindings, and so the two halves below can share one derivation
 * without each recomputing it.
 */
export function sectionFacts(publication: PublicationStatus | null, pushTerminals: PushShellList | null) {
  const savedSha = publication?.events
    .find((event) => event.action === "commit" && event.commitSha)?.commitSha ?? null;
  const latestPush = pushTerminals?.terminals[0] ?? null;
  const pushed = latestPush?.pushState === "succeeded" && !latestPush.outputUnavailable;
  const behind = publication?.mergeBase?.behind ?? 0;
  const branch = publication?.branch?.current ?? "this branch";
  const defaultBranch = publication?.branch?.default ?? null;
  return {
    savedSha,
    isCurrentHead: Boolean(savedSha && publication?.branch?.headSha === savedSha),
    pushed,
    pushUnknown: !pushed && (latestPush?.outputUnavailable ?? false),
    unsaved: !savedSha || Boolean(publication?.workingTree?.hasUncommittedChanges),
    behind,
    branch,
    links: publication && (pushed || publication.pullRequest)
      ? branchWebLinks(pushTerminals?.remote ?? null, publication.branch?.current ?? null, publication.mergeBase?.branch ?? publication.branch?.default ?? null)
      : null,
    publicationDefaultBranch: defaultBranch,
    publishesToDefaultBranch: Boolean(defaultBranch && publication?.branch?.current === defaultBranch),
  };
}

export function PublicationBody(props: PublicationRenderState) {
  const { publication, facts } = props;
  if (!publication) return null;
  return (
    <div className="space-y-3 text-xs">
      <WorkspaceBody
        publication={publication}
        facts={facts}
        integrationPending={props.integrationPending}
        verifiedHeadSha={props.verifiedHeadSha}
        pushTerminals={props.pushTerminals}
        pushTerminalsLoading={props.pushTerminalsLoading}
        loadPushTerminals={props.loadPushTerminals}
        openCommit={props.openCommit}
        setAction={props.setAction}
      />
      <CheckoutOwnershipNote
        publishesToDefaultBranch={facts.publishesToDefaultBranch}
        defaultBranch={facts.publicationDefaultBranch}
      />
      {publication.relevanceNote ? (
        <p className="text-muted-foreground">{publication.relevanceNote}</p>
      ) : null}
      <PublicationIntegration
        publication={publication}
        facts={facts}
        advancedGitOpen={props.advancedGitOpen}
        setAdvancedGitOpen={props.setAdvancedGitOpen}
        mergeMethod={props.mergeMethod}
        cardId={props.cardId}
        setAction={props.setAction}
        setMergeMethod={props.setMergeMethod}
        openCommit={props.openCommit}
        onChanged={props.onChanged}
        reloadPublication={props.reloadPublication}
      />
    </div>
  );
}

/**
 * Everything that can still put this card's work on the base branch: the
 * local squash, the pull request, the record of what was done, and the
 * worktree cleanup a merged pull request unlocks.
 */
function PublicationIntegration(props: {
  publication: PublicationStatus;
  facts: ReturnType<typeof sectionFacts>;
  advancedGitOpen: boolean;
  setAdvancedGitOpen: (open: boolean) => void;
  mergeMethod: MergeMethod;
  cardId: string;
  setAction: (action: PublicationAction | null) => void;
  setMergeMethod: (method: MergeMethod) => void;
  openCommit: (sha: string) => void;
  onChanged: () => void | Promise<void>;
  reloadPublication: () => Promise<void>;
}) {
  const { publication, facts } = props;
  // A card whose deliverable is a finding has nothing to integrate past its
  // commit, so the local squash and the pull-request block are not rendered —
  // the note above already says why. Hiding is not disabling: a disabled
  // button invites the reader to work out which policy refused them.
  const delivers = publication.relevanceNote === null;
  return (
    <>
      {delivers && !facts.publishesToDefaultBranch ? (
        <LocalSquashDisclosure
          publication={publication}
          open={props.advancedGitOpen}
          setOpen={props.setAdvancedGitOpen}
          setAction={props.setAction}
        />
      ) : null}
      {delivers ? (
        <PullRequestPanel
          publication={publication}
          mergeMethod={props.mergeMethod}
          setMergeMethod={props.setMergeMethod}
          setAction={props.setAction}
        />
      ) : null}
      <PublicationHistory events={publication.events} openCommit={props.openCommit} />
      {publication.pullRequest?.state === "merged" ? (
        <WorktreeCleanupSuggestion
          cardId={props.cardId}
          prMerged
          onChanged={() => { void props.reloadPublication(); void props.onChanged(); }}
        />
      ) : null}
    </>
  );
}

/**
 * The workspace half: what the card owes, where the work lives, and what is
 * or is not saved. Split from the pull-request half so each stays readable —
 * the two are independent states of the same card.
 */
function WorkspaceBody(props: {
  publication: PublicationStatus;
  facts: ReturnType<typeof sectionFacts>;
  integrationPending: { label: string; detail: string } | null;
  verifiedHeadSha: string | null;
  pushTerminals: PushShellList | null;
  pushTerminalsLoading: boolean;
  loadPushTerminals: () => Promise<void>;
  openCommit: (sha: string) => void;
  setAction: (action: PublicationAction | null) => void;
}) {
  const { publication, facts } = props;
  return (
    <>
      {props.integrationPending ? <IntegrationPendingNotice pending={props.integrationPending} /> : null}
      {publication.message ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-amber-900 dark:text-amber-200">
          {publication.message}
        </p>
      ) : null}
      <BranchContextLine publication={publication} />
      {facts.unsaved ? (
        <UnsavedWorkspace
          publication={publication}
          verifiedHeadSha={props.verifiedHeadSha}
          publishesToDefaultBranch={facts.publishesToDefaultBranch}
          publicationDefaultBranch={facts.publicationDefaultBranch}
          setAction={props.setAction}
        />
      ) : facts.savedSha ? (
        <SavedWorkspace
          publication={publication}
          facts={facts}
          pushTerminals={props.pushTerminals}
          pushTerminalsLoading={props.pushTerminalsLoading}
          loadPushTerminals={props.loadPushTerminals}
          setAction={props.setAction}
          openCommit={props.openCommit}
        />
      ) : null}
    </>
  );
}

/**
 * A saved, clean workspace: what was saved, what is left to publish, the push
 * shells that ran, and the GitHub links. One block because it is one state.
 */
function SavedWorkspace(props: {
  publication: PublicationStatus;
  facts: ReturnType<typeof sectionFacts>;
  pushTerminals: PushShellList | null;
  pushTerminalsLoading: boolean;
  loadPushTerminals: () => Promise<void>;
  setAction: (action: PublicationAction | null) => void;
  openCommit: (sha: string) => void;
}) {
  const { facts, publication } = props;
  return (
    <div className="space-y-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 text-emerald-950 dark:text-emerald-100">
      <SavedCommitSummary
        branch={facts.branch}
        savedSha={facts.savedSha ?? ""}
        isCurrentHead={facts.isCurrentHead}
        pushed={facts.pushed}
        pushUnknown={facts.pushUnknown}
        openCommit={props.openCommit}
      />
      {publication.relevanceNote === null ? (
        <BranchPublishStep pushed={facts.pushed} behind={facts.behind} setAction={props.setAction} />
      ) : null}
      <PushShells
        terminals={props.pushTerminals}
        loading={props.pushTerminalsLoading}
        onRefresh={props.loadPushTerminals}
        onRetry={() => props.setAction("sync")}
        onCopy={(value) => void copyText(value, "Terminal ID")}
      />
      <GitHubBranchLinks links={facts.links} branch={facts.branch} />
    </div>
  );
}

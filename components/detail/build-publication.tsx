import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { z } from "zod";
import { PublicationActions, type PublicationAction } from "./build-publication-actions";
import { PublicationBody, sectionFacts, type PublicationRenderState } from "./build-publication-body";
import type { MergeMethod } from "./build-publication-pull-request";
import type { PushShellList } from "./build-publication-workspace";
import { Button } from "@/components/ui/button";
import { DisclosureSection } from "../disclosure";
import { CommitDiffReview } from "./build-commit-diff";
import type { rpcContract } from "../../server";

/**
 * The stateful half of the publication panel: it polls the host, owns the
 * push terminals and the action dialog, and hands the result to the read-only
 * rendering in build-publication-body.tsx.
 *
 * The split is the point. Everything here is an effect or a fetch; everything
 * there is a function of values. Keeping them apart is what stopped this
 * panel from being unreadable, and it means a change to what a card shows
 * never risks re-running a poll.
 */

type PublicationStatus = z.infer<typeof rpcContract.publicationStatus.output>;

type BuildPublicationProps = {
  cardId: string;
  /** What this finished card still owes its repository, from the detail card. */
  integrationPending?: { label: string; detail: string } | null;
  verifiedHeadSha: string | null;
  recoveryContent?: ReactNode;
  onChanged: () => void | Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  onBranchChange: (branch: string | null) => void;
};

/**
 * Everything the panel reads from the host, and the timers that re-read it.
 *
 * Owning the polling here means the component below renders and nothing else:
 * a push the user starts takes a while to land, so the panel re-checks on a
 * schedule rather than asking the user to refresh, and those timers are
 * cleared on unmount so a closed card stops asking.
 */
function usePublicationState(cardId: string, rpc: ReturnType<typeof useRpc<typeof rpcContract>>) {
  const [publication, setPublication] = useState<PublicationStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [pushTerminals, setPushTerminals] = useState<PushShellList | null>(null);
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
      toast.error(err instanceof Error ? err.message : "Unable to list push shells.");
    } finally {
      setPushTerminalsLoading(false);
    }
  }, [cardId, rpc]);

  useEffect(() => { void loadPublication(); void loadPushTerminals(); }, [loadPublication, loadPushTerminals]);
  useEffect(() => () => { for (const timer of pushRefreshTimers.current) window.clearTimeout(timer); pushRefreshTimers.current = []; }, []);

  function schedulePushRefresh(action: PublicationAction) {
    // A push takes a while and the user should not have to poll. The first
    // check lands before most pushes finish, so two spaced checks.
    const delays = action === "sync" ? [10000, 25000] : [8000, 20000];
    pushRefreshTimers.current.push(...delays.map((delay) => window.setTimeout(() => void loadPushTerminals(), delay)));
  }

  return {
    publication, loading, pushTerminals, pushTerminalsLoading,
    loadPublication, loadPushTerminals, schedulePushRefresh,
  };
}

export function BuildPublication({
  cardId,
  integrationPending,
  verifiedHeadSha,
  recoveryContent,
  onChanged,
  onDirtyChange,
  onBranchChange,
}: BuildPublicationProps) {
  const rpc = useRpc<typeof rpcContract>();
  const state = usePublicationState(cardId, rpc);

  useEffect(() => { onDirtyChange(Boolean(state.publication?.workingTree?.hasUncommittedChanges)); }, [onDirtyChange, state.publication]);
  useEffect(() => { onBranchChange(state.publication?.branch?.current ?? null); }, [onBranchChange, state.publication]);

  return <PublicationSection
    cardId={cardId}
    integrationPending={integrationPending ?? null}
    verifiedHeadSha={verifiedHeadSha}
    recoveryContent={recoveryContent}
    onChanged={onChanged}
    {...state}
  />;
}

type PublicationSectionProps = {
  cardId: string;
  integrationPending: { label: string; detail: string } | null;
  verifiedHeadSha: string | null;
  recoveryContent?: ReactNode;
  publication: PublicationStatus | null;
  loading: boolean;
  pushTerminals: PushShellList | null;
  pushTerminalsLoading: boolean;
  loadPublication: () => Promise<void>;
  loadPushTerminals: () => Promise<void>;
  schedulePushRefresh: (action: PublicationAction) => void;
  onChanged: () => void | Promise<void>;
};

function PublicationSection(props: PublicationSectionProps) {
  const {
    cardId, integrationPending, verifiedHeadSha, recoveryContent,
    publication, loading, pushTerminals, pushTerminalsLoading,
    loadPublication, loadPushTerminals, schedulePushRefresh, onChanged,
  } = props;
  const [action, setAction] = useState<PublicationAction | null>(null);
  const [advancedGitOpen, setAdvancedGitOpen] = useState(false);
  const [mergeMethod, setMergeMethod] = useState<MergeMethod>("squash");
  const facts = sectionFacts(publication, pushTerminals);
  const render: Omit<PublicationRenderState, "openCommit"> = {
    publication, integrationPending, verifiedHeadSha, facts,
    pushTerminals, pushTerminalsLoading, loadPushTerminals,
    advancedGitOpen, setAdvancedGitOpen, mergeMethod, setMergeMethod,
    setAction, cardId, onChanged, reloadPublication: loadPublication,
  };

  return <>
    <CommitDiffReview cardId={cardId}>{ (openCommit) => (
      <GitChangesSection
        loading={loading}
        source={publication?.source ?? "No live BB workspace"}
        reload={loadPublication}
        unavailable={!publication && !loading}
        recoveryContent={recoveryContent}
      >
        <PublicationBody {...render} openCommit={openCommit} />
      </GitChangesSection>
    ) }</CommitDiffReview>
    <PublicationActions
      cardId={cardId}
      action={action}
      setAction={setAction}
      publicationDefaultBranch={facts.publicationDefaultBranch}
      publishesToDefaultBranch={facts.publishesToDefaultBranch}
      behind={facts.behind}
      mergeMethod={mergeMethod}
      loadPublication={loadPublication}
      loadPushTerminals={loadPushTerminals}
      schedulePushRefresh={schedulePushRefresh}
      onChanged={onChanged}
    />
  </>;
}

/**
 * The disclosure shell: the title, the hint naming the checkout, and the
 * refresh that re-reads it from the host.
 */
function GitChangesSection({
  loading,
  source,
  reload,
  unavailable,
  recoveryContent,
  children,
}: {
  loading: boolean;
  source: string;
  reload: () => Promise<void>;
  unavailable: boolean;
  recoveryContent?: ReactNode;
  children: ReactNode;
}) {
  return (
    <DisclosureSection
      title="Git changes"
      hint={loading ? "Checking BB workspace…" : source}
      defaultOpen
      action={
        <Button
          size="sm"
          variant="outline"
          disabled={loading}
          onClick={() => void reload()}
          title="Re-check the workspace and pull-request state in BB"
        >
          Refresh
        </Button>
      }
    >
      {unavailable ? (
        <p className="text-xs text-muted-foreground">Publication status is unavailable.</p>
      ) : null}
      {recoveryContent}
      {children}
    </DisclosureSection>
  );
}

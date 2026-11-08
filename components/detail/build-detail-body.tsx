import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { statusTone } from "../../lib/detail-presentation.mjs";
import { useDetailComment } from "../conversation/use-detail-comment";
import { GithubCompletionDialog } from "../github/github-completion-dialog";
import { GithubDoneDraftDialog } from "../github/github-done-draft-dialog";
import { CardDetailHeader } from "../manage/card-detail-header";
import { useDebouncedRealtime } from "../use-debounced-realtime";
import { ArtifactViewerDialog } from "./artifact-viewer-dialog";
import { BuildDetailContent } from "./build-detail-content";
import { BuildLifecycleDialogs } from "./build-lifecycle-dialogs";
import { useInboxEventFocus, type InboxEventItem } from "./inbox-event-banner";
import type {
  BuildCard,
  BuildDetail,
  BuildDetailBodyProps,
  BuildDetailView,
  ViewerFile,
} from "./build-detail-view";
import { useBuildDetailLifecycle } from "./use-build-detail-lifecycle";
import { useExecutionRuns } from "./use-execution-runs";

function useBuildDetailData(cardId: string, inboxEventId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const [card, setCard] = useState<BuildCard | null>(null);
  const [detail, setDetail] = useState<BuildDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inboxEvent, setInboxEvent] = useState<InboxEventItem | null>(null);
  const inboxEventRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await rpc.call("cardDetail", { cardId });
      const event = inboxEventId
        ? await rpc.call("getNotification", { notificationId: inboxEventId, cardId })
        : null;
      setDetail(result);
      setCard(result.card);
      setInboxEvent(event?.notification ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load card.");
    }
  }, [cardId, inboxEventId, rpc]);

  useEffect(() => { void load(); }, [load]);
  useDebouncedRealtime(["card-state", "inbox-changed"], () => void load());
  useEffect(() => {
    if (card?.status !== "completed") return;
    void rpc.call("markCardNotificationsRead", { cardId, kind: "completed" }).catch(() => {});
  }, [cardId, card?.status, rpc]);
  useInboxEventFocus(inboxEventId, inboxEvent, inboxEventRef);

  return { card, detail, error, inboxEvent, inboxEventRef, load };
}


function useBuildPresentationState(card: BuildCard | null) {
  const [githubPostOpen, setGithubPostOpen] = useState(false);
  const [githubDraftOpen, setGithubDraftOpen] = useState(false);
  const [publicationDirty, setPublicationDirty] = useState(false);
  const [publicationBranch, setPublicationBranch] = useState<string | null>(null);
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [viewerFile, setViewerFile] = useState<ViewerFile>(null);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const artifactsRef = useRef<HTMLDivElement | null>(null);
  const showArtifacts = useCallback(() => {
    setArtifactsOpen(true);
    requestAnimationFrame(() => {
      artifactsRef.current?.scrollIntoView({ block: "nearest" });
    });
  }, []);

  useEffect(() => {
    if (card?.status === "completed") setArtifactsOpen(true);
  }, [card?.status]);

  return {
    githubPostOpen,
    setGithubPostOpen,
    githubDraftOpen,
    setGithubDraftOpen,
    publicationDirty,
    setPublicationDirty,
    publicationBranch,
    setPublicationBranch,
    presetDialogOpen,
    setPresetDialogOpen,
    viewerFile,
    setViewerFile,
    artifactsOpen,
    setArtifactsOpen,
    mapOpen,
    setMapOpen,
    artifactsRef,
    showArtifacts,
  };
}

function useBuildInteractions(
  props: BuildDetailBodyProps,
  card: BuildCard | null,
  load: () => Promise<void>,
) {
  const { cardId, onClose, onOpenRecoveryAudit, intentLabels } = props;
  const lifecycle = useBuildDetailLifecycle({
    cardId,
    card,
    intentLabels,
    onChanged: load,
    onClose,
    onOpenRecoveryAudit,
  });
  const comments = useDetailComment({ cardId, onChanged: load });
  const presentation = useBuildPresentationState(card);

  useEffect(() => { void lifecycle.loadWorkspaceRecovery(); }, [lifecycle.loadWorkspaceRecovery]);

  return {
    lifecycle,
    comments,
    ...presentation,
    onOpenRecoveryAudit,
    intentLabels,
  };
}

export function BuildDetailBody(props: BuildDetailBodyProps) {
  const { cardId, inboxEventId, renderPresetDialog } = props;
  const data = useBuildDetailData(cardId, inboxEventId);
  const interactions = useBuildInteractions(props, data.card, data.load);
  const execution = useExecutionRuns(cardId, props.executionRunId);
  const view: BuildDetailView = {
    ...data,
    ...interactions,
    execution,
    focusRunId: props.executionRunId,
    renderPresetDialog,
  };
  return <BuildDetailLayout {...props} view={view} />;
}

function BuildDetailLayout({
  cardId,
  inboxEventId,
  onBack,
  intentLabels,
  view,
}: BuildDetailBodyProps & { view: BuildDetailView }) {
  const { card, detail, lifecycle, load } = view;
  return (
    <div className="flex h-full flex-col">
      <CardDetailHeader
        card={card}
        onBack={onBack}
        onRestartFresh={() => lifecycle.setRepairOpen(true)}
        onArchive={() => lifecycle.setArchiveOpen(true)}
        onDiscard={() => void lifecycle.openDiscard()}
        onDelete={() => lifecycle.setDeleteOpen(true)}
        onRestore={() => lifecycle.setRestoreOpen(true)}
        onReclassify={lifecycle.doRepair}
        statusTone={statusTone}
        intentLabel={(intent) => intentLabels[intent]}
      />
      <BuildDetailContent cardId={cardId} inboxEventId={inboxEventId} view={view} />
      <PresetDialogs cardId={cardId} view={view} />
      <GithubCompletionDialog
        open={view.githubPostOpen}
        onOpenChange={view.setGithubPostOpen}
        cardId={cardId}
        issueLabel={detail?.githubLink
          ? `${detail.githubLink.repo}#${detail.githubLink.number}`
          : null}
        onPosted={load}
      />
      <GithubDoneDraftDialog
        open={view.githubDraftOpen}
        onOpenChange={view.setGithubDraftOpen}
        cardId={cardId}
        artifacts={detail?.artifacts ?? []}
        issueRef={detail?.githubLink ? { repo: detail.githubLink.repo, number: detail.githubLink.number } : null}
      />
      <BuildLifecycleDialogs
        state={lifecycle}
        cardDisplayName={card?.displayName ?? null}
        cardStage={card?.stage ?? null}
        cardLastError={card?.lastError ?? null}
      />
    </div>
  );
}

function PresetDialogs({ cardId, view }: { cardId: string; view: BuildDetailView }) {
  const { load } = view;
  const ownsPresetDialog = view.card?.kind === "build";
  return (
    <>
      {ownsPresetDialog ? view.renderPresetDialog({
        open: view.presetDialogOpen,
        onOpenChange: view.setPresetDialogOpen,
        onChanged: () => void load(),
      }) : null}
      <ArtifactViewerDialog
        open={view.viewerFile !== null}
        onOpenChange={(next) => { if (!next) view.setViewerFile(null); }}
        cardId={cardId}
        file={view.viewerFile}
        editorTarget={view.viewerFile?.target ?? null}
        mode={view.viewerFile?.mode}
        optionLabel={view.viewerFile?.optionLabel}
        onCommented={() => void load()}
      />
    </>
  );
}

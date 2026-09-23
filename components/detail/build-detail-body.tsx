import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../../server";
import { statusTone } from "../../lib/detail-presentation.mjs";
import {
  STAGE_PRODUCES,
  STAGE_SEQUENCE,
  stageLabel,
} from "../../lib/workflow-vocabulary.mjs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { HostFileTarget, WorkspaceFileTarget } from "../artifacts/artifact-inventory";
import { useDetailComment } from "../conversation/use-detail-comment";
import type { ArtifactViewerMode } from "../conversation/question-batch";
import { GithubCompletionDialog } from "../github/github-completion-dialog";
import { CardDetailHeader } from "../manage/card-detail-header";
import { useDebouncedRealtime } from "../use-debounced-realtime";
import { ArtifactViewerDialog } from "./artifact-viewer-dialog";
import { BuildDetailContent } from "./build-detail-content";
import { BuildLifecycleDialogs } from "./build-lifecycle-dialogs";
import { useInboxEventFocus, type InboxEventItem } from "./inbox-event-banner";
import type { PresetDialogRenderer } from "./research-detail-body";
import { useBuildDetailLifecycle } from "./use-build-detail-lifecycle";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type RpcResult = Awaited<ReturnType<Rpc["call"]>>;
type BuildCard = Extract<RpcResult, { cards: unknown }>["cards"][number];
type BuildDetail = Extract<
  RpcResult,
  { card: unknown; comments: unknown; pendingQuestions: unknown }
>;
type ViewerFile = {
  display: string;
  path: string;
  target: WorkspaceFileTarget | HostFileTarget | null;
  mode?: ArtifactViewerMode;
} | null;

type BuildDetailBodyProps = {
  cardId: string;
  inboxEventId: string | null;
  onClose: () => void;
  onBack?: () => void;
  intentLabels: Record<string, string>;
  onOpenRecoveryAudit: (cardId: string) => void;
  renderPresetDialog: PresetDialogRenderer;
};

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

function useAdvanceCard(cardId: string, load: () => Promise<void>) {
  const rpc = useRpc<typeof rpcContract>();
  const [advancing, setAdvancing] = useState<string | null>(null);
  const [pendingAdvance, setPendingAdvance] = useState<string | null>(null);

  async function advance(stage: string) {
    setAdvancing(stage);
    try {
      const result = await rpc.call("advanceCard", { cardId, stage });
      if (!result.ok) toast.error(result.error ?? "Advance failed");
      else toast.success(`Advanced to ${stage}`);
      await load();
    } finally {
      setAdvancing(null);
    }
  }

  return { advancing, pendingAdvance, setPendingAdvance, advance };
}

function useBuildPresentationState(card: BuildCard | null) {
  const [githubPostOpen, setGithubPostOpen] = useState(false);
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

export type BuildDetailView = ReturnType<typeof useBuildDetailData> &
  ReturnType<typeof useBuildInteractions> &
  ReturnType<typeof useAdvanceCard> &
  Pick<BuildDetailBodyProps, "renderPresetDialog">;

export function BuildDetailBody(props: BuildDetailBodyProps) {
  const { cardId, inboxEventId, renderPresetDialog } = props;
  const data = useBuildDetailData(cardId, inboxEventId);
  const interactions = useBuildInteractions(props, data.card, data.load);
  const advance = useAdvanceCard(cardId, data.load);
  const view: BuildDetailView = {
    ...data,
    ...interactions,
    ...advance,
    renderPresetDialog,
  };
  return <BuildDetailLayout {...props} view={view} />;
}

type AdvanceDialogProps = {
  card: BuildCard | null;
  pendingAdvance: string | null;
  advancing: string | null;
  onOpenChange: (open: boolean) => void;
  onAdvance: (stage: string) => Promise<void>;
};

function AdvanceDialog({
  card,
  pendingAdvance,
  advancing,
  onOpenChange,
  onAdvance,
}: AdvanceDialogProps) {
  const forward = Boolean(
    pendingAdvance &&
    card &&
    STAGE_SEQUENCE.indexOf(pendingAdvance) > STAGE_SEQUENCE.indexOf(card.stage),
  );
  const confirm = () => {
    if (!pendingAdvance) return;
    onOpenChange(false);
    void onAdvance(pendingAdvance);
  };
  return (
    <Dialog
      open={pendingAdvance !== null}
      onOpenChange={(open) => { if (!open) onOpenChange(false); }}
    >
      <DialogContent>
        <AdvanceDialogCopy card={card} pendingAdvance={pendingAdvance} forward={forward} />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={advancing !== null}>
              Cancel
            </Button>
          </DialogClose>
          <Button disabled={advancing !== null || !pendingAdvance} onClick={confirm}>
            {advancing ? "Applying…" : forward ? "Advance" : "Return"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdvanceDialogCopy({
  card,
  pendingAdvance,
  forward,
}: {
  card: BuildCard | null;
  pendingAdvance: string | null;
  forward: boolean;
}) {
  const targetLabel = pendingAdvance ? stageLabel(pendingAdvance) : "";
  return (
    <DialogHeader>
      <DialogTitle>
        {forward ? "Advance to" : "Return to"} {targetLabel}?
      </DialogTitle>
      <DialogDescription className="space-y-2">
        <p>
          Move this card from <strong>{stageLabel(card?.stage ?? "")}</strong> to{" "}
          <strong>{targetLabel}</strong>.
        </p>
        <p className="rounded-md bg-muted p-2 text-xs">
          {pendingAdvance
            ? STAGE_PRODUCES[pendingAdvance] ??
              "The agent works on this stage and advances on its own once done."
            : ""}
        </p>
        <p className="text-xs text-muted-foreground">
          {forward
            ? "This is a manual override. The agent usually advances on its own. Stage gates (product, interface, plan, diff) still apply on the next advance."
            : "Going back is safe and reversible. The workflow will re-run earlier stages as needed."}
        </p>
      </DialogDescription>
    </DialogHeader>
  );
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
      <BuildLifecycleDialogs
        state={lifecycle}
        cardDisplayName={card?.displayName ?? null}
      />
    </div>
  );
}

function PresetDialogs({ cardId, view }: { cardId: string; view: BuildDetailView }) {
  const { load } = view;
  return (
    <>
      {view.renderPresetDialog({
        open: view.presetDialogOpen,
        onOpenChange: view.setPresetDialogOpen,
        onChanged: () => void load(),
      })}
      <ArtifactViewerDialog
        open={view.viewerFile !== null}
        onOpenChange={(next) => { if (!next) view.setViewerFile(null); }}
        cardId={cardId}
        file={view.viewerFile}
        editorTarget={view.viewerFile?.target ?? null}
        mode={view.viewerFile?.mode}
        onCommented={() => void load()}
      />
      <AdvanceDialog
        card={view.card}
        pendingAdvance={view.pendingAdvance}
        advancing={view.advancing}
        onOpenChange={(open) => { if (!open) view.setPendingAdvance(null); }}
        onAdvance={view.advance}
      />
    </>
  );
}

import { liveBorderClass } from "../../lib/detail-presentation.mjs";
import { ConfirmActionDialog } from "../manage/confirm-action-dialog";
import { PresetAssignDialog } from "../settings/preset-assign-dialog";
import { ArtifactViewerDialog } from "./artifact-viewer-dialog";
import { ExploreDetailContent } from "./explore-detail-content";
import { LinkedDiscussionSection } from "../github/github-linked-discussion";
import type { ExploreCard, ExploreDetail } from "./explore-detail-types";
import type { InboxEventItem } from "./inbox-event-banner";
import { useInboxEventFocus } from "./inbox-event-banner";
import { useExploreDetailState } from "./use-explore-detail-state";

const RESTART_DESCRIPTION =
  "Stops the running worker and starts a fresh one on this card's preset, " +
  "continuing the exploration (not from scratch). Use this to apply a preset change.";

type ExploreDetailBodyProps = {
  cardId: string;
  inboxEventId: string | null;
  inboxEvent: InboxEventItem | null;
  card: ExploreCard;
  detail: ExploreDetail | null;
  onChanged: () => void;
};

export function ExploreDetailBody({ cardId, inboxEventId, inboxEvent, card, detail, onChanged }: ExploreDetailBodyProps) {
  const state = useExploreDetailState(cardId, card.status, onChanged);
  useInboxEventFocus(inboxEventId, inboxEvent, state.inboxEventRef);
  const stageLabel = card.exploreStage
    ? state.stages.find((entry) => entry.id === card.exploreStage)?.label ?? card.exploreStage
    : null;

  return (
    <div className={`stelow-live-surface stelow-detail-surface flex h-full flex-col ${liveBorderClass(card)}`}>
      <div className="flex-1 overflow-auto p-4">
        <div className="mx-auto w-full max-w-3xl space-y-6">
          <ExploreDetailContent
            inboxEventId={inboxEventId}
            inboxEvent={inboxEvent}
            card={card}
            detail={detail}
            stageLabel={stageLabel}
            state={state}
            onChanged={onChanged}
          />
          <LinkedDiscussionSection cardId={cardId} />
        </div>
      </div>
      <ConfirmActionDialog
        open={state.restartWorkerOpen}
        onOpenChange={state.setRestartWorkerOpen}
        title="Restart the worker on the current preset?"
        description={RESTART_DESCRIPTION}
        confirmLabel="Restart worker"
        confirmTone="default"
        onConfirm={state.restartWorker}
      />
      <PresetAssignDialog
        cardId={cardId}
        open={state.presetDialogOpen}
        onOpenChange={state.setPresetDialogOpen}
        onChanged={onChanged}
      />
      <ArtifactViewerDialog
        open={state.viewerFile !== null}
        onOpenChange={(next) => { if (!next) state.setViewerFile(null); }}
        cardId={cardId}
        file={state.viewerFile}
        editorTarget={state.viewerFile?.target ?? null}
        mode={state.viewerFile?.mode}
        onCommented={onChanged}
      />
    </div>
  );
}

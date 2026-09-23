import type { ReactNode } from "react";
import { ConfirmActionDialog } from "../manage/confirm-action-dialog";
import { FanOutDialog, StrategyRunDialog } from "./research-detail-dialogs";
import { ArtifactViewerDialog } from "./artifact-viewer-dialog";
import type { InboxEventItem } from "./inbox-event-banner";
import { liveBorderClass } from "../../lib/detail-presentation.mjs";
import { useInboxEventFocus } from "./inbox-event-banner";
import { ResearchDetailContent } from "./research-detail-content";
import type { ResearchCard, ResearchDetail } from "./research-detail-types";
import { useResearchDetailState } from "./use-research-detail-state";

export type PresetDialogRenderer = (state: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) => ReactNode;

type ResearchDetailBodyProps = {
  cardId: string;
  inboxEventId: string | null;
  inboxEvent: InboxEventItem | null;
  card: ResearchCard;
  detail: ResearchDetail | null;
  onChanged: () => void;
  renderPresetDialog: PresetDialogRenderer;
};

type ResearchDialogsProps = {
  cardId: string;
  state: ReturnType<typeof useResearchDetailState>;
  onChanged: () => void;
  runIds: string[];
  renderPresetDialog: PresetDialogRenderer;
};

function ResearchDialogs({ cardId, state, onChanged, runIds, renderPresetDialog }: ResearchDialogsProps) {
  const {
    index, strategies, restartWorker, restartWorkerOpen, setRestartWorkerOpen,
    presetDialogOpen, setPresetDialogOpen, viewerFile, setViewerFile, fanOutOpen,
    setFanOutOpen, strategyRunOpen, setStrategyRunOpen,
  } = state;
  return (
    <>
      <ConfirmActionDialog open={restartWorkerOpen} onOpenChange={setRestartWorkerOpen} title="Restart the worker on the current preset?" description="Stops the running worker and starts a fresh one on this card's preset, continuing the research (not from scratch). Use this to apply a preset change." confirmLabel="Restart worker" confirmTone="default" onConfirm={restartWorker} />
      {renderPresetDialog({ open: presetDialogOpen, onOpenChange: setPresetDialogOpen, onChanged: state.onQuestionsChanged })}
      <ArtifactViewerDialog open={viewerFile !== null} onOpenChange={(next) => { if (!next) setViewerFile(null); }} cardId={cardId} file={viewerFile} editorTarget={viewerFile?.target ?? null} mode={viewerFile?.mode} onCommented={onChanged} />
      <FanOutDialog open={fanOutOpen} onOpenChange={setFanOutOpen} cardId={cardId} opportunities={index?.opportunities ?? []} onFanned={() => { onChanged(); state.refreshIndex(); }} />
      <StrategyRunDialog open={strategyRunOpen} onOpenChange={setStrategyRunOpen} cardId={cardId} strategies={strategies} runIds={runIds} onStarted={() => { onChanged(); state.refreshIndex(); }} />
    </>
  );
}

export function ResearchDetailBody({ cardId, inboxEventId, inboxEvent, card, detail, onChanged, renderPresetDialog }: ResearchDetailBodyProps) {
  const state = useResearchDetailState(cardId, card.status, onChanged);
  useInboxEventFocus(inboxEventId, inboxEvent, state.inboxEventRef);
  return (
    <div className={`stelow-live-surface stelow-detail-surface flex h-full flex-col ${liveBorderClass(card)}`}>
      <div className="flex-1 overflow-auto p-4">
        <div className="mx-auto w-full max-w-3xl space-y-6">
          <ResearchDetailContent
            cardId={cardId}
            inboxEventId={inboxEventId}
            inboxEvent={inboxEvent}
            card={card}
            detail={detail}
            index={state.index}
            strategies={state.strategies}
            comment={state.comment}
            setComment={state.setComment}
            submitComment={state.submitComment}
            actions={state.actions}
            onOpenRestart={() => state.setRestartWorkerOpen(true)}
            onOpenPreset={() => state.setPresetDialogOpen(true)}
            onOpenFanOut={() => state.setFanOutOpen(true)}
            onOpenStrategyRun={() => state.setStrategyRunOpen(true)}
            onQuestionsChanged={state.onQuestionsChanged}
            setViewerFile={state.setViewerFile}
            inboxEventRef={state.inboxEventRef}
          />
        </div>
      </div>
      <ResearchDialogs cardId={cardId} state={state} onChanged={onChanged} runIds={card.researchStrategies ?? []} renderPresetDialog={renderPresetDialog} />
    </div>
  );
}

import { useState } from "react";
import { useBbContext, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { rememberStelowReturnFocusCardId } from "../panel/stelow-focus.mjs";
import { cardSubPath, STELOW_PANEL_ID } from "../panel/stelow-route.mjs";
import { useBucketGallery } from "../board/card-gallery";
import { TrackSkeleton } from "../panel/track-skeleton";
import {
  moveResearchCard,
  useResearchPanelState,
  type ResearchCard,
} from "./research-panel-state";
import {
  ResearchPanelDialogs,
  type ResearchOnboardingProps,
  type ResearchPresetManagerProps,
} from "./research-panel-dialogs";
import { ResearchPanelView } from "./research-panel-view";

function openResearchCard(navigate: ReturnType<typeof useBbNavigate>) {
  return (card: Pick<ResearchCard, "kind">, cardId: string) => {
    rememberStelowReturnFocusCardId(cardId);
    navigate.toPluginPanel(STELOW_PANEL_ID, { subPath: cardSubPath(card, cardId) });
  };
}

type ResearchPanelProps = {
  active: boolean;
  renderOnboarding: (props: ResearchOnboardingProps) => React.ReactNode;
  renderPresetManager: (props: ResearchPresetManagerProps) => React.ReactNode;
};

type DialogControllerProps = {
  active: boolean;
  projectId: string | null;
  state: ReturnType<typeof useResearchPanelState>;
  rpc: ReturnType<typeof useRpc<typeof rpcContract>>;
  renderOnboarding: ResearchPanelProps["renderOnboarding"];
  renderPresetManager: ResearchPanelProps["renderPresetManager"];
  onOpenCard: ReturnType<typeof openResearchCard>;
};

function useResearchDialogController(props: DialogControllerProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const bucketGallery = useBucketGallery(
    props.state.grouped.inbox ?? [],
    (card) => props.onOpenCard(card, card.id),
  );
  const dialogs = (
    <ResearchPanelDialogs
      active={props.active}
      projectId={props.projectId}
      data={props.state.data}
      preset={props.state.preset}
      rpc={props.rpc}
      createOpen={createOpen}
      presetsOpen={presetsOpen}
      onCreateOpenChange={setCreateOpen}
      onPresetsOpenChange={setPresetsOpen}
      onOpenPresets={() => setPresetsOpen(true)}
      bucketGallery={bucketGallery}
      onChanged={props.state.load}
      renderOnboarding={props.renderOnboarding}
      renderPresetManager={props.renderPresetManager}
    />
  );
  return {
    dialogs,
    openCreate: () => setCreateOpen(true),
    openPresets: () => setPresetsOpen(true),
  };
}

export function ResearchPanel({
  active,
  renderOnboarding,
  renderPresetManager,
}: ResearchPanelProps) {
  const { projectId } = useBbContext();
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const state = useResearchPanelState(rpc, projectId);
  const openCard = openResearchCard(navigate);
  const controller = useResearchDialogController({
    active,
    projectId,
    state,
    rpc,
    renderOnboarding,
    renderPresetManager,
    onOpenCard: openCard,
  });
  return (
    <div className="flex h-full overflow-hidden bg-background">
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto max-w-[1500px] space-y-4">
          {state.isInitialLoad ? <TrackSkeleton columns={4} /> : (
            <ResearchPanelView
              state={state}
              dialogs={controller.dialogs}
              onNewResearch={controller.openCreate}
              onOpenPresets={controller.openPresets}
              onOpenCard={openCard}
              onOpenThread={(threadId) => navigate.toThread(threadId)}
              onMoveCard={(cardId, target) => void moveResearchCard(rpc, cardId, target)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

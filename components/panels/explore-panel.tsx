import { useState } from "react";
import { useBbContext, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { rememberStelowReturnFocusCardId } from "../panel/stelow-focus.mjs";
import { cardSubPath, STELOW_PANEL_ID } from "../panel/stelow-route.mjs";
import { useBucketGallery } from "../board/card-gallery";
import { TrackSkeleton } from "../panel/track-skeleton";
import {
  moveExploreCard,
  useExplorePanelState,
  type ExploreCard,
} from "./explore-panel-state";
import {
  ExplorePanelDialogs,
  type ExploreOnboardingProps,
  type ExplorePresetManagerProps,
} from "./explore-panel-dialogs";
import { ExplorePanelView } from "./explore-panel-view";

function openExploreCard(navigate: ReturnType<typeof useBbNavigate>) {
  return (card: Pick<ExploreCard, "kind">, cardId: string) => {
    rememberStelowReturnFocusCardId(cardId);
    navigate.toPluginPanel(STELOW_PANEL_ID, { subPath: cardSubPath(card, cardId) });
  };
}

type ExplorePanelProps = {
  active: boolean;
  renderOnboarding: (props: ExploreOnboardingProps) => React.ReactNode;
  renderPresetManager: (props: ExplorePresetManagerProps) => React.ReactNode;
};

type DialogControllerProps = {
  active: boolean;
  projectId: string | null;
  state: ReturnType<typeof useExplorePanelState>;
  rpc: ReturnType<typeof useRpc<typeof rpcContract>>;
  renderOnboarding: ExplorePanelProps["renderOnboarding"];
  renderPresetManager: ExplorePanelProps["renderPresetManager"];
  onOpenCard: ReturnType<typeof openExploreCard>;
};

function useExploreDialogController(props: DialogControllerProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const bucketGallery = useBucketGallery(
    props.state.grouped.inbox ?? [],
    (card) => props.onOpenCard(card, card.id),
  );
  const dialogs = (
    <ExplorePanelDialogs
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

export function ExplorePanel({
  active,
  renderOnboarding,
  renderPresetManager,
}: ExplorePanelProps) {
  const { projectId } = useBbContext();
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const state = useExplorePanelState(rpc, projectId);
  const openCard = openExploreCard(navigate);
  const controller = useExploreDialogController({
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
            <ExplorePanelView
              state={state}
              dialogs={controller.dialogs}
              onNewExplore={controller.openCreate}
              onOpenPresets={controller.openPresets}
              onOpenCard={openCard}
              onOpenThread={(threadId) => navigate.toThread(threadId)}
              onMoveCard={(cardId, target) => void moveExploreCard(rpc, cardId, target)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

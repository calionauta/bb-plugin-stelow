import { useState } from "react";
import { useBbContext, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { rememberStelowReturnFocusCardId } from "../panel/stelow-focus.mjs";
import { cardSubPath, STELOW_PANEL_ID } from "../panel/stelow-route.mjs";
import { useBucketGallery } from "../board/card-gallery";
import { TrackSkeleton } from "../panel/track-skeleton";
import {
  analysisPreset,
  moveBuildCard,
  useBuildPanelState,
  type BuildCard,
} from "./build-panel-state";
import type { BuildPanelState } from "./build-panel-types";
import { BuildPanelDialogs, type OnboardingProps, type PresetManagerProps } from "./build-panel-dialogs";
import { BuildPanelView } from "./build-panel-view";

function buildViewState(state: ReturnType<typeof useBuildPanelState>, rpc: ReturnType<typeof useRpc<typeof rpcContract>>): BuildPanelState {
  return {
    rpc,
    projects: state.data.projects,
    cards: state.data.cards,
    loading: state.loading,
    grouped: state.grouped,
    projectIds: state.projectIds,
    stages: state.stages,
    intents: state.intents,
    statuses: state.statuses,
    activities: state.activities,
    attention: state.attention,
    stageOptions: state.stageOptions,
    viewMode: state.viewMode,
    setViewMode: state.setViewMode,
    collapsedColumns: state.collapsedColumns,
    collapsedListGroups: state.collapsedListGroups,
    githubAuthMissing: state.data.githubStatus?.pluginAvailable === true
      && state.data.githubStatus.ghOk === false,
    githubAutomationEnabled: state.data.githubAutomationEnabled,
    toggleProject: state.toggleProject,
    toggleStage: state.toggleStage,
    toggleIntent: state.toggleIntent,
    toggleStatus: state.toggleStatus,
    toggleActivity: state.toggleActivity,
    toggleColumn: state.toggleColumn,
    toggleListGroup: state.toggleListGroup,
    reset: state.reset,
    setAttention: state.setAttention,
  };
}

type DialogsProps = {
  active: boolean;
  state: ReturnType<typeof useBuildPanelState>;
  rpc: ReturnType<typeof useRpc<typeof rpcContract>>;
  projectId: string | null;
  createOpen: boolean;
  githubOpen: boolean;
  presetsOpen: boolean;
  setCreateOpen: (open: boolean) => void;
  setGithubOpen: (open: boolean) => void;
  setPresetsOpen: (open: boolean) => void;
  bucketGallery: ReturnType<typeof useBucketGallery>;
  renderOnboarding: (props: OnboardingProps) => React.ReactNode;
  renderPresetManager: (props: PresetManagerProps) => React.ReactNode;
};

function BuildDialogs(props: DialogsProps) {
  const activeProject = props.state.data.projects.find(
    (project) => project.id === props.projectId,
  ) ?? null;
  return (
    <BuildPanelDialogs
      active={props.active}
      createOpen={props.createOpen}
      githubOpen={props.githubOpen}
      presetsOpen={props.presetsOpen}
      onCreateOpenChange={props.setCreateOpen}
      onGithubOpenChange={props.setGithubOpen}
      onPresetsOpenChange={props.setPresetsOpen}
      onOpenPresets={() => props.setPresetsOpen(true)}
      activeProject={activeProject}
      projectId={props.projectId}
      data={props.state.data}
      analysisWorkerPreset={analysisPreset(props.state.data)}
      appetite={props.state.appetite}
      reviewGates={props.state.reviewGates}
      onAppetiteChange={props.state.setAppetite}
      onReviewGatesChange={props.state.setReviewGates}
      bucketGallery={props.bucketGallery}
      rpc={props.rpc}
      onChanged={async () => { await props.state.load(); }}
      renderOnboarding={props.renderOnboarding}
      renderPresetManager={props.renderPresetManager}
    />
  );
}

function openBuildCard(navigate: ReturnType<typeof useBbNavigate>) {
  return (card: Pick<BuildCard, "kind">, cardId: string) => {
    rememberStelowReturnFocusCardId(cardId);
    navigate.toPluginPanel(STELOW_PANEL_ID, { subPath: cardSubPath(card, cardId) });
  };
}

type DialogControllerProps = {
  active: boolean;
  state: ReturnType<typeof useBuildPanelState>;
  rpc: ReturnType<typeof useRpc<typeof rpcContract>>;
  projectId: string | null;
  renderOnboarding: DialogsProps["renderOnboarding"];
  renderPresetManager: DialogsProps["renderPresetManager"];
  onOpenCard: ReturnType<typeof openBuildCard>;
};

function useBuildDialogController(props: DialogControllerProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const bucketGallery = useBucketGallery(
    props.state.grouped.inbox ?? [],
    (card) => props.onOpenCard(card, card.id),
  );
  const dialogs = (
    <BuildDialogs
      active={props.active}
      state={props.state}
      rpc={props.rpc}
      projectId={props.projectId}
      createOpen={createOpen}
      githubOpen={githubOpen}
      presetsOpen={presetsOpen}
      setCreateOpen={setCreateOpen}
      setGithubOpen={setGithubOpen}
      setPresetsOpen={setPresetsOpen}
      bucketGallery={bucketGallery}
      renderOnboarding={props.renderOnboarding}
      renderPresetManager={props.renderPresetManager}
    />
  );
  return {
    dialogs,
    openCreate: () => setCreateOpen(true),
    openGithub: () => setGithubOpen(true),
    openPresets: () => setPresetsOpen(true),
  };
}

type BuildPanelProps = {
  active: boolean;
  renderOnboarding: (props: OnboardingProps) => React.ReactNode;
  renderPresetManager: (props: PresetManagerProps) => React.ReactNode;
};

export function BuildPanel({
  active,
  renderOnboarding,
  renderPresetManager,
}: BuildPanelProps) {
  const { projectId } = useBbContext();
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const state = useBuildPanelState(rpc, projectId);
  const openCard = openBuildCard(navigate);
  const dialogs = useBuildDialogController({
    active,
    state,
    rpc,
    projectId,
    renderOnboarding,
    renderPresetManager,
    onOpenCard: openCard,
  });
  const viewState = buildViewState(state, rpc);
  return (
    <div className="flex h-full overflow-hidden bg-background">
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto max-w-[1500px] space-y-4">
          {state.isInitialLoad ? <TrackSkeleton /> : (
            <BuildPanelView
              state={viewState}
              dialogs={dialogs.dialogs}
              onNewIssue={dialogs.openCreate}
              onOpenPresets={dialogs.openPresets}
              onOpenGithub={dialogs.openGithub}
              onOpenCard={openCard}
              onOpenThread={(threadId) => navigate.toThread(threadId)}
              onMoveCard={(cardId, target) => void moveBuildCard(rpc, cardId, target)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

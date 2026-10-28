import { useState } from "react";
import { useBbContext, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import type { BoardCardItem } from "../board/board-cards";
import { rememberStelowReturnFocusCardId } from "../panel/stelow-focus.mjs";
import { cardSubPath, STELOW_PANEL_ID } from "../panel/stelow-route.mjs";
import { useBucketGallery } from "../board/card-gallery";
import { TrackSkeleton } from "../panel/track-skeleton";
import {
  useTrackPanelState,
  type TrackPanelConfig,
} from "./track-panel-state";
import {
  TrackListForKind,
  TrackPanelView,
  renderTrackCardForKind,
  type TrackViewConfig,
} from "./track-panel-view";
import {
  TrackPanelDialogs,
  type TrackDialogsConfig,
} from "./track-panel-dialogs";

export function openTrackCard(navigate: ReturnType<typeof useBbNavigate>) {
  return (card: { kind?: "research" | "explore" | "build" }, cardId: string) => {
    rememberStelowReturnFocusCardId(cardId);
    // trackOfCard defaults an unknown kind to build; say so at the call.
    navigate.toPluginPanel(STELOW_PANEL_ID, { subPath: cardSubPath({ kind: card.kind ?? "build" }, cardId) });
  };
}

type PanelStateShape = {
  grouped: { inbox?: Array<{ id: string } & Record<string, unknown>> };
  load: () => Promise<void>;
  data: unknown;
  preset: unknown;
  isInitialLoad: boolean;
} & Record<string, unknown>;

type TrackPanelShellProps = {
  active: boolean;
  renderOnboarding: (props: never) => React.ReactNode;
  renderPresetManager: (props: never) => React.ReactNode;
  usePanelState: (rpc: ReturnType<typeof useRpc<typeof rpcContract>>, projectId: string | null) => PanelStateShape;
  PanelDialogs: React.ComponentType<Record<string, unknown>>;
  PanelView: React.ComponentType<Record<string, unknown>>;
  newViewProp: "onNewExplore" | "onNewResearch" | "onNewTrack";
};

export function useTrackDialogController(props: {
  active: boolean;
  projectId: string | null;
  state: PanelStateShape;
  rpc: ReturnType<typeof useRpc<typeof rpcContract>>;
  renderOnboarding: (props: never) => React.ReactNode;
  renderPresetManager: (props: never) => React.ReactNode;
  onOpenCard: ReturnType<typeof openTrackCard>;
  PanelDialogs: React.ComponentType<Record<string, unknown>>;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const bucketGallery = useBucketGallery(
    (props.state.grouped.inbox ?? []) as unknown as BoardCardItem[],
    (card) => props.onOpenCard(card, card.id),
  );
  const Dialogs = props.PanelDialogs;
  const dialogs = (
    <Dialogs
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

export function TrackPanel({
  active,
  renderOnboarding,
  renderPresetManager,
  usePanelState,
  PanelDialogs,
  PanelView,
  newViewProp,
}: TrackPanelShellProps) {
  const { projectId } = useBbContext();
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const state = usePanelState(rpc, projectId);
  const openCard = openTrackCard(navigate);
  const controller = useTrackDialogController({
    active,
    projectId,
    state,
    rpc,
    renderOnboarding,
    renderPresetManager,
    onOpenCard: openCard,
    PanelDialogs: PanelDialogs as React.ComponentType<Record<string, unknown>>,
  });
  const View = PanelView as React.ComponentType<Record<string, unknown>>;
  return (
    <div className="flex h-full overflow-hidden bg-background">
      <div className="flex-1 overflow-auto p-3 sm:p-4 md:p-6">
        <div className="mx-auto max-w-[1500px] space-y-4">
          {state.isInitialLoad ? <TrackSkeleton columns={4} /> : (
            <View
              state={state}
              dialogs={controller.dialogs}
              {...{ [newViewProp]: controller.openCreate }}
              onOpenPresets={controller.openPresets}
              onOpenCard={openCard}
              onOpenThread={(threadId: string) => navigate.toThread(threadId)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// Config-driven track panel: explore and research are configs plus the
// shared kind-driven List/Card renderers — no parallel shell files.
function TrackDialogsForKind(props: {
  active: boolean;
  projectId: string | null;
  state: ReturnType<typeof useTrackPanelState>;
  rpc: ReturnType<typeof useRpc<typeof rpcContract>>;
  createOpen: boolean;
  presetsOpen: boolean;
  setCreateOpen: (open: boolean) => void;
  setPresetsOpen: (open: boolean) => void;
  bucketGallery: ReturnType<typeof useBucketGallery>;
  renderOnboarding: (props: any) => React.ReactNode;
  renderPresetManager: (props: any) => React.ReactNode;
  dialogsConfig: TrackDialogsConfig;
}) {
  const {
    active,
    projectId,
    state,
    rpc,
    createOpen,
    presetsOpen,
    setCreateOpen,
    setPresetsOpen,
    bucketGallery,
    renderOnboarding,
    renderPresetManager,
    dialogsConfig,
  } = props;
  return (
    <TrackPanelDialogs
      active={active}
      projectId={projectId}
      data={state.data}
      preset={state.preset}
      rpc={rpc}
      createOpen={createOpen}
      presetsOpen={presetsOpen}
      onCreateOpenChange={setCreateOpen}
      onPresetsOpenChange={setPresetsOpen}
      onOpenPresets={() => setPresetsOpen(true)}
      bucketGallery={bucketGallery}
      onChanged={state.load}
      renderOnboarding={renderOnboarding}
      renderPresetManager={renderPresetManager}
      config={dialogsConfig}
    />
  );
}

function TrackViewForKind({ state, dialogs, openCreate, openPresets, openCard, navigate, viewConfig }: {
  state: ReturnType<typeof useTrackPanelState>;
  dialogs: React.ReactNode;
  openCreate: () => void;
  openPresets: () => void;
  openCard: ReturnType<typeof openTrackCard>;
  navigate: ReturnType<typeof useBbNavigate>;
  viewConfig: TrackViewConfig;
}) {
  const kind = viewConfig.kind;
  return (
    <TrackPanelView
      state={state}
      dialogs={dialogs}
      onNewTrack={openCreate}
      onOpenPresets={openPresets}
      onOpenCard={openCard}
      onOpenThread={(threadId: string) => navigate.toThread(threadId)}
      config={viewConfig}
      List={({ groups, collapsed, onToggle, onOpenCard: open, onOpenThread: openThread, labelById }) => (
        <TrackListForKind
          kind={kind}
          groups={groups}
          collapsed={collapsed}
          onToggle={onToggle}
          onOpenCard={open}
          onOpenThread={openThread}
          labelById={labelById}
        />
      )}
      renderCard={(card, labelById, open) => renderTrackCardForKind(kind, card, labelById, open)}
    />
  );
}

function TrackPanelShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full overflow-hidden bg-background">
      <div className="flex-1 overflow-auto p-3 sm:p-4 md:p-6">
        <div className="mx-auto max-w-[1500px] space-y-4">
          {children}
        </div>
      </div>
    </div>
  );
}

function useTrackPanelForKindController(panelConfig: TrackPanelConfig) {
  const { projectId } = useBbContext();
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const state = useTrackPanelState(rpc, projectId, panelConfig);
  const openCard = openTrackCard(navigate);
  const [createOpen, setCreateOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const bucketGallery = useBucketGallery(
    (state.grouped.inbox ?? []) as unknown as BoardCardItem[],
    (card) => openCard(card, card.id),
  );
  return { projectId, navigate, rpc, state, openCard, createOpen, presetsOpen, setCreateOpen, setPresetsOpen, bucketGallery };
}

export function TrackPanelForKind({ active, renderOnboarding, renderPresetManager, panelConfig, viewConfig, dialogsConfig }: {
  active: boolean;
  renderOnboarding: (props: any) => React.ReactNode;
  renderPresetManager: (props: any) => React.ReactNode;
  panelConfig: TrackPanelConfig;
  viewConfig: TrackViewConfig;
  dialogsConfig: TrackDialogsConfig;
}) {
  const controller = useTrackPanelForKindController(panelConfig);
  const { projectId, navigate, rpc, state, openCard, createOpen, presetsOpen, setCreateOpen, setPresetsOpen, bucketGallery } = controller;
  const dialogs = (
    <TrackDialogsForKind
      active={active}
      projectId={projectId}
      state={state}
      rpc={rpc}
      createOpen={createOpen}
      presetsOpen={presetsOpen}
      setCreateOpen={setCreateOpen}
      setPresetsOpen={setPresetsOpen}
      bucketGallery={bucketGallery}
      renderOnboarding={renderOnboarding}
      renderPresetManager={renderPresetManager}
      dialogsConfig={dialogsConfig}
    />
  );
  return (
    <TrackPanelShell>
      {state.isInitialLoad ? <TrackSkeleton columns={4} /> : (
        <TrackViewForKind
          state={state}
          dialogs={dialogs}
          openCreate={() => setCreateOpen(true)}
          openPresets={() => setPresetsOpen(true)}
          openCard={openCard}
          navigate={navigate}
          viewConfig={viewConfig}
        />
      )}
    </TrackPanelShell>
  );
}

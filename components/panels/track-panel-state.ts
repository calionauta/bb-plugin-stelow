import { useCallback, useMemo, useState } from "react";
import type { useRpc } from "@get-bb/plugin-sdk/app";

import type { rpcContract } from "../../server";
import {
  useBoardView,
  useCollapsedGroups,
  usePanelData,
  usePersistentCollapsedGroups,
} from "../panel/panel-state-hooks";
import { LIGHTWEIGHT_COLUMNS } from "../../lib/tracks.mjs";
import { toggleFilterValue } from "../../lib/kanban-layout.mjs";
import {
  filterAndGroupTrackCards,
  trackCardListRequest,
  trackLabelsById,
  trackPresetFor,
} from "../../lib/track-panel-state.mjs";
import type { ResearchStrategyOption } from "../creation/creation-settings";

export type TrackRpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type RpcResult = Awaited<ReturnType<TrackRpc["call"]>>;
export type TrackCard = Extract<RpcResult, { cards: unknown }>["cards"][number];
export type TrackProject = Extract<RpcResult, { projects: unknown }>["projects"][number];
export type TrackPreset = Extract<RpcResult, { presets: unknown }>["presets"][number];
type TrackBand = Extract<RpcResult, { bands: unknown }>["bands"][number];

export type TrackPanelConfig = {
  kind: "explore" | "research";
  band: string;
  catalogRpc: "stageCatalog" | "researchStrategies";
  catalogKey: "stages" | "strategies";
  errorMessage: string;
  columnsKey: string;
  listGroupsKey: string;
  viewKey: string;
};

export const EXPLORE_PANEL_CONFIG: TrackPanelConfig = {
  kind: "explore",
  band: "explore",
  catalogRpc: "stageCatalog",
  catalogKey: "stages",
  errorMessage: "Unable to load explore.",
  columnsKey: "stelow-explore-columns-collapsed-v1",
  listGroupsKey: "stelow-explore-list-groups-collapsed-v1",
  viewKey: "stelow-explore-view-v1",
};

export const RESEARCH_PANEL_CONFIG: TrackPanelConfig = {
  kind: "research",
  band: "research",
  catalogRpc: "researchStrategies",
  catalogKey: "strategies",
  errorMessage: "Unable to load research.",
  columnsKey: "stelow-research-columns-collapsed-v1",
  listGroupsKey: "stelow-research-list-groups-collapsed-v1",
  viewKey: "stelow-research-view-v1",
};

export type TrackPanelData = {
  cards: TrackCard[];
  presets: TrackPreset[];
  projects: TrackProject[];
  bandPresets: TrackBand[];
  catalog: ResearchStrategyOption[];
};

const EMPTY_TRACK_DATA: TrackPanelData = {
  cards: [],
  presets: [],
  projects: [],
  bandPresets: [],
  catalog: [],
};

async function loadTrackData(
  rpc: TrackRpc,
  projectId: string | null,
  config: TrackPanelConfig,
): Promise<TrackPanelData> {
  const [projects, cards, catalog, presets, bands] = await Promise.all([
    rpc.call("projects", {}).catch(() => null),
    rpc.call("listCards", trackCardListRequest(config.kind, projectId)).catch(() => ({ cards: [] })),
    rpc.call(config.catalogRpc, {}).catch(() => ({ [config.catalogKey]: [] })),
    rpc.call("listPresets", {}).catch(() => ({ presets: [] })),
    rpc.call("listBandPresets", {}).catch(() => ({ bands: [] })),
  ]);
  return {
    cards: cards.cards,
    presets: presets.presets,
    projects: projects?.projects ?? [],
    bandPresets: bands.bands,
    catalog: (catalog as Record<string, ResearchStrategyOption[]>)[config.catalogKey] ?? [],
  };
}

export function useTrackPanelState(rpc: TrackRpc, projectId: string | null, config: TrackPanelConfig) {
  const loadData = useCallback(
    () => loadTrackData(rpc, projectId, config),
    [projectId, rpc, config],
  );
  const panel = usePanelData(loadData, {
    errorMessage: config.errorMessage,
    initialData: EMPTY_TRACK_DATA,
    itemCountKey: "cards",
    realtimeChannels: ["card-state", "board-changed", "inbox-changed"],
  });
  return useTrackPresentation(panel, config);
}

function useTrackFilters(cards: TrackCard[]) {
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [attention, setAttention] = useState(false);
  const grouped = useMemo(() => filterAndGroupTrackCards(cards, {
    columns: LIGHTWEIGHT_COLUMNS,
    projectIds,
    attention,
  }), [attention, cards, projectIds]);
  return {
    projectIds,
    attention,
    setAttention,
    grouped,
    toggleProject: (value: string) => setProjectIds(
      (current) => toggleFilterValue(current, value),
    ),
    reset: () => {
      setProjectIds([]);
      setAttention(false);
    },
  };
}

function useTrackLabels(data: TrackPanelData, config: TrackPanelConfig) {
  const labels = useMemo(() => trackLabelsById(data.catalog), [data.catalog]);
  const preset = useMemo(
    () => trackPresetFor(data.presets, data.bandPresets, config.band),
    [data.presets, data.bandPresets, config.band],
  );
  return { labels, preset };
}

export function useTrackPresentation(
  panel: ReturnType<typeof usePanelData<TrackPanelData>>,
  config: TrackPanelConfig,
) {
  const filters = useTrackFilters(panel.data.cards);
  const labelsAndPreset = useTrackLabels(panel.data, config);
  const [collapsedColumns, setCollapsedColumns] = usePersistentCollapsedGroups(
    config.columnsKey,
    false,
  );
  const [collapsedListGroups, setCollapsedListGroups] = useCollapsedGroups(
    config.listGroupsKey,
  );
  const [viewMode, setViewMode] = useBoardView(config.viewKey, config.kind);
  const toggleColumn = (column: string) => setCollapsedColumns((current) => ({
    ...current,
    [column]: !current[column],
  }));
  const toggleListGroup = (column: string) => setCollapsedListGroups((current) => ({
    ...current,
    [column]: !current[column],
  }));
  return {
    ...panel,
    ...filters,
    ...labelsAndPreset,
    attentionCount: panel.data.cards.filter(
      (card) => card.needsAttention && card.status !== "archived",
    ).length,
    viewMode,
    setViewMode,
    collapsedColumns,
    collapsedListGroups,
    toggleColumn,
    toggleListGroup,
  };
}

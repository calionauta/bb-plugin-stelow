import { useCallback, useMemo, useState } from "react";
import type { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../../server";
import {
  useBoardView,
  useCollapsedGroups,
  usePanelData,
  usePersistentCollapsedGroups,
} from "../panel/panel-state-hooks";
import { STORAGE_KEYS } from "../../lib/panel-storage.mjs";
import { LIGHTWEIGHT_COLUMNS } from "../../lib/tracks.mjs";
import { toggleFilterValue } from "../../lib/kanban-layout.mjs";
import {
  exploreCardListRequest,
  filterAndGroupExploreCards,
  moveExploreCard as moveExploreCardWithRpc,
  explorePresetFor,
  techniqueLabelsById,
} from "../../lib/explore-panel-state.mjs";
import type { ResearchStrategyOption } from "../creation/creation-settings";

export type ExploreRpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type RpcResult = Awaited<ReturnType<ExploreRpc["call"]>>;
export type ExploreCard = Extract<RpcResult, { cards: unknown }>["cards"][number];
export type ExploreProject = Extract<RpcResult, { projects: unknown }>["projects"][number];
export type ExplorePreset = Extract<RpcResult, { presets: unknown }>["presets"][number];
type ExploreBand = Extract<RpcResult, { bands: unknown }>["bands"][number];

export type ExplorePanelData = {
  cards: ExploreCard[];
  presets: ExplorePreset[];
  projects: ExploreProject[];
  exploreBandPresets: ExploreBand[];
  stages: ResearchStrategyOption[];
};

const EMPTY_DATA: ExplorePanelData = {
  cards: [],
  presets: [],
  projects: [],
  exploreBandPresets: [],
  stages: [],
};

async function loadExploreData(
  rpc: ExploreRpc,
  projectId: string | null,
): Promise<ExplorePanelData> {
  const [projects, cards, stages, presets, bands] = await Promise.all([
    rpc.call("projects", {}).catch(() => null),
    rpc.call("listCards", exploreCardListRequest(projectId)).catch(() => ({ cards: [] })),
    rpc.call("stageCatalog", {}).catch(() => ({ stages: [] })),
    rpc.call("listPresets", {}).catch(() => ({ presets: [] })),
    rpc.call("listBandPresets", {}).catch(() => ({ bands: [] })),
  ]);
  return {
    cards: cards.cards,
    presets: presets.presets,
    projects: projects?.projects ?? [],
    exploreBandPresets: bands.bands,
    stages: stages.stages,
  };
}

export function useExplorePanelState(rpc: ExploreRpc, projectId: string | null) {
  const loadData = useCallback(
    () => loadExploreData(rpc, projectId),
    [projectId, rpc],
  );
  const panel = usePanelData(loadData, {
    errorMessage: "Unable to load explore.",
    initialData: EMPTY_DATA,
    itemCountKey: "cards",
    realtimeChannels: ["card-state", "board-changed", "inbox-changed"],
  });
  return useExplorePresentation(panel);
}

function useExploreFilters(cards: ExploreCard[]) {
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [attention, setAttention] = useState(false);
  const grouped = useMemo(() => filterAndGroupExploreCards(cards, {
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

function useExploreLabels(data: ExplorePanelData) {
  const labels = useMemo(() => techniqueLabelsById(data.stages), [data.stages]);
  const preset = useMemo(
    () => explorePresetFor(data.presets, data.exploreBandPresets),
    [data.presets, data.exploreBandPresets],
  );
  return { labels, preset };
}

function useExplorePresentation(
  panel: ReturnType<typeof usePanelData<ExplorePanelData>>,
) {
  const filters = useExploreFilters(panel.data.cards);
  const labelsAndPreset = useExploreLabels(panel.data);
  const [collapsedColumns, setCollapsedColumns] = usePersistentCollapsedGroups(
    STORAGE_KEYS.exploreColumns,
    false,
  );
  const [collapsedListGroups, setCollapsedListGroups] = useCollapsedGroups(
    STORAGE_KEYS.exploreListGroups,
  );
  const [viewMode, setViewMode] = useBoardView(STORAGE_KEYS.exploreView, "explore");
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

export async function moveExploreCard(
  rpc: ExploreRpc,
  cardId: string,
  target: string,
) {
  await moveExploreCardWithRpc(
    (movingCardId, status) => rpc.call("moveCard", { cardId: movingCardId, status }),
    cardId,
    target,
    (message) => toast.error(message),
  );
}

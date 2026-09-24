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
  filterAndGroupResearchCards,
  researchPresetFor,
  strategyLabelsById,
} from "../../lib/research-panel-state.mjs";
import type { ResearchStrategyOption } from "../creation/creation-settings";

export type ResearchRpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type RpcResult = Awaited<ReturnType<ResearchRpc["call"]>>;
export type ResearchCard = Extract<RpcResult, { cards: unknown }>["cards"][number];
export type ResearchProject = Extract<RpcResult, { projects: unknown }>["projects"][number];
export type ResearchPreset = Extract<RpcResult, { presets: unknown }>["presets"][number];
type ResearchBand = Extract<RpcResult, { bands: unknown }>["bands"][number];

export type ResearchPanelData = {
  cards: ResearchCard[];
  presets: ResearchPreset[];
  projects: ResearchProject[];
  researchBandPresets: ResearchBand[];
  strategies: ResearchStrategyOption[];
};

const EMPTY_DATA: ResearchPanelData = {
  cards: [],
  presets: [],
  projects: [],
  researchBandPresets: [],
  strategies: [],
};

async function loadResearchData(
  rpc: ResearchRpc,
  projectId: string | null,
): Promise<ResearchPanelData> {
  const [projects, cards, strategies, presets, bands] = await Promise.all([
    rpc.call("projects", {}).catch(() => null),
    rpc.call("listCards", { projectId, kind: "research" }).catch(() => ({ cards: [] })),
    rpc.call("researchStrategies", {}).catch(() => ({ strategies: [] })),
    rpc.call("listPresets", {}).catch(() => ({ presets: [] })),
    rpc.call("listBandPresets", {}).catch(() => ({ bands: [] })),
  ]);
  return {
    cards: cards.cards,
    presets: presets.presets,
    projects: projects?.projects ?? [],
    researchBandPresets: bands.bands,
    strategies: strategies.strategies,
  };
}

export function useResearchPanelState(rpc: ResearchRpc, projectId: string | null) {
  const loadData = useCallback(
    () => loadResearchData(rpc, projectId),
    [projectId, rpc],
  );
  const panel = usePanelData(loadData, {
    errorMessage: "Unable to load research.",
    initialData: EMPTY_DATA,
    itemCountKey: "cards",
    realtimeChannels: ["card-state", "board-changed", "inbox-changed"],
  });
  return useResearchPresentation(panel, projectId);
}

function useResearchFilters(cards: ResearchCard[]) {
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [attention, setAttention] = useState(false);
  const grouped = useMemo(() => filterAndGroupResearchCards(cards, {
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

function useResearchLabels(data: ResearchPanelData) {
  const labels = useMemo(
    () => strategyLabelsById(data.strategies),
    [data.strategies],
  );
  const preset = useMemo(
    () => researchPresetFor(data.presets, data.researchBandPresets),
    [data.presets, data.researchBandPresets],
  );
  return { labels, preset };
}

function useResearchPresentation(
  panel: ReturnType<typeof usePanelData<ResearchPanelData>>,
  projectId: string | null,
) {
  const filters = useResearchFilters(panel.data.cards);
  const labelsAndPreset = useResearchLabels(panel.data);
  const [collapsedColumns, setCollapsedColumns] = usePersistentCollapsedGroups(
    STORAGE_KEYS.researchColumns,
    false,
  );
  const [collapsedListGroups, setCollapsedListGroups] = useCollapsedGroups(
    STORAGE_KEYS.researchListGroups,
  );
  const [viewMode, setViewMode] = useBoardView(STORAGE_KEYS.researchView, "research");
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
    activeProjectId: projectId,
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

export async function moveResearchCard(
  rpc: ResearchRpc,
  cardId: string,
  target: string,
) {
  if (!(LIGHTWEIGHT_COLUMNS as readonly string[]).includes(target)) return;
  const status = target as "inbox" | "doing" | "done" | "archived";
  const result = await rpc.call("moveCard", { cardId, status });
  if (!result.ok) toast.error(result.error ?? "Move failed");
}

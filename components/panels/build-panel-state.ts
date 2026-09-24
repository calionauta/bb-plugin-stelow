import { useCallback, useEffect, useMemo, useState } from "react";
import type { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../../server";
import type { GithubStatus } from "../github/github-dialog-state";
import {
  sanitizeReviewGates,
  type Appetite,
  type ReviewGates,
} from "../creation/creation-settings";
import {
  useBoardView,
  useCollapsedGroups,
  usePanelData,
  usePersistentCollapsedGroups,
} from "../panel/panel-state-hooks";
import { toggleFilterValue } from "../../lib/kanban-layout.mjs";
import { filterAndGroupBuildCards } from "../../lib/build-panel-state.mjs";
import { STORAGE_KEYS } from "../../lib/panel-storage.mjs";
import {
  BUILD_BOARD_COLUMNS,
  BUILD_BOARD_COLUMN_LABELS,
  BUILD_BOARD_VISIBLE_COLUMNS,
  STAGE_SEQUENCE,
} from "../../lib/workflow-vocabulary.mjs";

export type BuildRpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type RpcResult = Awaited<ReturnType<BuildRpc["call"]>>;
export type BuildCard = Extract<RpcResult, { cards: unknown }>["cards"][number];
export type BuildProject = Extract<RpcResult, { projects: unknown }>["projects"][number];
export type BuildPreset = Extract<RpcResult, { presets: unknown }>["presets"][number];
type BandAssignment = Extract<RpcResult, { bands: unknown }>["bands"][number];
export type BuildPanelData = {
  boardBandPresets: BandAssignment[];
  boardPresets: BuildPreset[];
  cards: BuildCard[];
  githubAutomationEnabled: boolean;
  githubStatus: GithubStatus | null;
  projects: BuildProject[];
};

const EMPTY_DATA: BuildPanelData = {
  boardBandPresets: [],
  boardPresets: [],
  cards: [],
  githubAutomationEnabled: true,
  githubStatus: null,
  projects: [],
};

function readStoredReviewGates(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEYS.reviewGates);
  } catch {
    return null;
  }
}

function readReviewGates(): ReviewGates {
  const raw = readStoredReviewGates();
  if (!raw) return [];
  try {
    return sanitizeReviewGates(JSON.parse(raw));
  } catch {
    return [];
  }
}

function useBuildWorkflowPreferences(rpc: BuildRpc) {
  const [appetite, setAppetite] = useState<Appetite>("Lean");
  const [reviewGates, setReviewGates] = useState<ReviewGates>(readReviewGates);
  useEffect(() => {
    void rpc.call("boardWorkflowDefaults", {}).then((defaults) => {
      setAppetite(defaults.appetite);
      if (readStoredReviewGates() === null) {
        setReviewGates(sanitizeReviewGates(defaults.reviewGates));
      }
    }).catch(() => undefined);
  }, [rpc]);
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEYS.reviewGates, JSON.stringify(reviewGates));
    } catch {
      // Persistence is a convenience; inaccessible storage keeps the defaults.
    }
  }, [reviewGates]);
  return { appetite, reviewGates, setAppetite, setReviewGates };
}

function resetFilters(clear: {
  setProjects: (value: string[]) => void;
  setStages: (value: string[]) => void;
  setIntents: (value: string[]) => void;
  setStatuses: (value: string[]) => void;
  setActivities: (value: string[]) => void;
  setAttention: (value: boolean) => void;
}) {
  clear.setProjects([]);
  clear.setStages([]);
  clear.setIntents([]);
  clear.setStatuses([]);
  clear.setActivities([]);
  clear.setAttention(false);
}

function useBuildFilters(cards: BuildCard[]) {
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [stages, setStages] = useState<string[]>([]);
  const [intents, setIntents] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [activities, setActivities] = useState<string[]>([]);
  const [attention, setAttention] = useState(false);
  const grouped = useMemo(() => filterAndGroupBuildCards(cards, {
    columns: BUILD_BOARD_COLUMNS,
    projectIds,
    intents,
    statuses,
    activities,
    stages,
    attention,
  }), [cards, projectIds, intents, statuses, activities, stages, attention]);
  return {
    projectIds,
    stages,
    intents,
    statuses,
    activities,
    attention,
    stageOptions: STAGE_SEQUENCE,
    grouped,
    setAttention,
    toggleProject: (value: string) => setProjectIds((current) => toggleFilterValue(current, value)),
    toggleStage: (value: string) => setStages((current) => toggleFilterValue(current, value)),
    toggleIntent: (value: string) => setIntents((current) => toggleFilterValue(current, value)),
    toggleStatus: (value: string) => setStatuses((current) => toggleFilterValue(current, value)),
    toggleActivity: (value: string) => setActivities((current) => toggleFilterValue(current, value)),
    reset: () => resetFilters({
      setProjects: setProjectIds,
      setStages,
      setIntents,
      setStatuses,
      setActivities,
      setAttention,
    }),
  };
}

async function loadBuildData(rpc: BuildRpc, projectId: string | null): Promise<Partial<BuildPanelData>> {
  const [projects, cards, presets, bands, board] = await Promise.all([
    rpc.call("projects", {}).catch(() => null),
    rpc.call("listCards", { projectId, kind: "build" }).catch(() => ({ cards: [] })),
    rpc.call("listPresets", {}).catch(() => ({ presets: [] })),
    rpc.call("listBandPresets", {}).catch(() => ({ bands: [] })),
    rpc.call("board", { projectId }).catch(() => null),
  ]);
  return {
    projects: projects?.projects ?? [],
    cards: cards.cards,
    boardPresets: presets.presets,
    boardBandPresets: bands.bands,
    ...(board?.githubStatus ? { githubStatus: board.githubStatus } : {}),
    ...(board && "githubAutomationEnabled" in board
      ? { githubAutomationEnabled: board.githubAutomationEnabled !== false }
      : {}),
  };
}

function useBuildData(rpc: BuildRpc, projectId: string | null) {
  const loadData = useCallback(
    () => loadBuildData(rpc, projectId),
    [rpc, projectId],
  );
  return usePanelData(loadData, {
    errorMessage: "Unable to load Stelow.",
    initialData: EMPTY_DATA,
    itemCountKey: "cards",
    realtimeChannels: ["card-state", "board-changed", "inbox-changed"],
  });
}

export function useBuildPanelState(rpc: BuildRpc, projectId: string | null) {
  const preferences = useBuildWorkflowPreferences(rpc);
  const data = useBuildData(rpc, projectId);
  const filters = useBuildFilters(data.data.cards);
  const [collapsedColumns, setCollapsedColumns] = usePersistentCollapsedGroups(
    STORAGE_KEYS.boardColumns,
    false,
  );
  const [collapsedListGroups, setCollapsedListGroups] = useCollapsedGroups(
    STORAGE_KEYS.buildListGroups,
  );
  const [viewMode, setViewMode] = useBoardView(STORAGE_KEYS.buildView, "build");
  const toggleColumn = (column: string) => setCollapsedColumns((current) => ({
    ...current,
    [column]: !current[column],
  }));
  const toggleListGroup = (column: string) => setCollapsedListGroups((current) => ({
    ...current,
    [column]: !current[column],
  }));
  return {
    ...data,
    ...preferences,
    ...filters,
    collapsedColumns,
    collapsedListGroups,
    viewMode,
    setViewMode,
    toggleColumn,
    toggleListGroup,
  };
}

export function analysisPreset(data: BuildPanelData) {
  const fallback = data.boardPresets.find((preset) => preset.isDefault)
    ?? data.boardPresets[0]
    ?? null;
  const assignment = data.boardBandPresets.find((entry) => entry.band === "analysis");
  return data.boardPresets.find((preset) => preset.id === assignment?.presetId) ?? fallback;
}

export async function moveBuildCard(rpc: BuildRpc, cardId: string, target: string) {
  if (!(BUILD_BOARD_COLUMNS as readonly string[]).includes(target)) return;
  const status = target as "inbox" | "analysis" | "planning" | "execution" | "review" | "completed" | "archived";
  const result = await rpc.call("moveCard", { cardId, status });
  if (!result.ok) toast.error(result.error ?? "Move failed");
}

export const BUILD_COLUMN_LABELS = BUILD_BOARD_COLUMN_LABELS;
export const BUILD_VISIBLE_COLUMNS = BUILD_BOARD_VISIBLE_COLUMNS;

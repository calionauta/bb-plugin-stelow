import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { normalizeBoardView, type BoardTrack } from "../../lib/board-views.mjs";
import {
  collapsedGroupsFromStorage,
  isInitialPanelLoad,
  mergePanelData,
  panelErrorMessage,
  shouldNotifyPanelError,
} from "../../lib/panel-state.mjs";
import { useDebouncedRealtime } from "../use-debounced-realtime";

type CollapsedGroups = Record<string, boolean>;
export type BoardView = "board" | "list" | "hill";

function readStoredView(storageKey: string, track: BoardTrack): BoardView {
  if (typeof window === "undefined") return "board";
  try {
    return normalizeBoardView(window.localStorage.getItem(storageKey), track);
  } catch {
    return "board";
  }
}

function readStoredCollapsed(
  storageKey: string,
  mergeDefault: boolean,
): CollapsedGroups {
  if (typeof window === "undefined") return { archived: true };
  return collapsedGroupsFromStorage(
    window.localStorage.getItem(storageKey),
    mergeDefault,
  );
}

function useStoredValue<T>(
  storageKey: string,
  readValue: () => T,
  serialize: (value: T) => string,
) {
  const [value, setValue] = useState<T>(readValue);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, serialize(value));
    } catch {
      // Persistence is a convenience; storage failures must not break the board.
    }
  }, [serialize, storageKey, value]);
  return [value, setValue] as const;
}

export function useBoardView(
  storageKey: string,
  track: BoardTrack,
): [BoardView, (view: BoardView) => void] {
  return useStoredValue(
    storageKey,
    () => readStoredView(storageKey, track),
    String,
  ) as [BoardView, (view: BoardView) => void];
}

export function useCollapsedGroups(storageKey: string) {
  return usePersistentCollapsedGroups(storageKey, true);
}

export function usePersistentCollapsedGroups(
  storageKey: string,
  mergeDefault: boolean,
) {
  return useStoredValue(
    storageKey,
    () => readStoredCollapsed(storageKey, mergeDefault),
    JSON.stringify,
  );
}

type PanelDataOptions<T> = {
  realtimeChannels: readonly string[];
  errorMessage: string | null;
  initialData: T;
  itemCountKey: keyof T;
  notifyOnError?: boolean;
};

export function usePanelData<T extends object>(
  loadData: () => Promise<Partial<T>>,
  {
    realtimeChannels,
    errorMessage,
    initialData,
    itemCountKey,
    notifyOnError = true,
  }: PanelDataOptions<T>,
) {
  const [data, setData] = useState<T>(initialData);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const firstLoadRef = useRef(true);

  const load = useCallback(async () => {
    if (firstLoadRef.current) setLoading(true);
    try {
      const update = await loadData();
      setData((current) => mergePanelData(current, update));
      setLoadError(null);
    } catch (error) {
      const message = panelErrorMessage(error, errorMessage ?? "Unable to load panel data.");
      setLoadError(message);
      if (shouldNotifyPanelError(notifyOnError, errorMessage)) toast.error(message);
    } finally {
      setLoading(false);
      firstLoadRef.current = false;
    }
  }, [errorMessage, loadData, notifyOnError]);

  useEffect(() => {
    void load();
  }, [load]);
  useDebouncedRealtime(realtimeChannels, () => void load());

  return {
    data,
    load,
    loadError,
    loading,
    isInitialLoad: isInitialPanelLoad(
      loading,
      Array.isArray(data?.[itemCountKey]) ? data[itemCountKey].length : 0,
    ),
  };
}

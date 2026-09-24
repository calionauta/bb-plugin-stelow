import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { normalizeBoardView, type BoardTrack } from "../../lib/board-views.mjs";
import {
  collapsedGroupsFromStorage,
  isInitialPanelLoad,
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
};

export function usePanelData<T>(
  loadData: () => Promise<T>,
  { realtimeChannels, errorMessage, initialData, itemCountKey }: PanelDataOptions<T>,
) {
  const [data, setData] = useState<T>(initialData);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const firstLoadRef = useRef(true);

  const load = useCallback(async () => {
    if (firstLoadRef.current) setLoading(true);
    try {
      setData(await loadData());
      setLoadError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : errorMessage;
      setLoadError(message ?? "Unable to load panel data.");
      if (errorMessage) toast.error(message ?? errorMessage);
    } finally {
      setLoading(false);
      firstLoadRef.current = false;
    }
  }, [errorMessage, loadData]);

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

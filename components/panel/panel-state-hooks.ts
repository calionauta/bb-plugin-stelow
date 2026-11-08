import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { normalizeBoardView, type BoardTrack } from "../../lib/board-views.mjs";
import { createCoalescedLoader } from "../../lib/coalesced-loader.mjs";
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

type PanelDataSetters<T> = {
  setData: (update: (current: T) => T) => void;
  setLoading: (loading: boolean) => void;
  setLoadError: (error: string | null) => void;
};

/**
 * One pass: read, merge, report. Extracted from the hook so `usePanelData`
 * stays a wiring function — the loader is created once (a new `loadData`
 * identity must not be a new loader) and this is what it calls, through refs so
 * a captured stale option cannot merge yesterday's answer.
 */
type PassOptions<T> = {
  loadData: () => Promise<Partial<T>>;
  errorMessage: string | null;
  notifyOnError: boolean | undefined;
};

function createPass<T extends object>(
  optionsRef: { current: PassOptions<T> },
  firstLoadRef: { current: boolean },
  setters: PanelDataSetters<T>,
): () => Promise<void> {
  return async () => {
    const { loadData, errorMessage, notifyOnError } = optionsRef.current;
    if (firstLoadRef.current) setters.setLoading(true);
    try {
      const update = await loadData();
      setters.setData((current) => mergePanelData(current, update));
      setters.setLoadError(null);
    } catch (error) {
      const text = panelErrorMessage(error, errorMessage ?? "Unable to load panel data.");
      setters.setLoadError(text);
      if (shouldNotifyPanelError(notifyOnError ?? true, errorMessage)) toast.error(text);
    } finally {
      setters.setLoading(false);
      firstLoadRef.current = false;
    }
  };
}

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
  // One load in flight at a time, one queued behind it: see
  // lib/coalesced-loader.mjs for why a burst of twelve must not become twelve
  // sweeps, and createPass above for what one sweep does.
  const loaderRef = useRef<(() => Promise<void>) | null>(null);
  const optionsRef = useRef({ loadData, errorMessage, notifyOnError });
  optionsRef.current = { loadData, errorMessage, notifyOnError };

  const load = useCallback(() => {
    loaderRef.current ??= createCoalescedLoader(
      createPass(optionsRef, firstLoadRef, { setData, setLoading, setLoadError }),
    );
    return loaderRef.current();
  }, []);

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

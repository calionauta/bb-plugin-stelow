const DEFAULT_COLLAPSED = Object.freeze({ archived: true });

export function collapsedGroupsFromStorage(raw, mergeDefault) {
  if (!raw) return { ...DEFAULT_COLLAPSED };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...DEFAULT_COLLAPSED };
    }
    return mergeDefault
      ? { ...DEFAULT_COLLAPSED, ...parsed }
      : parsed;
  } catch {
    return { ...DEFAULT_COLLAPSED };
  }
}

export function isInitialPanelLoad(loading, itemCount) {
  return loading && itemCount === 0;
}

export function mergePanelData(previous, update) {
  return { ...previous, ...update };
}

export function panelErrorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

export function shouldNotifyPanelError(notifyOnError, fallback) {
  return notifyOnError && Boolean(fallback);
}

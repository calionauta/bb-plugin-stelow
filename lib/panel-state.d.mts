export function collapsedGroupsFromStorage(
  raw: string | null,
  mergeDefault: boolean,
): Record<string, boolean>;

export function isInitialPanelLoad(loading: boolean, itemCount: number): boolean;

export function mergePanelData<T extends object>(previous: T, update: Partial<T>): T;

export function panelErrorMessage(error: unknown, fallback: string): string;

export function shouldNotifyPanelError(notifyOnError: boolean, fallback: string | null): boolean;

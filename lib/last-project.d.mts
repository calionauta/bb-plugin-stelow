type WebStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};
export function readLastProjectId(storage: WebStorage | null | undefined): string | null;
export function writeLastProjectId(storage: WebStorage | null | undefined, id: string | null | undefined): void;
export function resolveDefaultProjectId(activeId: string | null | undefined, storedId: string | null | undefined, validIds?: string[]): string | null;
export function rememberUsedProject(storage: WebStorage | null | undefined, projectId: string | null | undefined): void;
export function browserStorage(): WebStorage | null;

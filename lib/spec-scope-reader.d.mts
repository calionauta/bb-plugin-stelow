export interface SpecScopeBlock {
  n: string;
  title: string;
  body: string;
  dialect: "machine" | "human";
}
export interface PlannedScopeTask {
  id: string;
  name: string;
  note?: string;
  status: string;
  source: string;
}
export type ScopeSyncState = "ok" | "no-spec" | "no-blocks" | "human-dialect" | "unsynced";
export interface ScopeSyncDiagnosis {
  state: ScopeSyncState;
  machine: number;
  human: number;
  synced: number;
}
export declare function splitScopeBlocks(content: unknown): SpecScopeBlock[];
export declare function countScopeDialects(content: unknown): { machine: number; human: number };
export declare function parseScopeTasks(blockBody: unknown, scopeId: string): PlannedScopeTask[];
export declare function diagnoseScopeSync(options?: {
  specContent?: unknown;
  syncedCount?: number;
}): ScopeSyncDiagnosis;
export declare function executionScopeRefusal(options?: {
  kind?: string;
  stage?: string;
  specContent?: unknown;
  syncedCount?: number;
}): string | null;
export declare function mergePlannedTasks<T extends { id?: unknown; tasks?: unknown }>(
  trackedScopes: T[] | null | undefined,
  specContent: unknown,
): T[];

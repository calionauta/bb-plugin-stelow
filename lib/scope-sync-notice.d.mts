export type ScopeSyncState = "ok" | "no-spec" | "no-blocks" | "human-dialect" | "unsynced";
export type ScopeSyncReport = {
  state: ScopeSyncState;
  syncedScopes?: number;
  machineBlocks?: number;
  humanBlocks?: number;
  specFile?: string | null;
};
/** The notice to show for a reported scope-sync state, or null for none. */
export declare function scopeSyncNotice(
  scopeSync: ScopeSyncReport | null | undefined,
  options?: { terminal?: boolean },
): string | null;

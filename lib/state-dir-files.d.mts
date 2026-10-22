export declare type StateDirFileEntry = { label: string; path: string; missing: boolean };
export declare const STATE_DIR_FILES: ReadonlyArray<{
  name: string;
  label: string;
  conditional: boolean;
}>;
export declare const STATE_SUBDIR_FILES: ReadonlyArray<{
  path: string;
  label: string;
  conditional: boolean;
}>;
export declare function stateDirFileEntries(
  stateDir: string | null,
  exists: (path: string) => boolean,
): StateDirFileEntry[];
export declare const STATE_DIR_SUBDIRS: readonly string[];
export declare function stateDirSubdirEntries(stateDir: string | null): StateDirFileEntry[];
/** Workspace-root host files (stelow.json); empty when the root is unknown. */
export declare function workspaceFileEntries(workspaceRoot: string | null): StateDirFileEntry[];

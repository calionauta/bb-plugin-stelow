/** The workspace a freshly spawned worker actually got, when it is its own. */
export type RecordedWorkspace = {
  workspaceKind: "worktree";
  workspacePath: string;
};

/**
 * The record to write when a worker's environment is a checkout of its own.
 *
 * Null when either path is unknown or the environment IS the project's source —
 * a wrong `workspace_path` is worse than none, because every gate would then bind
 * to a directory that does not hold the work.
 */
export declare function recordedWorkspace(
  environmentPath: unknown,
  projectSourcePath: unknown,
): RecordedWorkspace | null;

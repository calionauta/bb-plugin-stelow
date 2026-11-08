/**
 * Whether a spawned worker's environment is a checkout of its own.
 *
 * A card spawned on a `new-worktree` preset gets a managed checkout, and from
 * that moment its files, its test run, its security scan and `done` must bind to
 * THAT directory — not to the project's shared source, which holds a different
 * branch and usually another thread's uncommitted work. Nothing recorded it, so
 * `cardWorkspace` answered the project and every gate ran against a tree the
 * card never wrote. That is the dead end that kept finished, merged cards at
 * `audit`: the refusal ("the last host-run test result belongs to a different
 * checkout or HEAD") names the symptom and no card action can clear it.
 *
 * The record is written only when the answer is certain: both paths known and
 * different. An unknown environment, or one that resolves to the project itself,
 * writes nothing — a wrong `workspace_path` is worse than none, because every
 * gate would then bind to a directory that does not hold the work.
 */
export function recordedWorkspace(environmentPath, projectSourcePath) {
  const environment = typeof environmentPath === "string" ? environmentPath.trim() : "";
  const project = typeof projectSourcePath === "string" ? projectSourcePath.trim() : "";
  if (!environment || !project) return null;
  const normalise = (value) => value.replace(/\/+$/, "");
  if (normalise(environment) === normalise(project)) return null;
  return { workspaceKind: "worktree", workspacePath: environment };
}

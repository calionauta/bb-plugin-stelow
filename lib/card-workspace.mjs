/**
 * Which checkout a card works in.
 *
 * The answer decides where the card's files are read, where its test run and
 * security scan happen, and which directory `done` binds its receipt to. Getting
 * it wrong is not a display bug: `completionRoot` prefers the root of the
 * card's state dir, and the state dir lives in whatever checkout the worker was
 * seeded into — so a workspace that disagrees with the state dir produces two
 * different answers, and the gates refuse with
 * "the last host-run test result belongs to a different checkout or HEAD".
 *
 * That refusal is unfixable from the card's side, which is why cards with
 * finished, merged work sat at `audit`. The rule now:
 *
 *   - an exploratory card is its own workspace (it always was);
 *   - a card that RECORDED a linked worktree works there, because a linked
 *     worktree is a different directory holding a different branch;
 *   - a recorded path that no longer exists falls through to the project's
 *     default source, so a reclaimed worktree behaves as it did before rather
 *     than becoming a broken card;
 *   - everything else is the project's default source (then its first source).
 *
 * Pure: the existence check is injected, so the rule is testable without a
 * filesystem and the caller decides what "exists" means.
 */
export function resolveCardWorkspacePath(card, projectSource, pathExists = () => true) {
  const recorded = typeof card?.workspacePath === "string" && card.workspacePath
    ? card.workspacePath
    : null;
  const hostId = card?.workspaceHostId ?? null;
  if (card?.workspaceKind === "exploratory") {
    return recorded ? { path: recorded, hostId } : null;
  }
  if (card?.workspaceKind === "worktree" && recorded && pathExists(recorded)) {
    return { path: recorded, hostId };
  }
  return projectSource?.path
    ? { path: projectSource.path, hostId: projectSource.hostId ?? null }
    : null;
}

/** The project's own source: the default one, or the first when none is marked. */
export function defaultProjectSource(project) {
  const sources = Array.isArray(project?.sources) ? project.sources : [];
  return sources.find((entry) => entry?.isDefault) ?? sources[0] ?? null;
}

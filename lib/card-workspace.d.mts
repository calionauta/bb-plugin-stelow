/** The checkout a card works in, and the machine that holds it. */
export type CardWorkspace = { path: string; hostId: string | null };

/** The slice of a card row this rule reads. */
export type CardWorkspaceInput = {
  workspaceKind?: string | null;
  workspacePath?: string | null;
  workspaceHostId?: string | null;
};

/** The project's own source: the default one, or the first when none is marked. */
export declare function defaultProjectSource(
  project: unknown,
): { path?: string; hostId?: string | null } | null;

/**
 * Which checkout a card works in.
 *
 * An exploratory card answers its own recorded directory (null when it has
 * none). A card that recorded a linked worktree answers that worktree while the
 * directory exists, and falls through to the project's default source when it
 * does not — a reclaimed worktree must not become a broken card.
 */
export declare function resolveCardWorkspacePath(
  card: CardWorkspaceInput | null | undefined,
  projectSource: { path?: string; hostId?: string | null } | null,
  pathExists?: (path: string) => boolean,
): CardWorkspace | null;

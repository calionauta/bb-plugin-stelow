/** A live BB thread, as `bb thread list --json` reports it. */
export interface HostThread {
  id: string;
  path: string;
  status: string;
  title: string | null;
  isStelow: boolean;
}

export interface SharedCheckoutThreadsOptions {
  /** The card's checkout directory, compared to each thread's environment path. */
  checkoutPath?: string | null;
  /** The card's own worker, which is never an intruder on its own card. */
  excludeThreadId?: string | null;
}

export interface SharedCheckoutExposure {
  threads: HostThread[];
  files: string[];
  lines: string[];
}

/**
 * True when the workspace is a worktree the host made for this card, named
 * `sw-<cardId>`. Isolation is the reason a cross-thread scan finds nothing, so
 * callers short-circuit on this before spending a subprocess on the question.
 */
export declare function isManagedWorktree(
  workspacePath: unknown,
  cardId: unknown,
): boolean;

/** Live threads outside the plugin whose checkout is this same directory. */
export declare function threadsSharingCheckout(
  threads: readonly unknown[] | null | undefined,
  opts?: SharedCheckoutThreadsOptions,
): HostThread[];

/** Dirty paths from one `git status --porcelain=v1 -z` output. */
export declare function dirtyPathsFromPorcelain(status: unknown): string[];

/** Which of `heldFiles` are dirty in a checkout other threads are working in. */
export declare function sharedCheckoutExposure(input?: {
  heldFiles?: readonly string[] | null;
  dirtyPaths?: unknown;
  threads?: readonly unknown[] | null;
  checkoutPath?: string | null;
  excludeThreadId?: string | null;
}): SharedCheckoutExposure;

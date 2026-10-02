export interface BundleSourceRoots {
  /** The project's root. A committed bundle must stay relative to this. */
  projectRoot: string | null;
  /** The card's staging dir, where staging-relative sources actually live. */
  stateDir: string | null;
}

/**
 * Every root worth trying for one path from a card's artifact manifest, in the
 * order a reader should try them. Empty when the path is unusable.
 */
export declare function resolveBundleSource(
  sourcePath: unknown,
  roots: BundleSourceRoots,
): string[];

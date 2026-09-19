/**
 * Run-bundle planning helpers (pure, no IO). File reads/writes live in
 * server.ts; `done` refreshes the bundle on every completion and
 * `export --check` reports drift between dones.
 */
export declare function assignBundleNames(
  registered: unknown,
): Array<{ name: string; stage: string | null; sourcePath: string }>;
export declare function parseBundleManifest(
  content: unknown,
): Array<{ name: string; stage: string | null; sha8: string; sourcePath: string }>;
export declare function staleBundleEntries(
  manifestEntries: unknown,
  shaBySource: Map<string, string | null> | Record<string, string | null> | null | undefined,
): Array<{ name: string; stage: string | null; sha8: string; sourcePath: string; reason: string }>;
export declare function unbundledSources(registered: unknown, manifestEntries: unknown): string[];

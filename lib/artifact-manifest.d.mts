export interface ArtifactManifestEntry {
  stage: string;
  path: string;
  kind?: string;
  label?: string;
}

export function parseArtifactManifest(stateBlob: string): ArtifactManifestEntry[];

export function resolveArtifactPath(projectRoot: string, artifactPath: string): string | null;

export function isPublishableArtifactContent(content: unknown): boolean;

export function isDeliverableArtifactPath(candidate: unknown): boolean;

export function unregisteredArtifactPaths(allPaths: string[], registeredPaths: string[]): string[];

export interface ArtifactTrailerGaps {
  fixed?: number;
  documented?: number;
  escalated?: number;
}

export function buildArtifactTrailer(cardId: string, artifacts: Array<{ stage?: string | null; path?: string | null }>, gapTotals?: ArtifactTrailerGaps | null): string[];

export function trailerArtifactCount(trailer: string[]): number;

export interface BundleManifestFile {
  name: string;
  stage?: string | null;
  sha8?: string | null;
  sourcePath: string;
}

export interface BundleManifestTokens {
  input?: number | null;
  output?: number | null;
  cached?: number | null;
  reasoning?: number | null;
  total?: number | null;
}

export interface BundleManifestInput {
  cardId: string;
  cardName: string;
  stage: string;
  generatedAt: string;
  /** What this export copied: one row per file, with its SHA. */
  files: BundleManifestFile[];
  missing: string[];
  /** The owner of "which artifacts this card produced": the `artifacts:`
   * list in `state.md`. The trailer is derived from this list, never from
   * the copied subset — an unreadable artifact was still produced. */
  registered: Array<{ stage?: string | null; path: string }>;
  gapTotals?: ArtifactTrailerGaps | null;
  tokens?: BundleManifestTokens | null;
}

export function renderBundleManifest(input: BundleManifestInput): string;

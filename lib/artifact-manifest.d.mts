export interface ArtifactManifestEntry {
  stage: string;
  path: string;
  kind?: string;
  label?: string;
}

export function parseArtifactManifest(stateBlob: string): ArtifactManifestEntry[];

export function resolveArtifactPath(projectRoot: string, artifactPath: string): string | null;

export function isPublishableArtifactContent(content: unknown): boolean;

export function unregisteredArtifactPaths(allPaths: string[], registeredPaths: string[]): string[];

export interface ArtifactTrailerGaps {
  fixed?: number;
  documented?: number;
  escalated?: number;
}

export function buildArtifactTrailer(cardId: string, artifacts: Array<{ stage?: string | null; path?: string | null }>, gapTotals?: ArtifactTrailerGaps | null): string[];

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
  files: BundleManifestFile[];
  missing: string[];
  gapTotals?: ArtifactTrailerGaps | null;
  tokens?: BundleManifestTokens | null;
}

export function renderBundleManifest(input: BundleManifestInput): string;

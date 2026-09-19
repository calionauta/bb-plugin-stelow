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

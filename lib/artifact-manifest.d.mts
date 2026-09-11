export interface ArtifactManifestEntry {
  stage: string;
  path: string;
  kind?: string;
  label?: string;
}

export function parseArtifactManifest(stateBlob: string): ArtifactManifestEntry[];

export function resolveArtifactPath(projectRoot: string, artifactPath: string): string | null;

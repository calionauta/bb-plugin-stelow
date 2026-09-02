export interface ArtifactManifestEntry {
  stage: string;
  path: string;
  kind?: string;
  label?: string;
  generated_at?: string;
}

export function parseArtifactManifest(stateBlob: string): ArtifactManifestEntry[];

export type ArtifactRole = "deliverable" | "evidence";
export declare function artifactRole(
  artifact: { kind?: string; path?: string } | null | undefined,
): ArtifactRole;
export declare function splitArtifactsByRole<T>(artifacts: T[] | null | undefined): {
  deliverables: T[];
  evidence: T[];
};
export declare function artifactRoleCounts(artifacts: unknown[] | null | undefined): {
  deliverables: number;
  evidence: number;
};

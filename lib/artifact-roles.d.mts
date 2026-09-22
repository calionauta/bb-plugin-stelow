export type ArtifactRole = "deliverable" | "evidence";
export declare function artifactRole(
  artifact: { kind?: string; path?: string } | null | undefined,
): ArtifactRole;
export declare function isReconReceiptArtifact(
  artifact: { path?: string } | null | undefined,
): boolean;
export declare function splitArtifactsByRole<T>(artifacts: T[] | null | undefined): {
  deliverables: T[];
  evidence: T[];
};
/** Auto-open the collapsed trail file list only when the trail needs attention. */
export declare function shouldAutoOpenEvidence(trailState: string | null | undefined): boolean;

export type QuestionEvidenceSnapshot = {
  artifactSha256: string;
  gitRoot: string | null;
  headSha: string | null;
};
export type QuestionStalenessObservation = {
  sha256: string | null;
  headSha: string | null;
};
export type QuestionStaleness = {
  docRevised: boolean;
  docRemoved: boolean;
  checkoutMoved: boolean;
};
export declare function stalenessOf(
  snapshot: QuestionEvidenceSnapshot | null | undefined,
  observed: QuestionStalenessObservation | null | undefined,
): QuestionStaleness | null;
export declare function anyStale(verdicts: unknown): boolean;

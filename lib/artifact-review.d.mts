export declare type ArtifactReviewRow = {
  path: string;
  reviewed: boolean;
  stale: boolean;
};

export declare type ArtifactReviewState = {
  rows: ArtifactReviewRow[];
  reviewedCount: number;
  total: number;
  stale: string[];
  line: string | null;
};

export declare function reviewLine(
  reviewedCount: number,
  total: number,
  staleCount: number,
): string | null;

export declare function reviewState(
  artifacts:
    | ReadonlyArray<{ path: string; generatedAt: string }>
    | null
    | undefined,
  marks: ReadonlyMap<string, string> | null | undefined,
): ArtifactReviewState;

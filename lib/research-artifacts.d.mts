export declare const MIN_ROUND_CHARS: number;
export declare const MIN_EXPLORE_CHARS: number;
export declare function researchRoundMirrorsIndex(content: unknown, indexBlob: unknown): boolean;
export declare function isValidRoundContent(content: unknown, indexBlob: unknown, minChars?: number): boolean;
export declare function isValidExploreContent(content: unknown, minChars?: number): boolean;
export declare function exploreArtifactFile(stageId: string): string;
export declare function findInvalidRounds(
  history: Array<{ id: string; file: string }>,
  readContent: (path: string) => string | null,
  indexBlob: string | null,
  labelById?: ((id: string) => string | null) | null,
): Array<{ n: number; label: string }>;
export declare function researchVerifyReport(
  cardId: string,
  roundCount: number,
  indexReviewable: boolean,
  invalidRounds: Array<{ n: number; label: string }>,
): { card: string; kind: "research"; indexReviewable: boolean; invalidRounds: Array<{ n: number; label: string }>; pass: boolean; roundCount: number };
export declare function researchVerifyText(report: { card: string; pass: boolean; roundCount: number; invalidRounds?: Array<{ n: number; label: string }> }): { exitCode: number; stdout?: string; stderr?: string };
export declare function exploreVerifyReport(
  cardId: string,
  stage: string | null,
  ready: boolean,
): { card: string; kind: "explore"; stage: string | null; pass: boolean };
export declare function exploreVerifyText(report: { card: string; stage: string | null; pass: boolean }): { exitCode: number; stdout?: string; stderr?: string };

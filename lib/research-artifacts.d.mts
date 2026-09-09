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

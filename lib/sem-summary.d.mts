export declare function summarizeSemDiff(json: unknown): {
  total: number;
  fileCount: number;
  added: number;
  modified: number;
  deleted: number;
  renamed: number;
  moved: number;
  cosmeticOnly: boolean;
} | null;

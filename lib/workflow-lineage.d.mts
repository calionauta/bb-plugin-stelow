export interface LineageEntry {
  threadId: string;
  presetId: string | null;
  endedReason: string;
}
export declare function applyLineage(tracking: unknown, dirHash: string, entry: LineageEntry): boolean;
export declare function mergeLineageFile(existingContent: unknown, dirHash: string, entry: LineageEntry): string | null;
export interface FilesLike {
  read(args: { path: string }): Promise<{ content: unknown }>;
  write(args: { path: string; rootPath: string; expectedSha256: null; content: string }): Promise<{ outcome: string } | null | undefined>;
}
export declare function writeMergedFile(
  files: FilesLike,
  path: string,
  rootPath: string,
  makeContent: (existing: string | null) => string | null,
  maxAttempts?: number,
): Promise<{ written: boolean; attempts: number }>;

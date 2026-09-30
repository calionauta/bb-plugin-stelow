export interface FileOccupancyHolder {
  cardId: string;
  scope: string | null;
  expiresAt: number | null;
}
export interface FileOccupancyEntry {
  file: string;
  holders: FileOccupancyHolder[];
  expired: boolean;
}
export interface CardFileOccupancy {
  /** True when the card works in a managed worktree: unreachable by others. */
  isolated: boolean;
  files: FileOccupancyEntry[];
  lines: string[];
  shared: number;
  workspacePath?: string | null;
}
export declare function fileOccupancy(
  claimRows: readonly { file_path?: unknown; card_id?: unknown; scope?: unknown; expires_at?: unknown }[] | null | undefined,
  opts?: { nowMs?: number },
): FileOccupancyEntry[];
export declare function fileOccupancyLine(
  entry: FileOccupancyEntry,
  opts?: { thisCardId?: string | null },
): string | null;
export declare function cardFileOccupancy(
  claimRows: readonly { file_path?: unknown; card_id?: unknown; scope?: unknown; expires_at?: unknown }[] | null | undefined,
  opts?: { cardId?: string | null; workspacePath?: string | null; isolated?: boolean; nowMs?: number },
): CardFileOccupancy;

export declare const CARD_KINDS: Array<"build" | "research" | "explore">;
export declare const LIGHTWEIGHT_KINDS: Array<"research" | "explore">;
export declare const LIGHTWEIGHT_COLUMNS: Array<"inbox" | "doing" | "done" | "archived">;
export declare const LIGHTWEIGHT_VISIBLE_COLUMNS: Array<"inbox" | "doing" | "done" | "archived">;
export declare const LIGHTWEIGHT_COLUMN_LABELS: Record<string, string>;
export declare const LIGHTWEIGHT_STATUS_BY_COLUMN: Record<string, string>;
export declare const BOARD_MOVE_COLUMNS: string[];
export declare const TRACK_BANDS: Record<string, string>;
export declare function isValidKind(kind: unknown): kind is "build" | "research" | "explore";
export declare function isLightweightKind(kind: unknown): kind is "research" | "explore";
export declare function normalizeKind(kind: unknown): "build" | "research" | "explore";
export declare function bandForKind(kind: unknown): string;
export declare function lightweightColumnForStatus(status: unknown): "inbox" | "doing" | "done" | "archived";
export declare function describeCardEnvironment(options: {
  exploratory?: unknown;
  envType?: unknown;
  workspaceType?: unknown;
}): "exploratory" | "managed" | "worktree" | "personal" | "shared" | "unknown";

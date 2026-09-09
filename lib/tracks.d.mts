export declare const CARD_KINDS: Array<"build" | "research" | "explore">;
export declare const LIGHTWEIGHT_KINDS: Array<"research" | "explore">;
export declare const LIGHTWEIGHT_COLUMNS: Array<"todo" | "doing" | "done" | "archived">;
export declare const LIGHTWEIGHT_COLUMN_LABELS: Record<string, string>;
export declare const TRACK_BANDS: Record<string, string>;
export declare function isValidKind(kind: unknown): kind is "build" | "research" | "explore";
export declare function isLightweightKind(kind: unknown): kind is "research" | "explore";
export declare function normalizeKind(kind: unknown): "build" | "research" | "explore";
export declare function bandForKind(kind: unknown): string;

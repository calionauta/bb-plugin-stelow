export function joinStrategyLabels(
  ids: Array<string | null | undefined>,
  byId: ReadonlyMap<string, string>,
): string | null;

export function statusTone(status: string): string;

export declare function statusGlyph(status: string): string;

export function liveBorderClass(card: {
  activity: string;
  needsAttention: boolean;
}): string;

/** The label a stopped card shows, or null when it is not stopped. */
export declare function errorActivityLabel(card: {
  activity: string;
  lastError?: string | null;
}): { label: string; detail: string } | null;

/** The label a paused card shows, or null when it is not paused. */
export declare function pausedActivityLabel(card: {
  activity: string;
  needsAttention?: boolean;
  lastError?: string | null;
}): { label: string; detail: string } | null;

/**
 * How long an idle card has been waiting, or null when it is not idle.
 * A compact duration (`2d 4h`), never an absolute date: the tile row it lands
 * in is one line wide, and a locale timestamp overflows it.
 */
export declare function idleDurationLabel(
  card: {
    activity: string;
    lastIdleAt?: number | null;
    updatedAt?: number | null;
  },
  now?: number,
): string | null;

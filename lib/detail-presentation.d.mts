export function joinStrategyLabels(
  ids: Array<string | null | undefined>,
  byId: Map<string, string>,
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

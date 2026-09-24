export function joinStrategyLabels(
  ids: Array<string | null | undefined>,
  byId: Map<string, string>,
): string | null;

export function statusTone(status: string): string;

export function liveBorderClass(card: {
  activity: string;
  needsAttention: boolean;
}): string;

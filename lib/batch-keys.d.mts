/** One entry of the always-visible key legend. */
export type BatchKeyLegendEntry = {
  keys: string;
  label: string;
};

/** What a keydown means for a question batch, or null when it is not ours. */
export type BatchKeyDecision =
  | { type: "pick"; optionIndex: number }
  | { type: "move"; toIndex: number }
  | { type: "focus-note" }
  | { type: "toggle-skip" }
  | { type: "open-document" }
  | { type: "submit" }
  | { type: "show-keys" };

export type BatchKeyContext = {
  questionIndex?: number;
  questionCount?: number;
  optionCount?: number;
  canSkip?: boolean;
  hasDocument?: boolean;
};

export declare const BATCH_KEY_LEGEND: BatchKeyLegendEntry[];
/** Every shortcut, for the `?` list — deliberately longer than the legend. */
export declare const BATCH_KEY_LIST: BatchKeyLegendEntry[];

export declare function batchKeyDecision(
  event: unknown,
  context?: BatchKeyContext,
): BatchKeyDecision | null;

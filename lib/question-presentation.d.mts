export declare function questionCopy(): {
  questionOf: (current: number, total: number) => string;
  questions: string;
  answered: string;
  other: string;
  customPlaceholder: string;
  skipped: string;
  skip: string;
  submitAnswer: string;
  submitAnswers: string;
  sending: string;
  back: string;
  next: string;
  continue: string;
  continueWithAnswers: (count: number) => string;
  recoveryHeading: string;
};
export declare function englishQuestionContentError(question: unknown, options?: Array<{ label?: unknown; description?: unknown }> | null): string | null;
export declare function askTimelineLabels(options: { batched?: unknown; count?: unknown }): {
  pending: string;
  completed: string;
};
export declare function describeAskSubmission(value: unknown): {
  title?: string;
  detail?: string;
};
export declare const PROSE_SUMMARY_LIMIT: number;
export declare function splitProseSummary(text: unknown, limit?: unknown): {
  head: string;
  tail: string | null;
};
export declare function submitBlockReason(
  questions: unknown,
  selected: unknown,
  custom: unknown,
): string | null;
// An approval is a decision after reading, not a request to alter the
// document. All other choices — especially Request/Review changes — keep
// the full quote-and-comment path to communicate precise feedback.
export declare function artifactViewerModeForOption(label: unknown): "review" | "comment";
export declare function sharedQuestionArtifact(options: unknown): {
  path: string;
  display: string;
  absolutePath: string | null;
  hostId: string | null;
} | null;

/* merged from lib/question-form.d.mts */
export interface QuestionFormOption {
  label: string;
  description: string;
  preview: string | null;
  artifact: { path: string; display: string; absolutePath: null; hostId: null } | null;
  selected?: boolean;
  needsNote?: boolean;
}

export interface QuestionFormItem {
  id: string;
  title: string;
  prompt: string;
  multiple: boolean;
  kind?: "standard" | "split";
  options: QuestionFormOption[];
}

export declare function questionFormItems(interaction: {
  id: string;
  title: string;
  payload: unknown;
}): QuestionFormItem[];

export declare function questionFormSubmission(
  answers: string[][],
  batched: boolean,
): { answers: string[] | string[][] };

export declare function questionFormActions<T>(
  submit: (value: T) => Promise<void>,
  cancel: () => Promise<void>,
): {
  submit(answers: string[][], batched: boolean): Promise<void>;
  cancel(): Promise<void>;
};

/* merged from lib/split-question-presentation.d.mts */
export declare const SPLIT_QUESTION_GUIDANCE: string;
export declare function isSplitQuestion(
  question: {
    kind?: "standard" | "split";
    multiple?: boolean;
    options?: Array<{ label?: string }>;
  } | null | undefined,
): boolean;
export declare function splitQuestionText(question: string | null | undefined): string;
export declare function splitOptionDescription(description: string | null | undefined): string;
export declare function splitSelectionNotice(
  options: Array<{ label?: string }> | null | undefined,
  selected: string[] | null | undefined,
): { kind: "keep" | "archive" | "partial"; text: string } | null;

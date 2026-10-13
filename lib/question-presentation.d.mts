export declare function questionCopy(): {
  answerNeeded: string;
  answersNeeded: (count: number) => string;
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
  batchProgress: (done: number, total: number, canSkip: boolean) => string;
  answersRemaining: (count: number, canSkip: boolean) => string;
  pickOneOrMore: string;
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
export declare const OPTION_DESCRIPTION_PREVIEW_LIMIT: number;
export declare function splitOptionDescriptionPreview(description: unknown, limit?: unknown): {
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

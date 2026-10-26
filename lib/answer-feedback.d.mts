export declare const ANSWER_FEEDBACK_HEADER: string;

export declare function answerFeedbackHolds(
  facts: { activity?: string | null; openExpired?: number | null } | null | undefined,
): boolean;

export declare function answerFeedbackBlock(
  bodies: readonly string[] | null | undefined,
): string | null;

export declare function commentDeliveryLine(
  delivery: "sent" | "queued" | "rides-answer" | null,
  hold: unknown,
): string | null;

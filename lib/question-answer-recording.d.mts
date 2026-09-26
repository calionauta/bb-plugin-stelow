export declare const EXPIRED_QUESTION_ID_PREFIX: "expired:";
export declare function expiredQuestionId(rowId: string): string;
export declare function isExpiredQuestionId(questionId: unknown): boolean;
export declare function expiredQuestionRowId(questionId: string): string;
export declare function parseAnswerArgs(args: unknown): { pairs?: Array<{ question: string; answer: string }>; json?: boolean; error?: string };
export declare function buildAnswerPayload(pairs: unknown): {
  live: Array<{ questionId: string; answers: string[] }>;
  expired: Array<{ questionId: string; answers: string[] }>;
};
export declare function answerCommentBody(decisions: unknown): string | null;
export declare function answeredCardPatch(hasOpenQuestions: boolean): {
  activity: "awaiting-answer" | "running";
  status: "in-progress";
  last_error: null;
};

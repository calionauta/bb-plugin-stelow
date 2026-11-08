/* from lib/card-question-state.d.mts */
export declare const QUESTION_ACTIVITY: "awaiting-answer";
export declare function questionWaitUpdates(lastOutput: string | null): { activity: "awaiting-answer"; last_assistant_text: string | null };
export declare function askFinishedUpdates(): { activity: "running" };
export declare function researchColumnForStatus(status: unknown): "todo" | "doing" | "done" | "archived";

/* from lib/status-question-state.d.mts */
export declare type QuestionCount = {
  /** Unanswered expired/recovery rows: answerable on the card right now. */
  expired: number;
  /** Live BB interactions on the worker thread. */
  live: number;
};
export declare type StatusBoardLine = {
  name: string;
  status: string;
  stage: string;
  questions?: QuestionCount | null;
};
/**
 * The column a human (or an agent) reads to answer "is anything waiting on
 * me?". Absent counts render nothing, so a board that does not report
 * questions stays exactly as it was.
 */
export declare function renderStatusLine(workflow: StatusBoardLine, tab?: string): string;
/* from lib/expired-questions.d.mts */
export declare function readOpenExpiredQuestions(
  deps: {
    db: { prepare(query: string): { all(...values: unknown[]): Array<Record<string, unknown>> } };
    resolveAskOptions: (card: any, options: any) => Promise<any>;
  },
  card: { id: string; status: string },
): Promise<Array<{ id: string; question: string; multiple: boolean; kind: string; options: unknown; expiredAt: number }>>;

/* from lib/expired-question-answers.d.mts */
export declare function expiredAnswerPayload(questions: Array<{ id: string }>, answerGroups: string[][]): Array<{ questionId: string; answers: string[] }>;
export declare function cleanAnswerList(answers: unknown): string[];

/* from lib/question-staleness.d.mts */
export type QuestionEvidenceSnapshot = {
  artifactSha256: string;
  gitRoot: string | null;
  headSha: string | null;
};
export type QuestionStalenessObservation = {
  sha256: string | null;
  headSha: string | null;
};
export type QuestionStaleness = {
  docRevised: boolean;
  docRemoved: boolean;
  checkoutMoved: boolean;
};
export declare function stalenessOf(
  snapshot: QuestionEvidenceSnapshot | null | undefined,
  observed: QuestionStalenessObservation | null | undefined,
): QuestionStaleness | null;
export declare function anyStale(verdicts: unknown): boolean;

/* from lib/question-sync-kick.d.mts */
export declare function syncFreshQuestionInbox(deps: {
  db: any;
  bb: any;
  pendingAsks: (threadId: string | null) => Promise<Array<{ id: string }> | null>;
  openExpiredQuestionIds: (cardId: string) => string[];
  now: () => number;
  randomId: (prefix: string) => string;
  threadId: string | null;
  cardId: string;
}): Promise<{ inserted: number; resolved: number; reopened: number; pausedSuperseded: number } | null>;
export declare function kickQuestionSync(
  deps: unknown,
  opts?: { threadId?: string | null; cardId?: string; delayMs?: number },
): () => void;


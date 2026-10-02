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
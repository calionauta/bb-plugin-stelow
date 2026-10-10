export declare const QUESTION_SYNC_KICK_MS: number;
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

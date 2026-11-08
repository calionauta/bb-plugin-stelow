import type { PremiseObserver } from "./premise-staleness.mjs";

export type RecordedAnswerDecision = {
  question: string;
  answers: string[];
  /** The checklist contract the answer satisfies, or null. */
  contract: string | null;
};

/** The store's answer boundary (lib/question-contracts `consumeAnsweredContract`). */
export type AnswerConsume = (
  db: any,
  cardId: string,
  question: string,
  options?: { observe?: PremiseObserver | null },
) => { contract: string | null; premise: string | null; verdict: unknown } | null;

export declare function recordAnswerTrail(input: {
  db: any;
  cardId: string;
  decisions: Array<{ question?: string; answers?: string[] }>;
  observe?: PremiseObserver | null;
  consume: AnswerConsume;
  logComment: (cardId: string, targetType: string, targetId: string, actor: "user" | "agent", body: string) => void;
  /** Verdicts already computed inside a transaction; never recomputed. */
  knownStaleNotes?: string[];
}): { entries: RecordedAnswerDecision[]; body: string };

export declare function commitRecoveryAnswers(input: {
  db: any;
  cardId: string;
  rows: Array<{ id: string; question: string; answers: string[] }>;
  observe?: PremiseObserver | null;
  consume: AnswerConsume;
}): { decisions: RecordedAnswerDecision[]; staleNotes: string[] };

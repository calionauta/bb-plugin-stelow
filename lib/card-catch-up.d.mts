export interface CatchUpFact {
  kind: string;
  at: number;
  text?: string;
  stage?: string;
  open?: boolean;
}

export declare const CATCH_UP_KINDS: string[];

export declare function catchUpAnchor(input: {
  readAts?: unknown[];
  createdAt?: number | null;
}): { since: number; basis: "last-read" | "created" };

export declare function catchUpFacts(input?: {
  since?: number | null;
  stageEvents?: Array<{ stage: string; entered_at: number }>;
  inboxEvents?: Array<{ kind: string; summary: string; occurred_at: number; resolved_at: number | null }>;
}): CatchUpFact[];

export declare function catchUpSummary(facts: CatchUpFact[], input: { basis: string }): string;

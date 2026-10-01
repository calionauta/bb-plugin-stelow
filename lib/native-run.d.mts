/** A native Workflows run as the liveness rule reads it: the state, plus the
 * two names a reader would meet — the card's stage and the host's recipe slug. */
export type NativeRunRef = {
  id: string;
  normalizedStatus: "queued" | "running" | "needs_input" | "succeeded" | "failed" | "cancelled";
  recipeId: string;
  stage: string;
  /** The stage's human label, when the caller resolved one. */
  stageLabel?: string | null;
};

export declare const RUN_ACTIVITY: "running";

export declare function liveRun(runs: unknown): NativeRunRef | null;

/** Whether a live run means the card must keep running, given open questions. */
export declare function keepsCardRunning(runs: unknown, openQuestionCount: number): boolean;

export declare function runSentence(run: NativeRunRef | null): string | null;

export declare function runUpdates(lastOutput: string | null): {
  activity: "running";
  last_assistant_text: string | null;
  last_idle_at: null;
};

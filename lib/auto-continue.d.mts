export declare const MAX_AUTO_CONTINUES: number;
export declare const TERMINAL_STAGES: string[];
export declare const MAX_DONE_NUDGES: number;
export declare function ensureAutoContinueColumns(db: { prepare(sql: string): { all(): Array<{ name: string }>; }; exec(sql: string): void }): void;
export declare function shouldAutoContinue(options: {
  status: string;
  stage: string;
  questionPending: boolean;
  transitioningIntoIdle: boolean;
  progressed: boolean;
  autoCount?: number | null;
  autoStage?: string | null;
}): { proceed: boolean; reason: string };
export declare function nextAutoContinue(options: { stage: string; autoCount?: number | null; autoStage?: string | null }): { count: number; stage: string };
export declare function shouldDoneNudge(options: {
  status: string;
  cardStatus?: string | null;
  questionPending: boolean;
  transitioningIntoIdle: boolean;
  autoCount?: number | null;
  autoStage?: string | null;
}): { proceed: boolean; reason: string };
export declare function resetAutoContinue(): { count: number; stage: null };
export declare function lastTurnAdvancedStages(events: unknown): boolean;

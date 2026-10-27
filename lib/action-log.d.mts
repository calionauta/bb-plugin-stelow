type Db = {
  exec(query: string): void;
  prepare(query: string): {
    run(...values: unknown[]): { changes?: number };
    get(...values: unknown[]): any;
    all(...values: unknown[]): any[];
  };
};

export type ActionOutcome = "ok" | "refused" | "error" | "skipped" | "partial";
export type ActionActor = "client" | "agent" | "plugin";
export type ActionSurface = "rpc" | "cli" | "tick" | "hook" | "watcher" | "system";
export type ActionLayer = "intent" | "decision" | "effect" | "environment";

export interface ActionLogEntry {
  kind: string;
  outcome: ActionOutcome;
  actor?: ActionActor;
  surface?: ActionSurface;
  id?: string;
  opId?: string | null;
  cardId?: string | null;
  threadId?: string | null;
  runId?: string | null;
  stage?: string | null;
  cause?: string | null;
  durationMs?: number | null;
  detail?: unknown;
  at?: number;
}

export interface ActionLogRow {
  id: string;
  at: number;
  lastAt: number;
  kind: string;
  layer: ActionLayer;
  surface: ActionSurface;
  actor: ActionActor;
  opId: string | null;
  cardId: string | null;
  threadId: string | null;
  runId: string | null;
  stage: string | null;
  outcome: ActionOutcome;
  cause: string | null;
  durationMs: number | null;
  occurrences: number;
  detail: string;
}

export interface ActionLogFilter {
  cardId?: string;
  kind?: string;
  layer?: ActionLayer;
  outcome?: ActionOutcome;
  cause?: string;
  since?: number;
  until?: number;
  limit?: number;
}

export declare const ACTION_LOG_DETAIL_LIMIT: number;
export declare const ACTION_LOG_DEDUPE_WINDOW_MS: number;
export declare const ACTION_LOG_DEFAULT_LIMIT: number;

export declare function ensureActionLogTable(db: Db): void;
export declare function recordActionLog(
  db: Db,
  entry?: Partial<ActionLogEntry>,
  options?: {
    now?: () => number;
    randomId?: () => string;
    dedupeWindowMs?: number;
    detailLimit?: number;
  },
): { id: string; occurrences: number; deduped: boolean } | null;
export declare function listActionLog(db: Db, filter?: ActionLogFilter): ActionLogRow[];
export declare function summarizeActionLog(
  db: Db,
  filter?: ActionLogFilter,
): Array<{ kind: string; outcome: ActionOutcome; rows: number; events: number }>;
export declare function pruneActionLog(
  db: Db,
  options?: { now?: number; olderThanMs?: number; maxRows?: number },
): { deleted: number; kept: number };
export declare function parseSinceDuration(value: string): number | null;

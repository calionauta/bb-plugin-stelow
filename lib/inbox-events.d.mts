export type InboxEventInput = {
  id: string;
  cardId: string;
  kind: "question" | "error" | "paused" | "completed";
  summary: string;
  dedupeKey: string;
  occurredAt: number;
};

export type InboxResolutionReason = "answered" | "superseded" | "resumed" | "completed" | "archived";

export declare const RESOLUTION_REASONS: InboxResolutionReason[];

export declare function ensureInboxResolvedReasonColumn(db: { prepare(query: string): { all(): Array<{ name: string }> } }): void;

export declare function ensureInboxSeverityColumns(db: { prepare(query: string): { all(): Array<{ name: string }> } }): void;

export function insertInboxEvent(db: { prepare(query: string): { run(...values: unknown[]): { changes: number } } }, event: InboxEventInput): boolean;
export function questionInboxDedupeKey(cardId: string, interactionId: string): string;
export function markQuestionsAnswered(db: { prepare(query: string): { run(...values: unknown[]): { changes: number } } }, input: {
  cardId: string;
  interactionIds: string[];
  occurredAt: number;
}): number;
export function syncQuestionInboxEvents(db: { prepare(query: string): { run(...values: unknown[]): { changes: number } } }, input: {
  cardId: string;
  interactionIds: string[];
  occurredAt: number;
  createId: () => string;
  summary: string;
}): { inserted: number; resolved: number; reopened: number; pausedSuperseded: number };
export function resolveActionInboxEvents(db: { prepare(query: string): { run(...values: unknown[]): { changes: number } } }, cardId: string, resolvedAt: number, kinds?: Array<"question" | "error" | "paused">, reason?: InboxResolutionReason | null): number;
export function listInboxEvents(db: { prepare(query: string): { all(): unknown[] } }, includeArchived: boolean): unknown[];
export function hasPendingReview(db: { prepare(query: string): { get(...values: unknown[]): unknown } }, cardId: string): boolean;
export declare function countsForInboxBadge(entry: { kind: string; archivedAt: number | null; readAt?: number | null; resolvedAt?: number | null; occurredAt: number }, nowMs?: number): boolean;
export declare const STALLED_ESCALATION_MS: number;
export declare function stalledDays(idleMs: number): number;
export declare function escalatePausedSummary(summary: unknown, idleMs: number): string;
export declare function refreshStalledPaused(db: { prepare(query: string): { all(...values: unknown[]): Array<{ id: string; summary: string; occurred_at: number }>; run(...values: unknown[]): { changes: number } } }, input: { cardId: string; nowMs: number }): number;

export declare function refreshEventSeverity(db: { prepare(query: string): { all(...values: unknown[]): unknown[]; get(...values: unknown[]): unknown; run(...values: unknown[]): { changes: number } } }, input: { cardId: string; nowMs: number }): number;

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
}): { inserted: number; resolved: number; reopened: number };
export function resolveActionInboxEvents(db: { prepare(query: string): { run(...values: unknown[]): { changes: number } } }, cardId: string, resolvedAt: number, kinds?: Array<"question" | "error" | "paused">, reason?: InboxResolutionReason | null): number;
export function syncQuestionInboxEvents(db: { prepare(query: string): { run(...values: unknown[]): { changes: number } } }, input: {
  cardId: string;
  interactionIds: string[];
  occurredAt: number;
  createId: () => string;
  summary: string;
}): { inserted: number; resolved: number; reopened: number };
export function resolveActionInboxEvents(db: { prepare(query: string): { run(...values: unknown[]): { changes: number } } }, cardId: string, resolvedAt: number, kinds?: Array<"question" | "error" | "paused">): number;
export function listInboxEvents(db: { prepare(query: string): { all(): unknown[] } }, includeArchived: boolean): unknown[];
export declare function countsForInboxBadge(entry: { kind: string; archivedAt: number | null; readAt?: number | null; resolvedAt?: number | null; occurredAt: number }, nowMs?: number): boolean;

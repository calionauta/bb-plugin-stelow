export type InboxEventInput = {
  id: string;
  cardId: string;
  kind: "question" | "error" | "paused" | "completed";
  summary: string;
  dedupeKey: string;
  occurredAt: number;
};

export function insertInboxEvent(db: { prepare(query: string): { run(...values: unknown[]): { changes: number } } }, event: InboxEventInput): boolean;
export function resolveActionInboxEvents(db: { prepare(query: string): { run(...values: unknown[]): { changes: number } } }, cardId: string, resolvedAt: number, kinds?: Array<"question" | "error" | "paused">): number;
export function listInboxEvents(db: { prepare(query: string): { all(): unknown[] } }, includeArchived: boolean): unknown[];
export declare const COMPLETED_BADGE_DAYS: number;
export declare function countsForInboxBadge(entry: { kind: string; archivedAt: number | null; readAt?: number | null; resolvedAt?: number | null; occurredAt: number }, nowMs?: number): boolean;

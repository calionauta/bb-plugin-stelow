export function shouldRecordPersistFailure(input: {
  persisted: boolean;
  error: string | null | undefined;
}): boolean;

export function persistFailureTrailLine(input: {
  threadId: string;
  error: string;
}): string;

export interface PersistFailureInboxEvent {
  card: { id: string };
  kind: "error";
  summary: string;
  dedupeKey: string;
  occurredAt: number;
}

export function persistFailureInboxEvent(input: {
  cardId: string;
  error: string;
}): PersistFailureInboxEvent;

export type InboxNotification = {
  id: string;
  cardId: string;
  cardName: string;
  projectName: string;
  cardKind: "build" | "research" | "explore";
  kind: "question" | "error" | "paused" | "completed";
  summary: string;
  occurredAt: number;
  readAt: number | null;
  resolvedAt: number | null;
  archivedAt: number | null;
  severity: number;
  severityReasons: string[];
  holderCardId: string | null;
  holderFile: string | null;
};

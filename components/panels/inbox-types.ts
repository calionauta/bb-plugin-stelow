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
  /** The question this row is about, captured at mint; null on legacy rows. */
  questionSummary?: string | null;
  /** How many questions the row covers, when the batch had more than one. */
  questionCount?: number | null;
  /** "split" when the open batch is a split proposal; gates the narrow door. */
  questionKind?: "split" | "standard" | null;
};

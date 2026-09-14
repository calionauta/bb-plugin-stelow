export type InboxEventPresentationInput = {
  kind: "question" | "error" | "paused" | "completed";
  occurredAt: number;
  resolvedAt: number | null;
  archivedAt: number | null;
};

export type InboxFilterInput = InboxEventPresentationInput & { readAt: number | null };

export const INBOX_EVENT_LABELS: Record<InboxEventPresentationInput["kind"], string>;

export function inboxEventPresentation(event: InboxEventPresentationInput): {
  label: string;
  tone: string | null;
  stateAt: number;
  stateLabel: "Resolved" | "Archived" | null;
};
export function isOpenInboxAction(event: InboxEventPresentationInput | null): boolean;
export function inboxFilterEntries<T extends InboxFilterInput>(entries: T[], filter: "unread" | "resolved" | "archived" | "all"): T[];

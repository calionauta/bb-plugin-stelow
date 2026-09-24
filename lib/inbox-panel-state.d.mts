export type InboxPanelNotification = {
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
};

export function inboxVisibleEntries(
  notifications: InboxPanelNotification[],
  filter: "attention" | "resolved" | "archived" | "all",
  unreadOnly: boolean,
): InboxPanelNotification[];
export function inboxAction(entry: InboxPanelNotification): "archive" | "restore";
export function inboxLoadFailure(error: string | null, notifications: InboxPanelNotification[]): boolean;
export function inboxPanelState(
  firstLoad: boolean,
  error: string | null,
  notifications: InboxPanelNotification[],
): "loading" | "failure" | "content";
export function inboxBadgeCount(notifications: InboxPanelNotification[]): number;

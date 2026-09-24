import { countsForInboxBadge } from "./inbox-events.mjs";
import { inboxFilterEntries, unreadInboxEntries } from "./inbox-event-presentation.mjs";

export function inboxVisibleEntries(notifications, filter, unreadOnly) {
  return unreadInboxEntries(inboxFilterEntries(notifications, filter), unreadOnly);
}

export function inboxAction(entry) {
  return entry.archivedAt ? "restore" : "archive";
}

export function inboxLoadFailure(error, notifications) {
  return Boolean(error && notifications.length === 0);
}

export function inboxBadgeCount(notifications) {
  return notifications.filter((entry) => countsForInboxBadge(entry)).length;
}

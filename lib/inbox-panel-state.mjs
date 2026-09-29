import { countsForInboxBadge } from "./inbox-events.mjs";
import { inboxFilterEntries, unreadInboxEntries } from "./inbox-event-presentation.mjs";

export function inboxVisibleEntries(notifications, filter, unreadOnly) {
  return unreadInboxEntries(inboxFilterEntries(notifications, filter), unreadOnly);
}

// Which way round the item's own button points.
//
// Read state, not archive state: the button is the reversible one, so it has
// to be driven by `readAt`. Keyed off `archivedAt` it offered "Mark as read"
// on an item that was already read, and offered "Show again" to a reader who
// had never seen the item — and an item set aside is a different thing, shown
// in its own place.
export function inboxAction(entry) {
  return entry.readAt ? "restore" : "archive";
}

export function inboxLoadFailure(error, notifications) {
  return Boolean(error && notifications.length === 0);
}

export function inboxPanelState(firstLoad, error, notifications) {
  if (firstLoad) return "loading";
  if (inboxLoadFailure(error, notifications)) return "failure";
  return "content";
}

export function inboxBadgeCount(notifications) {
  return notifications.filter((entry) => countsForInboxBadge(entry)).length;
}

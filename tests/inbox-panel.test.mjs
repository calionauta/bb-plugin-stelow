import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  inboxAction,
  inboxBadgeCount,
  inboxLoadFailure,
  inboxPanelState,
  inboxVisibleEntries,
} from "../lib/inbox-panel-state.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const panel = readFileSync(join(root, "components/panels/inbox-panel.tsx"), "utf8");

const notification = (overrides = {}) => ({
  id: "event-1",
  cardId: "card-1",
  cardName: "Launch",
  projectName: "Project",
  cardKind: "build",
  kind: "question",
  summary: "Choose a direction",
  occurredAt: 100,
  readAt: null,
  resolvedAt: null,
  archivedAt: null,
  severity: 1,
  severityReasons: [],
  ...overrides,
});

const attention = notification();
const read = notification({ id: "event-2", readAt: 200 });
const archived = notification({ id: "event-3", archivedAt: 300 });
const resolved = notification({ id: "event-4", resolvedAt: 400 });

assert.deepEqual(
  inboxVisibleEntries([attention, read, archived, resolved], "attention", false).map((entry) => entry.id),
  ["event-1", "event-2"],
  "attention includes active work even when read, while archived and resolved history stay out",
);
assert.deepEqual(
  inboxVisibleEntries([attention, read, archived, resolved], "all", true).map((entry) => entry.id),
  ["event-1", "event-4"],
  "unread-only filtering applies after the selected view",
);
assert.deepEqual(
  inboxVisibleEntries([attention, read, archived, resolved], "archived", false).map((entry) => entry.id),
  ["event-3"],
  "set-aside items live in their own filter, so Bring back is reachable from the panel",
);
// The item's button is the reversible one, so it is driven by read state.
// Keyed off the archive flag it offered "Mark as read" to something already
// read, and offered "Show again" to a reader who had never seen the item.
assert.equal(inboxAction(attention), "archive", "an unread item can be marked as read");
assert.equal(inboxAction(read), "restore", "a read item can be marked unread again");
assert.equal(inboxAction(archived), "archive", "a set-aside item is not the read toggle's business");
assert.equal(inboxBadgeCount([attention, read, archived, resolved]), 2, "badge counts unread active action items, including unread completions");
assert.equal(inboxLoadFailure("RPC failed", []), true, "a failed first load has a retryable failure state");
assert.equal(inboxLoadFailure("RPC failed", [attention]), false, "a background refresh failure preserves stale content");
assert.equal(inboxPanelState(true, null, []), "loading", "the first successful request remains in the loading state");
assert.equal(inboxPanelState(false, "RPC failed", []), "failure", "an initial request failure renders the retryable failure state");
assert.equal(inboxPanelState(false, "RPC failed", [attention]), "content", "a refresh failure keeps stale content visible");
assert.equal(inboxPanelState(false, null, []), "content", "a successful empty load renders the empty state");

assert.match(panel, /rpc\.call\("markNotificationRead"/, "opening an unread item acknowledges it before navigation");
assert.match(
  panel,
  /rpc\.call\(method, \{ notificationId: entry\.id \}\)/,
  "the item's own button owns both read transitions, and the archive RPC is not what it calls",
);
assert.doesNotMatch(
  panel,
  /archiveNotification[\s\S]{0,40}Stop showing this update/,
  "the archive RPC is not dressed as 'you are done with this' — the item's read action must not read as the archive",
);

// Read and handled are different facts, which is why an item has TWO actions.
// Collapsing them into one made "Mark as read" look broken: the item stayed in
// Needs attention (correct — it still needs action) and the badge did not move,
// so the click read as a no-op. Both actions are back, named for the update.
const actions = readFileSync(new URL("../components/panels/inbox-item-actions.tsx", import.meta.url), "utf8");
assert.match(actions, /Mark as read/, "the read action is named for the update, not the card");
assert.match(actions, /Set aside/, "and the dismissal the reader actually wanted is still reachable");
assert.match(actions, /Bring back/, "with its way back, because set-aside is reversible");
assert.match(
  actions,
  /still needs you[\s\S]*Read filter/,
  "the read action says the item stays and where it goes — a click that appears to do nothing is a phantom affordance",
);
assert.doesNotMatch(actions, />[^<]*Archive[^<]*</, "no card-word survives in anything a reader sees");
assert.match(panel, /notifyOnError: false[\s\S]*itemCountKey: "notifications"/, "Inbox load failures remain inline instead of producing a toast");
assert.match(panel, /inboxVisibleEntries\(notifications, filter, unreadOnly\)/, "the rendered list uses the tested filter pipeline");
assert.match(panel, /setUnreadOnly\(event\.target\.checked\)/, "the unread filter remains a user-controlled behavior");

console.log("inbox panel test ok: filters, actions, badge, and failure state");

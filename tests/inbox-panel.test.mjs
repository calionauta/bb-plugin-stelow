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
assert.equal(inboxAction(attention), "archive", "active items archive");
assert.equal(inboxAction(archived), "restore", "archived items restore");
assert.equal(inboxBadgeCount([attention, read, archived, resolved]), 2, "badge counts unread active action items, including unread completions");
assert.equal(inboxLoadFailure("RPC failed", []), true, "a failed first load has a retryable failure state");
assert.equal(inboxLoadFailure("RPC failed", [attention]), false, "a background refresh failure preserves stale content");
assert.equal(inboxPanelState(true, null, []), "loading", "the first successful request remains in the loading state");
assert.equal(inboxPanelState(false, "RPC failed", []), "failure", "an initial request failure renders the retryable failure state");
assert.equal(inboxPanelState(false, "RPC failed", [attention]), "content", "a refresh failure keeps stale content visible");
assert.equal(inboxPanelState(false, null, []), "content", "a successful empty load renders the empty state");

assert.match(panel, /rpc\.call\("markNotificationRead"/, "opening an unread item acknowledges it before navigation");
assert.match(panel, /rpc\.call\("archiveNotification"[\s\S]*rpc\.call\("restoreNotification"/, "the extracted panel owns both archive transitions");
assert.match(panel, /notifyOnError: false[\s\S]*itemCountKey: "notifications"/, "Inbox load failures remain inline instead of producing a toast");
assert.match(panel, /inboxVisibleEntries\(notifications, filter, unreadOnly\)/, "the rendered list uses the tested filter pipeline");
assert.match(panel, /setUnreadOnly\(event\.target\.checked\)/, "the unread filter remains a user-controlled behavior");

console.log("inbox panel test ok: filters, actions, badge, and failure state");

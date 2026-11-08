import assert from "node:assert/strict";
import {
  inboxAction,
  inboxBadgeCount,
  inboxLoadFailure,
  inboxPanelState,
  inboxVisibleEntries,
} from "../lib/inbox-panel-state.mjs";

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

// Read and handled are different facts, which is why an item has TWO actions:
// the read toggle (driven by read state, proven above) and the set-aside.
// The toggle owns both read transitions keyed off read state — never the
// archive flag — so it can never offer "Mark as read" to something already
// read, and a set-aside item stays out of the toggle's business.
{
  const readArchived = notification({ id: "event-5", readAt: 200, archivedAt: 300 });
  assert.equal(inboxAction(readArchived), "restore", "a read item set aside still toggles by read state");
  assert.deepEqual(
    inboxVisibleEntries([attention, read, archived, resolved, readArchived], "attention", true).map((entry) => entry.id),
    ["event-1"],
    "unread-only attention shows only the unread active item — a click that appears to do nothing is a phantom affordance",
  );
  assert.deepEqual(
    inboxVisibleEntries([attention, read, archived, resolved, readArchived], "archived", false).map((entry) => entry.id),
    ["event-3", "event-5"],
    "set-aside stays reversible from its own filter",
  );
  assert.equal(inboxBadgeCount([attention, read, archived, resolved, readArchived]), 2, "the badge still counts unread active action items only");
  assert.deepEqual(
    inboxVisibleEntries([attention, read, archived, resolved], "all", false).map((entry) => entry.id),
    ["event-1", "event-2", "event-4"],
    "the all view keeps active plus resolved history, never set-aside",
  );
}

console.log("inbox panel test ok: filters, actions, badge, and failure state");

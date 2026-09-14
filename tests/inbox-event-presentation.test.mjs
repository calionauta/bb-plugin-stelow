import assert from "node:assert/strict";
import { inboxEventPresentation, isOpenInboxAction } from "../lib/inbox-event-presentation.mjs";

const openQuestion = { kind: "question", occurredAt: 10, resolvedAt: null, archivedAt: null };
assert.deepEqual(inboxEventPresentation(openQuestion), { label: "Needs a decision", tone: null, stateAt: 10, stateLabel: null });
assert.equal(isOpenInboxAction(openQuestion), true);

const resolvedQuestion = { ...openQuestion, resolvedAt: 20 };
assert.deepEqual(inboxEventPresentation(resolvedQuestion), { label: "Decision resolved", tone: "bg-muted text-muted-foreground", stateAt: 20, stateLabel: "Resolved" });
assert.equal(isOpenInboxAction(resolvedQuestion), false);

const archivedError = { kind: "error", occurredAt: 10, resolvedAt: null, archivedAt: 30 };
assert.deepEqual(inboxEventPresentation(archivedError), { label: "Archived Inbox update", tone: "bg-muted text-muted-foreground", stateAt: 30, stateLabel: "Archived" });
assert.equal(isOpenInboxAction(archivedError), false);

assert.equal(isOpenInboxAction({ kind: "completed", occurredAt: 10, resolvedAt: null, archivedAt: null }), false);

// Resolved reasons name HOW each item cleared; legacy rows without a reason
// keep the generic kind label instead of an invented cause.
assert.equal(inboxEventPresentation({ ...resolvedQuestion, resolvedReason: "answered" }).label, "Answered by you");
assert.equal(inboxEventPresentation({ ...resolvedQuestion, resolvedReason: "superseded" }).label, "Withdrawn by the worker");
assert.equal(inboxEventPresentation({ ...resolvedQuestion, resolvedReason: "completed" }).label, "Closed with the card");
assert.equal(inboxEventPresentation({ kind: "error", occurredAt: 10, resolvedAt: 20, resolvedReason: "resumed", archivedAt: null }).label, "Recovered on its own");
assert.equal(inboxEventPresentation({ kind: "paused", occurredAt: 10, resolvedAt: 20, resolvedReason: "resumed", archivedAt: null }).label, "Work resumed");
assert.equal(inboxEventPresentation({ kind: "paused", occurredAt: 10, resolvedAt: 20, resolvedReason: "completed", archivedAt: null }).label, "Completed");
assert.equal(inboxEventPresentation({ kind: "error", occurredAt: 10, resolvedAt: 20, resolvedReason: "archived", archivedAt: null }).label, "Closed with the card");
assert.equal(inboxEventPresentation({ ...resolvedQuestion, resolvedReason: "bogus" }).label, "Decision resolved", "unknown reasons fall back to the kind label");
console.log("inbox event presentation test ok: active, resolved, archived, and informational states");

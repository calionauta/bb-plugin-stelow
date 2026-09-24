import assert from "node:assert/strict";
import { inboxEventDescription, inboxEventPresentation, inboxEventText, inboxEventTime, isOpenInboxAction, unreadInboxEntries } from "../lib/inbox-event-presentation.mjs";

const openQuestion = { kind: "question", occurredAt: 10, resolvedAt: null, archivedAt: null };
assert.deepEqual(inboxEventPresentation(openQuestion), { label: "Needs a decision", tone: null, stateAt: 10, stateLabel: null });
assert.equal(isOpenInboxAction(openQuestion), true);

const resolvedQuestion = { ...openQuestion, resolvedAt: 20 };
assert.deepEqual(inboxEventPresentation(resolvedQuestion), { label: "Decision resolved", tone: "bg-muted text-muted-foreground", stateAt: 20, stateLabel: "Resolved" });
assert.equal(isOpenInboxAction(resolvedQuestion), false);

const archivedError = { kind: "error", occurredAt: 10, resolvedAt: null, archivedAt: 30 };
assert.deepEqual(inboxEventPresentation(archivedError), { label: "Archived Inbox update", tone: "bg-muted text-muted-foreground", stateAt: 30, stateLabel: "Archived" });
assert.equal(isOpenInboxAction(archivedError), false);

// A completion is never an action badge (nothing is blocked), but while it is
// open it names the request it really is: finished work to review.
const openCompletion = { kind: "completed", occurredAt: 10, resolvedAt: null, archivedAt: null };
assert.equal(isOpenInboxAction(openCompletion), true, "an unread completion asks for human review");
assert.deepEqual(inboxEventPresentation(openCompletion), { label: "Ready for review", tone: null, stateAt: 10, stateLabel: null });
assert.equal(inboxEventPresentation({ ...openCompletion, resolvedAt: 20, resolvedReason: "completed" }).label, "Completed", "a closed completion reads as history again");
assert.deepEqual(unreadInboxEntries([{ id: "read", readAt: 1 }, { id: "unread", readAt: null }], true).map((entry) => entry.id), ["unread"], "Unread only is a secondary view filter");
assert.equal(unreadInboxEntries([{ id: "read", readAt: 1 }], false).length, 1, "All updates keeps read history in the selected tab");

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

// Description: kept history names itself, open events speak their summary.
assert.equal(inboxEventDescription({ ...openQuestion, summary: "Answer this" }), "Answer this", "open events read their summary");
assert.equal(inboxEventDescription({ ...resolvedQuestion, summary: "Answer this" }), "This Inbox update is kept for history.", "kept rows never re-ask");
// Text: the label prefixes unless already inside the description.
assert.equal(inboxEventText({ ...openQuestion, summary: "Answer this" }), "Needs a decision. Answer this", "label prefixes a bare summary");
assert.equal(inboxEventText({ ...openQuestion, summary: "Needs a decision: pick one" }), "Needs a decision: pick one", "an embedded label is never doubled");
// Time: state time carries its label, open events read the relative clock.
assert.match(inboxEventTime({ ...resolvedQuestion, summary: "x" }), /^Resolved /, "resolved time carries its state");
assert.match(inboxEventTime({ ...openQuestion, summary: "x" }), /(Just now|\d+[mhd] ago|Yesterday)$/, "open time reads the relative clock");
console.log("inbox event presentation test ok: active, resolved, archived, and informational states");

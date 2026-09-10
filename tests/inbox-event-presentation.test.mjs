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
console.log("inbox event presentation test ok: active, resolved, archived, and informational states");

export const INBOX_EVENT_LABELS = {
  question: "Needs a decision",
  error: "Worker failed",
  paused: "Paused",
  completed: "Completed",
};

const RESOLVED_LABELS = {
  question: "Decision resolved",
  error: "Issue resolved",
  paused: "Work resumed",
  completed: "Completed",
};

// Presentation is derived from lifecycle, never just event kind. A historical
// question must not read as an instruction to answer it again.
export function inboxEventPresentation(event) {
  if (event.archivedAt != null) {
    return { label: "Archived Inbox update", tone: "bg-muted text-muted-foreground", stateAt: event.archivedAt, stateLabel: "Archived" };
  }
  if (event.resolvedAt != null) {
    return { label: RESOLVED_LABELS[event.kind] ?? "Resolved", tone: "bg-muted text-muted-foreground", stateAt: event.resolvedAt, stateLabel: "Resolved" };
  }
  return { label: INBOX_EVENT_LABELS[event.kind] ?? "Inbox update", tone: null, stateAt: event.occurredAt, stateLabel: null };
}

export function isOpenInboxAction(event) {
  return event != null
    && event.archivedAt == null
    && event.resolvedAt == null
    && event.kind !== "completed";
}

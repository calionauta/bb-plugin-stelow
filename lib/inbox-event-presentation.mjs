// An OPEN completion is not history yet: it is finished work a human has to
// look at, so it reads as the request it is. Once resolved it falls back to
// the RESOLVED_LABELS below ("Completed"), which is why the two differ.
export const INBOX_EVENT_LABELS = {
  question: "Needs a decision",
  error: "Worker failed",
  paused: "Paused",
  completed: "Ready for review",
};

const RESOLVED_LABELS = {
  question: "Decision resolved",
  error: "Issue resolved",
  paused: "Work resumed",
  completed: "Completed",
};

// How each resolution reads. Legacy rows predate resolved_reason and keep
// the generic kind label above — honest about what is unknown.
const RESOLVED_HOW_LABELS = {
  "question:answered": "Answered by you",
  "question:superseded": "Withdrawn by the worker",
  "question:completed": "Closed with the card",
  "question:archived": "Closed with the card",
  "error:resumed": "Recovered on its own",
  "error:completed": "Closed with the card",
  "error:archived": "Closed with the card",
  "paused:resumed": "Work resumed",
  "paused:completed": "Completed",
  "paused:archived": "Closed with the card",
};

// Presentation is derived from lifecycle, never just event kind. A historical
// question must not read as an instruction to answer it again.
export function inboxEventPresentation(event) {
  if (event.archivedAt != null) {
    return { label: "Archived Inbox update", tone: "bg-muted text-muted-foreground", stateAt: event.archivedAt, stateLabel: "Archived" };
  }
  if (event.resolvedAt != null) {
    const how = RESOLVED_HOW_LABELS[`${event.kind}:${event.resolvedReason ?? ""}`] ?? RESOLVED_LABELS[event.kind] ?? "Resolved";
    return { label: how, tone: "bg-muted text-muted-foreground", stateAt: event.resolvedAt, stateLabel: "Resolved" };
  }
  return { label: INBOX_EVENT_LABELS[event.kind] ?? "Inbox update", tone: null, stateAt: event.occurredAt, stateLabel: null };
}

export function isOpenInboxAction(event) {
  if (event == null || event.archivedAt != null || event.resolvedAt != null) return false;
  // A completion is review work, not a blocked workflow. It stays visible in
  // Needs attention only until opening the Done card acknowledges it.
  return event.kind !== "completed" || event.readAt == null;
}

export function inboxFilterEntries(entries, filter) {
  switch (filter) {
    case "attention":
      return entries.filter(isOpenInboxAction);
    case "resolved":
      return entries.filter((event) => event.archivedAt == null && event.resolvedAt != null && event.kind !== "completed");
    case "archived":
      return entries.filter((event) => event.archivedAt != null);
    case "all":
      return entries.filter((event) => event.archivedAt == null);
    default:
      return [];
  }
}

// Read state is orthogonal to lifecycle. Apply this only after the primary
// Inbox tab filter so Needs attention keeps its badge semantics: unread is a
// view preference, never a claim that read work no longer needs action.
export function unreadInboxEntries(entries, unreadOnly = false) {
  const rows = Array.isArray(entries) ? entries : [];
  return unreadOnly ? rows.filter((event) => event?.readAt == null) : rows;
}

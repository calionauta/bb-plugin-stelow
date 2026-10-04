import { relativeTime } from "./relative-time.mjs";

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
    // Set aside by a person, not by the card: the label says what happened to
    // the update, and stays clear of "Archived", which is a card's fate.
    return { label: "Set aside", tone: "bg-muted text-muted-foreground", stateAt: event.archivedAt, stateLabel: "Set aside" };
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
    // "Read", not "Archived". A notification is a notice, not a card: the word
    // archive belongs to a card's lifecycle, and borrowing it made a button on
    // a notification read as an action on the card it named. Read state is the
    // truth here — it is set by opening the item and cleared by marking it
    // unread, both reversible, neither touching the card.
    case "read":
      return entries.filter((event) => event.archivedAt == null && event.readAt != null);
    case "archived":
      // Set-aside items live here and only here: every other filter is the
      // active inbox, so without this case a dismissal is a one-way door and
      // "Bring back" is unreachable.
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

// One-line description: a kept history row names itself historical,
// otherwise the event summary speaks.
export function inboxEventDescription(event) {
  const { stateLabel } = inboxEventPresentation(event);
  return stateLabel ? "This Inbox update is kept for history." : event.summary;
}

// Full text: the label prefixes the description unless already inside it.
export function inboxEventText(event) {
  const { label } = inboxEventPresentation(event);
  const description = inboxEventDescription(event);
  return description.toLowerCase().includes(label.toLowerCase()) ? description : `${label}. ${description}`;
}

// Severity reasons that merely restate the row's own label read as noise
// ("Needs a decision" beside "needs decision"). Word-level, because the two
// are rarely byte-identical. Reasons that add information a glance cannot
// get from the label — stall age, error counts — survive.
const REASON_STOPWORDS = new Set(["a", "an", "the", "for", "to", "of", "by", "on", "your"]);

function reasonWords(value) {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word && !REASON_STOPWORDS.has(word));
}

export function inboxDisplayReasons(event) {
  const reasons = Array.isArray(event?.severityReasons) ? event.severityReasons : [];
  if (reasons.length === 0 || event?.resolvedAt != null) return [];
  const labelWords = new Set(reasonWords(inboxEventPresentation(event).label));
  return reasons.filter((reason) => {
    if (typeof reason !== "string") return false;
    const parts = reasonWords(reason);
    return parts.length > 0 && !parts.every((part) => labelWords.has(part));
  });
}

// Event time: state time with its label, else the relative clock.
export function inboxEventTime(event) {
  const { stateAt, stateLabel } = inboxEventPresentation(event);
  return stateLabel ? `${stateLabel} ${relativeTime(stateAt)}` : relativeTime(stateAt);
}

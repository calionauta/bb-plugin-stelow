/**
 * Card lifecycle updates when new human work reaches an existing card.
 *
 * A completed card is a durable result, not a lock: a new request starts a
 * new worker turn. We deliberately retain its recorded workflow checkpoint
 * until the worker advances state.md itself, so the database cannot claim a
 * stage that the workflow state file does not own.
 */
export function statusForNewCardWork({ kind, status, stage }) {
  if (status === "completed") return { status: "in-progress", reopened: true };
  if (kind === "build" && status === "draft" && stage !== "triage") return { status: "in-progress", reopened: false };
  return { status, reopened: false };
}

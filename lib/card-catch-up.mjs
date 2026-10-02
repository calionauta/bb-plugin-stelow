/**
 * Catch up: what changed on this card since the reader last looked.
 *
 * This is a DETERMINISTIC fact list, not a model answer. Every line is derived
 * from a row that already exists — a stage transition, an inbox event, an
 * artifact registration — and the module has no model in it at all. That
 * ordering is deliberate: rules first, a model only for the semantic part, and
 * the semantic part here is optional phrasing that never adds a fact
 * (`docs/decision-routing.md`).
 *
 * The `since` anchor is the newest read this card has recorded. When there is
 * none, the card has never been looked at, and the honest answer is "everything
 * since it was created" rather than a guess about where the reader stopped.
 *
 * An empty list is a true and useful answer — "nothing changed" — and the
 * caller renders it as such rather than inventing content to fill the space.
 */

/** Fact kinds, in the order they are presented. */
export const CATCH_UP_KINDS = ["stage", "question", "answer", "blocked", "resumed", "error", "completed"];

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The anchor: when the reader last looked at this card.
 *
 * Inbox `read_at` is the only per-card read the host records, and only for
 * completions — a person opening a Done card. So the newest such stamp is the
 * anchor, and its absence means the card has never been read rather than that
 * the reader is caught up. Returns `{ since, basis }` where basis names which
 * of the two it is, so the surface can say "since you last looked" or "since
 * this card was created" without guessing which one it holds.
 */
export function catchUpAnchor({ readAts, createdAt }) {
  const reads = (Array.isArray(readAts) ? readAts : [])
    .map(finite)
    .filter((value) => value !== null);
  if (reads.length > 0) {
    return { since: Math.max(...reads), basis: "last-read" };
  }
  return { since: finite(createdAt) ?? 0, basis: "created" };
}

/** One inbox row → the fact it records, or null for a row that is not a change. */
function inboxFact(row) {
  const at = finite(row?.occurred_at);
  if (at === null) return null;
  const kind = String(row?.kind ?? "");
  const text = typeof row?.summary === "string" ? row.summary : "";
  if (kind === "question") {
    return row.resolved_at == null
      ? { kind: "question", at, text, open: true }
      : { kind: "answer", at, text, open: false };
  }
  if (kind === "paused") return { kind: "blocked", at, text, open: row.resolved_at == null };
  if (kind === "error") return { kind: "error", at, text, open: row.resolved_at == null };
  if (kind === "completed") return { kind: "completed", at, text, open: row.resolved_at == null };
  return null;
}

/**
 * Build the fact list.
 *
 * `stageEvents` are `{ stage, entered_at }` rows and `inboxEvents` are inbox
 * rows. Everything at or before `since` is dropped — the list is a delta, and a
 * "what changed" that repeats what the reader already saw is noise wearing a
 * report's clothes.
 *
 * Sorted oldest-first: a catch-up reads as a sequence, and a list that opens
 * with the newest event makes the reader reconstruct the order themselves.
 *
 * Artifacts are deliberately NOT a fact kind. The manifest records a path and a
 * stage, never a registration time, so "this artifact is new since you looked"
 * cannot be derived from it — and a fact list that guesses at timestamps is
 * exactly the kind of claim this module exists to avoid making.
 */
export function catchUpFacts({ since, stageEvents = [], inboxEvents = [] } = {}) {
  const from = finite(since) ?? 0;
  const facts = [];
  for (const event of Array.isArray(stageEvents) ? stageEvents : []) {
    const at = finite(event?.entered_at);
    if (at === null || at <= from) continue;
    facts.push({ kind: "stage", at, stage: String(event?.stage ?? "") });
  }
  for (const row of Array.isArray(inboxEvents) ? inboxEvents : []) {
    const fact = inboxFact(row);
    if (fact && fact.at > from) facts.push(fact);
  }
  return facts.sort((a, b) => a.at - b.at || CATCH_UP_KINDS.indexOf(a.kind) - CATCH_UP_KINDS.indexOf(b.kind));
}

/**
 * The one-line reading of the list.
 *
 * A card with nothing to report says so in one sentence — that IS the answer,
 * not an empty state to be filled. The count is named because a reader deciding
 * whether to open the card wants the size of the delta first.
 */
export function catchUpSummary(facts, { basis }) {
  const count = Array.isArray(facts) ? facts.length : 0;
  const scope = basis === "last-read" ? "since you last looked" : "since this card was created";
  if (count === 0) return `Nothing changed ${scope}.`;
  const open = facts.filter((fact) => fact.open).length;
  const waiting = open > 0 ? ` ${open} still waiting on you.` : "";
  return `${count} change${count === 1 ? "" : "s"} ${scope}.${waiting}`;
}

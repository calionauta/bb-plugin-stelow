/**
 * Trackable event log (SQLite-backed, append-only).
 *
 * Every committed status-relevant decision — advance entries, scope-sync
 * outcomes, rework-scope creation, completion — appends one row with its
 * actor and evidence. Current statuses stay projections (stelow.json for
 * desired, evidence files for observed); this log is the causal trail that
 * answers "who decided what, on which evidence, when". Repair-friendly:
 * replaying a card's rows rebuilds its decision history without
 * re-executing anything.
 *
 * Logging never blocks: callers wrap appends so a logging failure reads as
 * a missing trail row, never as a workflow refusal.
 */

export function ensureTrackableEventsTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS trackable_events (
    card_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    trackable_id TEXT NOT NULL,
    transition TEXT NOT NULL,
    actor TEXT NOT NULL,
    evidence TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (card_id, seq)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_trackable_events_card ON trackable_events (card_id)`);
}

/** Append one event; returns its per-card sequence number. */
export function recordTrackableEvent(db, { cardId, kind, trackableId, transition, actor, evidence = "", at = Date.now() } = {}) {
  if (!cardId || !kind || !trackableId || !transition || !actor) return null;
  const row = db.prepare("SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM trackable_events WHERE card_id = ?").get(cardId);
  const seq = (row && typeof row.maxSeq === "number" ? row.maxSeq : 0) + 1;
  db.prepare(
    "INSERT INTO trackable_events (card_id, seq, at, kind, trackable_id, transition, actor, evidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(cardId, seq, at, kind, trackableId, transition, actor, typeof evidence === "string" ? evidence : "");
  return seq;
}

/** A card's trail, oldest first. */
export function listTrackableEvents(db, cardId) {
  if (!cardId) return [];
  return db.prepare(
    "SELECT card_id AS cardId, seq, at, kind, trackable_id AS trackableId, transition, actor, evidence FROM trackable_events WHERE card_id = ? ORDER BY seq ASC",
  ).all(cardId);
}

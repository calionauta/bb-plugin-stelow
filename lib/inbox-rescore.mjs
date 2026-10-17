/**
 * The severity rescore engine: one loop, two callers.
 *
 * Age escalation for open rows: a pause that crosses the stall window (or any
 * action that crosses the outer window) upgrades in place with fresh reasons.
 * Same-row updates only — resolution, badge, and board position never move.
 * Returns the upgraded count for realtime publishing.
 *
 * Kept apart from lib/inbox-events so the per-card path (a live card's own
 * rows, called from the claim sweep) and the fleet path share one loop: two
 * loops would be two places for the ladder to be applied differently, and the
 * second one would be wrong in a way only a reader of both files could see.
 */
import { scoreEventSeverity } from "./inbox-severity.mjs";
import { stallCount } from "./worker-ledger.mjs";

export const OPEN_ROW_COLUMNS = "id, card_id, kind, summary, occurred_at, severity, severity_reasons, occurrences";

export function rescoreOpenRows(db, rows, nowMs) {
  const update = db.prepare("UPDATE inbox_events SET severity = ?, severity_reasons = ? WHERE id = ?");
  let updated = 0;
  for (const row of rows) {
    try {
      // The row's OWN repetition count, not a count of rows. Counting rows meant
      // the signal only existed because duplicates were being created, so the
      // sweep re-derived a number from the very mess it should have prevented.
      const errorRepetitions = row.kind === "error" ? (row.occurrences ?? 1) : 0;
      const scored = scoreEventSeverity({ kind: row.kind, ageMs: nowMs - row.occurred_at, stallCount: stallCount(db, row.card_id), errorRepetitions });
      const reasons = JSON.stringify(scored.reasons);
      if (scored.severity !== row.severity || reasons !== (row.severity_reasons ?? "[]")) {
        updated += update.run(scored.severity, reasons, row.id).changes;
      }
    } catch { /* advisory only — a scoring failure keeps the stored tier */ }
  }
  return updated;
}

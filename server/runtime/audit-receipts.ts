/**
 * Attributing the two audit receipts on a card.
 *
 * A completed Build card carries two receipts whose names differ by one
 * word, so neither is self-explaining. The host's `audit.md` is the record of
 * what was verified, by which tests, at which checkout; Stelow's portable
 * `audit-trail.md` is the deterministic lineage projection the CLI owns. The
 * CLI never registers its own output (it would have to digest itself), so the
 * host is the one that attributes the trail to Audit and labels both —
 * instead of showing a receipt the audit produced as an unregistered
 * document.
 */
import { basename } from "node:path";
import {
  AUDIT_RECEIPT_FILE,
  AUDIT_RECEIPT_NOTE,
} from "../../lib/audit-receipt.mjs";
import {
  AUDIT_TRAIL_FILE,
  AUDIT_TRAIL_NOTE,
} from "../../lib/audit-trail-contract.mjs";

/** The note to show for an audit receipt, or null for any other file. */
export function auditReceiptNote(absolute: string): string | null {
  const name = basename(absolute);
  if (name === AUDIT_RECEIPT_FILE) return AUDIT_RECEIPT_NOTE;
  if (name === AUDIT_TRAIL_FILE) return AUDIT_TRAIL_NOTE;
  return null;
}

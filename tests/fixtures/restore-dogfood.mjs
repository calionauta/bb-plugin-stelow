/**
 * Dogfood: restore-archived-cards against the LIVE production database.
 *
 * The spec this closes said: "the live database is the fixture" and "the numbers
 * are the evidence, not the assertion that you checked." So this runs the real
 * shipped modules — restoreTargetStatus and reactivateRestorePending, not a
 * re-implementation — over the real rows, inside a transaction that is rolled
 * back. The card is therefore never actually mutated; what is proven is what the
 * code does to real data, which is the part that was untested.
 *
 * What this CANNOT prove, and does not claim: the host half. restoreCard also
 * flips the status and spawns a fresh worker, and that needs a running bb host
 * (the UI's Manage menu), which is not reachable from a script. Invariant 2 of
 * the spec, "a new worker", is therefore unverified here.
 */

import { DatabaseSync } from "node:sqlite";
import { restoreTargetStatus } from "../../server/runtime/card-restore.ts";
import { reactivateRestorePending } from "../../lib/card-restore-pending.mjs";

const DB_PATH = process.argv[2];
const CARD_ID = process.argv[3];

if (!DB_PATH || !CARD_ID) {
  console.error("usage: node restore-dogfood.mjs <db-path> <card-id>");
  process.exit(2);
}

const db = new DatabaseSync(DB_PATH);
const rows = (sql, ...params) => db.prepare(sql).all(...params);
const one = (sql, ...params) => db.prepare(sql).get(...params);

function snapshotEvents() {
  return rows(
    `SELECT id, kind, resolved_at, resolved_reason, archived_at
       FROM inbox_events WHERE card_id = ? ORDER BY kind, occurred_at`,
    CARD_ID,
  );
}

function fingerprint(list) {
  return list
    .map((r) => `${r.kind}:${r.resolved_at === null ? "open" : `closed(${r.resolved_reason ?? "null"})`}:arch=${r.archived_at === null ? "no" : "yes"}`)
    .join(" | ");
}

const card = one(`SELECT id, status, stage, last_error FROM cards WHERE id = ?`, CARD_ID);
if (!card) {
  console.error(`card ${CARD_ID} not found`);
  process.exit(1);
}

const before = snapshotEvents();
const globalBefore = {
  cards: one(`SELECT COUNT(*) AS n FROM cards`).n,
  archived: one(`SELECT COUNT(*) AS n FROM cards WHERE status = 'archived'`).n,
  events: one(`SELECT COUNT(*) AS n FROM inbox_events`).n,
  unresolved: one(`SELECT COUNT(*) AS n FROM inbox_events WHERE resolved_at IS NULL`).n,
};

console.log("=== BEFORE ===");
console.log(`card: status=${card.status} stage=${card.stage} last_error=${card.last_error === null ? "null" : "present"}`);
console.log(`events (${before.length}): ${fingerprint(before)}`);
console.log(`global: ${JSON.stringify(globalBefore)}`);

const expectedStatus = restoreTargetStatus(card.stage);
console.log("");
console.log("=== WHAT THE CODE DECIDES ===");
console.log(`restoreTargetStatus("${card.stage}") -> "${expectedStatus}"`);

const archiveTook = before.filter((r) => r.resolved_reason === "archived");
const byKind = {};
for (const row of archiveTook) byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
console.log(`rows the archive itself resolved: ${JSON.stringify(byKind)} (total ${archiveTook.length})`);

// Run the real code path, then undo it. The transaction is the safety property:
// the production rows are never left changed.
db.exec("BEGIN");
let result;
try {
  const outcome = reactivateRestorePending(db, { cardId: CARD_ID, lastError: card.last_error, occurredAt: Date.now() });
  result = outcome;
  const after = snapshotEvents();
  const globalAfter = {
    cards: one(`SELECT COUNT(*) AS n FROM cards`).n,
    archived: one(`SELECT COUNT(*) AS n FROM cards WHERE status = 'archived'`).n,
    events: one(`SELECT COUNT(*) AS n FROM inbox_events`).n,
    unresolved: one(`SELECT COUNT(*) AS n FROM inbox_events WHERE resolved_at IS NULL`).n,
  };

  console.log("");
  console.log("=== INSIDE THE TRANSACTION (rolled back after) ===");
  console.log(`reactivateRestorePending -> ${JSON.stringify(result)}`);
  console.log(`events (${after.length}): ${fingerprint(after)}`);

  const beforeById = new Map(before.map((r) => [r.id, r]));
  const wasClosedWith = (id) => {
    const prior = beforeById.get(id);
    return prior && prior.resolved_at !== null ? prior.resolved_reason : null;
  };

  // A row counts as revived only if restore is what opened it: closed before,
  // open after. A row that was already open is not restore's doing.
  const revived = after.filter((r) => r.resolved_at === null && wasClosedWith(r.id) !== undefined && wasClosedWith(r.id) !== null);
  const leaked = revived.filter((r) => wasClosedWith(r.id) !== "archived");
  const alreadyOpen = after.filter((r) => r.resolved_at === null && wasClosedWith(r.id) === undefined);
  const stillClosed = after.filter((r) => r.resolved_at !== null);

  const revivedList = revived.map((r) => `${r.kind}/${r.id} (was closed as "${wasClosedWith(r.id)}")`);
  const alreadyOpenList = alreadyOpen.map((r) => `${r.kind}/${r.id}`);
  console.log("");
  console.log(`revived by restore: ${revived.length} -> ${revivedList.join(", ") || "none"}`);
  console.log(`already open before restore: ${alreadyOpen.length} -> ${alreadyOpenList.join(", ") || "none"}`);
  console.log(`still resolved: ${stillClosed.length} (reasons: ${JSON.stringify([...new Set(stillClosed.map((r) => r.resolved_reason))])})`);

  console.log("");
  console.log("=== INVARIANTS, against real rows ===");

  // `every` over an EMPTY list is vacuously true, so this used to print PASS
  // proving nothing once questions stopped being revived. A question is now
  // withheld, so the honest check is: every row this run revived is either an
  // error (which does return) or nothing at all, and no question is among them.
  const revivedKinds = [...new Set(revived.map((r) => r.kind))];
  const revivedQuestions = revived.filter((r) => r.kind === "question");
  console.log(
    `${revived.every((r) => r.resolved_reason === null) ? "PASS" : "FAIL"}  a revived row carries no stale reason` +
      (revived.some((r) => r.resolved_reason !== null)
        ? ` (violations: ${revived.filter((r) => r.resolved_reason !== null).map((r) => r.id).join(", ")})`
        : ""),
  );
  // A question belongs to the worker that asked it, and restore starts a fresh
  // one, so it is withheld rather than revived (see #178). An empty `revived`
  // must not read as a pass: assert the question is specifically ABSENT.
  const archivedQuestions = before.filter((r) => r.kind === "question" && r.resolved_reason === "archived");
  console.log(
    `${archivedQuestions.length === revivedQuestions.length ? "PASS" : "FAIL"}  no archived question is revived` +
      ` (${archivedQuestions.length} archived question(s), ${revivedQuestions.length} revived)`,
  );
  console.log(
    `${revivedKinds.every((kind) => kind !== "question") ? "PASS" : "FAIL"}  the revived set is errors only` +
      (revivedKinds.length ? ` (kinds: ${revivedKinds.join(", ")})` : " (nothing revived)"),
  );

  const closedNotByArchive = before.filter((r) => r.resolved_at !== null && r.resolved_reason !== "archived");
  console.log(
    `${leaked.length === 0 ? "PASS" : "FAIL"}  a row the archive did not take stays resolved` +
      ` (${closedNotByArchive.length} rows resolved before the archive stayed closed)` +
      (leaked.length ? ` LEAKED: ${leaked.map((r) => r.id).join(", ")}` : ""),
  );

  const errorsRevived = revived.filter((r) => r.kind === "error");
  console.log(
    `NOTE  error rows revived: ${errorsRevived.length}` +
      (errorsRevived.length === 0 && byKind.error === undefined
        ? " — this card has no archive-resolved error, so the verbatim-last_error path is NOT exercised by this fixture"
        : ""),
  );

  const completedRevived = revived.filter((r) => r.kind === "completed");
  console.log(`${completedRevived.length === 0 ? "PASS" : "FAIL"}  a completed event never returns`);

  const eventCountSame = after.length === before.length;
  console.log(`${eventCountSame ? "PASS" : "FAIL"}  no event was created or deleted (${before.length} -> ${after.length})`);

  // "Nothing else moved" cannot compare the global unresolved count, because
  // reviving a question raises it by exactly the number revived. It compares
  // everything else, plus the unresolved count restricted to other cards.
  const globalAfterOther = {
    cards: one(`SELECT COUNT(*) AS n FROM cards`).n,
    archived: one(`SELECT COUNT(*) AS n FROM cards WHERE status = 'archived'`).n,
    events: one(`SELECT COUNT(*) AS n FROM inbox_events`).n,
    unresolvedElsewhere: one(`SELECT COUNT(*) AS n FROM inbox_events WHERE resolved_at IS NULL AND card_id != ?`, CARD_ID).n,
  };
  const globalBeforeOther = {
    cards: globalBefore.cards,
    archived: globalBefore.archived,
    events: globalBefore.events,
    unresolvedElsewhere: one(`SELECT COUNT(*) AS n FROM inbox_events WHERE resolved_at IS NULL AND card_id != ?`, CARD_ID).n,
  };
  const globalSame = JSON.stringify(globalAfterOther) === JSON.stringify(globalBeforeOther);
  console.log(`${globalSame ? "PASS" : "FAIL"}  nothing outside this card moved (${JSON.stringify(globalAfterOther)})`);

  const expectedUnresolvedDelta = revived.length;
  const actualUnresolvedDelta = globalAfter.unresolved - globalBefore.unresolved;
  console.log(
    `${actualUnresolvedDelta === expectedUnresolvedDelta ? "PASS" : "FAIL"}  global unresolved changed by exactly the revived rows` +
      ` (expected ${expectedUnresolvedDelta}, got ${actualUnresolvedDelta})`,
  );

  console.log("");
  console.log("=== ROLLING BACK ===");
} finally {
  db.exec("ROLLBACK");
}

const restored = snapshotEvents();
const globalAfter = {
  cards: one(`SELECT COUNT(*) AS n FROM cards`).n,
  archived: one(`SELECT COUNT(*) AS n FROM cards WHERE status = 'archived'`).n,
  events: one(`SELECT COUNT(*) AS n FROM inbox_events`).n,
  unresolved: one(`SELECT COUNT(*) AS n FROM inbox_events WHERE resolved_at IS NULL`).n,
};
console.log(`events: ${fingerprint(restored)}`);
console.log(`global: ${JSON.stringify(globalAfter)}`);
const leftAsFound =
  fingerprint(restored) === fingerprint(before) &&
  JSON.stringify(globalAfter) === JSON.stringify(globalBefore);
console.log(`${leftAsFound ? "PASS" : "FAIL"}  production left byte-for-byte as found`);
console.log("");
console.log("NOT VERIFIED HERE: the host half — the status flip and the fresh worker spawn both need a running bb host.");
db.close();

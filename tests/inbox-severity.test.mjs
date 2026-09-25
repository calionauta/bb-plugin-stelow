import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SEVERITY_ROUTINE, SEVERITY_ACTION, SEVERITY_ESCALATING, SEVERITY_STALL_MS, SEVERITY_OLD_MS, scoreEventSeverity, parseSeverityReasons } from "../lib/inbox-severity.mjs";
import { ensureInboxSeverityColumns, insertInboxEvent, listInboxEvents, refreshEventSeverity, countsForInboxBadge } from "../lib/inbox-events.mjs";

// Severity tiers reorder the queue without changing what counts: a 3-day
// stall must outrank a fresh question while the badge keeps counting both.
// The test that would catch a regression that re-flattens the queue, loses
// reasons, or lets ordering touch the badge.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = [
  readFileSync(join(root, "server/plugin-runtime.ts"), "utf8"),
  readFileSync(join(root, "server/runtime/claim-coordination.ts"), "utf8"),
].join("\n");
const serverInbox = readFileSync(join(root, "server/inbox.ts"), "utf8");
const app = readFileSync(join(root, "components/panels/inbox-panel.tsx"), "utf8");

// Scorer boundaries: fresh actions act, old/repeated escalate, completions
// review quietly. Reasons ride every tier — never a bare number.
assert.deepEqual(scoreEventSeverity({ kind: "question", ageMs: 0 }), { severity: SEVERITY_ACTION, reasons: ["needs decision"] }, "fresh questions act");
assert.deepEqual(scoreEventSeverity({ kind: "error", ageMs: 0, errorRepetitions: 1 }), { severity: SEVERITY_ACTION, reasons: ["needs recovery"] }, "first errors act");
assert.deepEqual(scoreEventSeverity({ kind: "paused", ageMs: 0, stallCount: 0 }), { severity: SEVERITY_ACTION, reasons: ["paused"] }, "fresh pauses act");
assert.deepEqual(scoreEventSeverity({ kind: "completed", ageMs: 0 }), { severity: SEVERITY_ROUTINE, reasons: ["review"] }, "completions review quietly");
const stalled = scoreEventSeverity({ kind: "paused", ageMs: SEVERITY_STALL_MS + 1 });
assert.equal(stalled.severity, SEVERITY_ESCALATING, "pauses past 72h escalate");
assert.ok(stalled.reasons[0].startsWith("stalled "), "stalls name their age");
assert.deepEqual(scoreEventSeverity({ kind: "paused", ageMs: SEVERITY_STALL_MS - 1 }).severity, SEVERITY_ACTION, "pauses under 72h stay action");
assert.deepEqual(scoreEventSeverity({ kind: "error", ageMs: 0, errorRepetitions: 2 }), { severity: SEVERITY_ESCALATING, reasons: ["error ×2"] }, "second errors escalate");
assert.deepEqual(scoreEventSeverity({ kind: "question", ageMs: SEVERITY_OLD_MS + 1 }).severity, SEVERITY_ESCALATING, "week-old actions escalate regardless of kind");
assert.deepEqual(scoreEventSeverity({ kind: "paused", ageMs: 0, stallCount: 3 }), { severity: SEVERITY_ACTION, reasons: ["paused", "stall ×3"] }, "stall counts ride fresh pauses as context");
assert.deepEqual(scoreEventSeverity({ kind: "mystery", ageMs: 0 }), { severity: SEVERITY_ACTION, reasons: [] }, "unknown kinds degrade to action, never to a throw");

// Reason parsing never throws on the read path.
assert.deepEqual(parseSeverityReasons('["a", 1, null]'), ["a"], "only strings survive");
assert.deepEqual(parseSeverityReasons("not json"), [], "garbage parses to no reasons");
assert.deepEqual(parseSeverityReasons(null), [], "missing parses to no reasons");
assert.deepEqual(parseSeverityReasons(["a", "b", "c", "d", "e", "f", "g"]), ["a", "b", "c", "d", "e", "f"], "reasons cap at six");

// Write path against real SQLite: severity is scored at insert from
// observable signals (error repetitions count unresolved errors including
// the row itself; stalls come from the worker ledger).
const db = new Database(":memory:");
db.exec(`CREATE TABLE cards (id TEXT PRIMARY KEY, display_name TEXT, name TEXT NOT NULL, project_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'build');
  CREATE TABLE inbox_events (id TEXT PRIMARY KEY, card_id TEXT NOT NULL, kind TEXT NOT NULL, summary TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, occurred_at INTEGER NOT NULL, read_at INTEGER, archived_at INTEGER, resolved_at INTEGER);`);
ensureInboxSeverityColumns(db);
assert.ok(db.prepare("PRAGMA table_info(inbox_events)").all().some((column) => column.name === "severity"), "pre-tier databases gain the severity column");
assert.ok(db.prepare("PRAGMA table_info(inbox_events)").all().some((column) => column.name === "severity_reasons"), "pre-tier databases gain the reasons column");
db.prepare("INSERT INTO cards (id, display_name, name, project_id, kind) VALUES ('c1', 'C1', 'c1', 'p1', 'build')").run();
const now = 1_000_000_000_000;
assert.equal(insertInboxEvent(db, { id: "q1", cardId: "c1", kind: "question", summary: "s", dedupeKey: "q:1", occurredAt: now }), true, "inserts still report");
assert.deepEqual(db.prepare("SELECT severity, severity_reasons FROM inbox_events WHERE id = 'q1'").get(), { severity: 1, severity_reasons: '["needs decision"]' }, "questions score at write");
assert.equal(insertInboxEvent(db, { id: "e1", cardId: "c1", kind: "error", summary: "s", dedupeKey: "e:1", occurredAt: now }), true, "first errors insert");
assert.equal(db.prepare("SELECT severity FROM inbox_events WHERE id = 'e1'").get().severity, 1, "first errors act");
assert.equal(insertInboxEvent(db, { id: "e2", cardId: "c1", kind: "error", summary: "s", dedupeKey: "e:2", occurredAt: now }), true, "second errors insert");
assert.deepEqual(db.prepare("SELECT severity, severity_reasons FROM inbox_events WHERE id = 'e2'").get(), { severity: 2, severity_reasons: '["error ×2"]' }, "repeated errors escalate at write");

// Ordering: open escalations top every read; resolved history stays
// chronological below them (a resolved old fire never outranks fresh work,
// and a fresh completion still reads as the recent update).
db.prepare("INSERT INTO inbox_events (id, card_id, kind, summary, dedupe_key, occurred_at, severity, severity_reasons) VALUES ('old', 'c1', 'paused', 's', 'old:1', 1, 2, '[]')").run();
assert.deepEqual(listInboxEvents(db, false).map((row) => row.id), ["e2", "old", "q1", "e1"], "open escalations top (newest first within a tier), then lower tiers newest-first");
db.prepare("UPDATE inbox_events SET resolved_at = ? WHERE id = 'old'").run(now);
assert.deepEqual(listInboxEvents(db, false).map((row) => row.id), ["e2", "q1", "e1", "old"], "resolved history sinks below open items, newest first");

// Sweep recompute: age crossings upgrade in place with fresh reasons and
// report the count for realtime publishing; idempotent on re-run.
db.prepare("INSERT INTO inbox_events (id, card_id, kind, summary, dedupe_key, occurred_at, severity, severity_reasons) VALUES ('aging', 'c1', 'paused', 's', 'aging:1', ?, 1, '[]')").run(now - SEVERITY_STALL_MS - 1000);
assert.equal(refreshEventSeverity(db, { cardId: "c1", nowMs: now }), 2, "crossings upgrade (aging pause by age, first error by repetition since)");
assert.deepEqual(db.prepare("SELECT severity, severity_reasons FROM inbox_events WHERE id = 'aging'").get(), { severity: 2, severity_reasons: '["stalled 3d"]' }, "upgrades carry fresh reasons");
assert.deepEqual(db.prepare("SELECT severity, severity_reasons FROM inbox_events WHERE id = 'e1'").get(), { severity: 2, severity_reasons: '["error ×2"]' }, "repetition counts re-evaluate on sweep, not just at write");
assert.equal(refreshEventSeverity(db, { cardId: "c1", nowMs: now }), 0, "re-running without new aging changes nothing");
assert.equal(refreshEventSeverity(db, { cardId: "absent", nowMs: now }), 0, "unknown cards upgrade nothing");

// Badge rule frozen: severity never enters the count — unresolved actions
// count at every tier, completions only while unread.
assert.equal(countsForInboxBadge({ kind: "paused", archivedAt: null, resolvedAt: null }), true, "escalating pauses still count");
assert.equal(countsForInboxBadge({ kind: "completed", archivedAt: null, resolvedAt: null, readAt: 1 }), false, "read completions never count");
assert.equal(countsForInboxBadge({ kind: "question", archivedAt: 1, resolvedAt: null }), false, "archived items never count");

// Wiring: the feature migration owns the columns, the sweep recomputes beside
// stall escalation, and the extracted contract feeds severity to the panel.
assert.match(serverInbox, /export function runInboxMigrations/, "the feature migration is owned by the inbox slice");
assert.match(server, /refreshEventSeverity\(deps\.db, \{ cardId, nowMs: deps\.now\(\) \}\)/, "the sweep recomputes tiers beside the stall escalation");
assert.match(serverInbox, /ensureInboxSeverityColumns\(db\);/, "the feature module owns severity migrations");
assert.match(serverInbox, /severity: z\.number\(\),/, "the snapshot contract carries severity");
assert.match(serverInbox, /severityReasons: z\.array\(z\.string\(\)\)/, "the snapshot contract carries reasons");
assert.match(
  serverInbox,
  /severity: row\.severity \?\? 1,[\s\S]*severityReasons: parseSeverityReasons\(row\.severity_reasons\)/,
  "list rows map stored tiers with safe fallbacks",
);
assert.match(app, /severityReasons\.slice\(0, 3\)\.join\(" · "\)/, "rows render up to three reason chips");
assert.match(app, /entry\.severity >= 2 && entry\.resolvedAt == null/, "the escalating mark shows on open escalations only");

console.log("inbox severity test ok: tiers, reasons, write scoring, ordering, sweep recompute, frozen badge");

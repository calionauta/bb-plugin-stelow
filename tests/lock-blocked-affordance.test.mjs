import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { lockBlockEvent, lockBlockSummary, lockBlockDedupeKey } from "../lib/lock-blocked.mjs";
import { ensureInboxResolvedReasonColumn, insertInboxEvent, listInboxEvents } from "../lib/inbox-events.mjs";
import { ensureInboxOccurrencesColumn } from "../lib/inbox-error-event.mjs";

/**
 * A blocked file must name the blocker as something you can OPEN.
 *
 * The sentence already said `held by card "Restore archived cards to board
 * columns"`, and that was the whole of it. A reader who wanted to know what
 * that card was doing to the file had to copy a display name and hunt it on a
 * board of dozens — doing the join the system had already done and thrown away,
 * because `lockBlockedSummary` took a display NAME and a file and returned a
 * string, and the holder's id was dropped at the call site.
 *
 * Same shape as the execution reconciler recording `unknown-native-state` where
 * a known state was in hand: one fact, two representations, and the one that
 * survives is the one that cannot be used. So the record is the truth, the
 * prose is derived from it, and the link is built from the id — never by
 * re-finding the name inside the sentence, which is a link that eventually
 * points at the wrong card and fails by still looking right.
 */
const repoRoot = join(fileURLToPath(import.meta.url), "..", "..");
const read = (relative) => readFileSync(join(repoRoot, relative), "utf8");

const block = {
  cardId: "card_blocked",
  file: "src/foo.ts",
  holderCardId: "card_holder",
  holderName: "Restore archived cards to board columns",
  expiresAt: Date.UTC(2026, 8, 28, 12, 0, 0),
};

function database() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE cards (id TEXT PRIMARY KEY, display_name TEXT, name TEXT NOT NULL, project_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'build');
    CREATE TABLE inbox_events (
      id TEXT PRIMARY KEY, card_id TEXT NOT NULL, kind TEXT NOT NULL,
      summary TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, occurred_at INTEGER NOT NULL,
      read_at INTEGER, archived_at INTEGER, resolved_at INTEGER,
      severity INTEGER NOT NULL DEFAULT 1, severity_reasons TEXT NOT NULL DEFAULT '[]',
      holder_card_id TEXT, holder_file TEXT,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    );
  `);
  ensureInboxResolvedReasonColumn(db);
ensureInboxOccurrencesColumn(db);
  db.prepare("INSERT INTO cards VALUES (?, ?, ?, ?, ?)").run(
    "card_blocked", "Blocked", "blocked", "project_1", "build",
  );
  return db;
}

test("the record is the truth and the sentence is derived from it", () => {
  const event = lockBlockEvent(block);
  assert.equal(event.summary, lockBlockSummary(block), "one function writes both, so they cannot disagree");
  assert.match(event.summary, /src\/foo\.ts/);
  assert.match(event.summary, /Restore archived cards to board columns/);
  assert.match(event.summary, /no action needed/, "the mechanism really is automatic; implying homework trains distrust");
  assert.equal(event.dedupeKey, lockBlockDedupeKey(block));
  assert.equal(event.dedupeKey, "lock-blocked:card_blocked:src/foo.ts", "one notification per card per file, however often it retries");
});

test("the holder survives to the row as an id, not only as a name in prose", () => {
  const db = database();
  const event = lockBlockEvent(block);
  insertInboxEvent(db, {
    id: "evt_lock", cardId: "card_blocked", kind: "paused",
    summary: event.summary, dedupeKey: event.dedupeKey, occurredAt: 1,
    holder: { cardId: event.holderCardId, file: event.holderFile },
  });
  const row = listInboxEvents(db, false)[0];
  assert.equal(row.holder_card_id, "card_holder", "the affordance is the id the system already had");
  assert.equal(row.holder_file, "src/foo.ts");
  assert.match(row.summary, /Restore archived cards/, "and the sentence is still there to be read");
  db.close();
});

test("an event with no holder stays null rather than inventing one", () => {
  const db = database();
  insertInboxEvent(db, {
    id: "evt_plain", cardId: "card_blocked", kind: "error",
    summary: "Worker failed.", dedupeKey: "error:card_blocked:2", occurredAt: 2,
  });
  const row = listInboxEvents(db, false)[0];
  assert.equal(row.holder_card_id, null, "no holder is null, not an empty string the UI would render as a broken link");
  assert.equal(row.holder_file, null);
  db.close();
});

test("the inbox row links the holder, and cannot be built from the sentence", () => {
  // Navigation is wired by the panel; the chip's own behaviour lives in its own
  // file, so each is asserted where it lives.
  const panel = read("components/panels/inbox-panel.tsx");
  // The panel owns the router and the row does not know navigation exists, so
  // the assertion is on the ID reaching the router — not on the exact call
  // shape, which the row is free to refactor.
  assert.match(
    panel,
    /goToHolderCard\(navigate, entry\.holderCardId/,
    "navigation must take the holder's id, never its name",
  );
  assert.doesNotMatch(
    panel,
    /inboxEventText\(entry\)\.match|split\("card "|replace\(.*held by/,
    "the holder must not be recovered out of the prose; a link parsed from a sentence eventually points at the wrong card",
  );
  const chip = read("components/panels/inbox-holder-chip.tsx");
  // The chip is a control inside a row that is itself a button, so it has to
  // stop propagation or it navigates twice and lands on the card the reader
  // was already on.
  assert.match(
    chip,
    /event\.stopPropagation\(\);\s*\n\s*onOpen\(\);/,
    "the holder link is nested inside the row's own button and must not double-navigate",
  );
  assert.match(
    chip,
    /<button[\s\S]*onClick=/,
    "the holder is a real control, not styled text — it has to be reachable by keyboard",
  );
  assert.match(
    chip,
    /min-h-11/,
    "and it is a 44px target like every other control on the card",
  );
});

test("the old formatter is gone, not merely unused", () => {
  // The formatter took a display name and returned a string, which is the shape
  // that lost the id. Leaving it around invites the next caller to use it.
  for (const file of ["server/runtime/claim-coordination.ts", "server/runtime/cli/cli-deps.ts", "server/runtime/wiring/cli-surfaces.ts"]) {
    assert.doesNotMatch(read(file), /lockBlockedSummary/, `${file} still carries the formatter that dropped the id`);
  }
});

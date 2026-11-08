import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  CARD_STATUSES,
  CARD_STATUS_LABELS,
  assertCardStatus,
  cardStatusLabel,
  isKnownCardStatus,
  isTerminalCardStatus,
} from "../lib/card-status.mjs";
import {
  LIGHTWEIGHT_COLUMNS,
  LIGHTWEIGHT_STATUS_BY_COLUMN,
  lightweightColumnForStatus,
} from "../lib/tracks.mjs";
import { readOpenExpiredQuestions } from "../lib/question-store.mjs";
import { CARD_COLUMNS, insertCard } from "../server/cards-create-persist.ts";
import { createCardUpdater } from "../server/runtime/card-state.ts";

/**
 * `cards.status` was the last status column here with no authority behind it.
 *
 * Every other status axis has one owner and a name: `execution_runs` has a CHECK
 * constraint and `RUN_STATUS_LABELS` beside it; a trackable has
 * `TRACKABLE_STATUSES` and `TRACKABLE_STATUS_LABELS`. A card had `status TEXT
 * NOT NULL` and four values scattered across whichever code path wrote them.
 *
 * These tests pin the three things that makes it an authority rather than a list:
 * the five values are the right five, every write path refuses anything else,
 * and the refusal names what it was. The last one is the difference between a
 * bug caught in one second and one found by reading a stack trace.
 */

test("a card's status is one of five, and every one is writable", () => {
  assert.deepEqual([...CARD_STATUSES], ["draft", "pending", "in-progress", "completed", "archived"]);
  for (const status of CARD_STATUSES) {
    assert.ok(isKnownCardStatus(status), `${status} is a card status`);
    assert.equal(cardStatusLabel(status), CARD_STATUS_LABELS[status]);
  }
});

test("every status the app writes to a card is in the vocabulary", async () => {
  // The test that would have caught the regression, written as a CROSS-CHECK
  // rather than a restatement: drive the two paths that write card status and
  // assert each value they actually write is declared. A restatement of
  // CARD_STATUSES passes no matter how wrong CARD_STATUSES is — which is exactly
  // how a four-value list shipped that refused every Research and Explore card.
  //
  // Driven, not read: `insertCard` is the card-creation write path and refuses
  // through `assertCardStatus` itself, so a status outside the vocabulary
  // throws here rather than being grepped for.
  const writtenStatuses = await statusesWrittenOnCreate();
  assert.deepEqual(
    writtenStatuses,
    ["draft", "pending", "pending"],
    "a build card starts draft; the lightweight tracks start pending",
  );
  assert.ok(writtenStatuses.includes("pending"), "research/explore creation writes pending; if this stops, the check is stale");
  for (const status of writtenStatuses) {
    assert.ok(
      isKnownCardStatus(status),
      `the app writes cards.status=${JSON.stringify(status)} but it is not in CARD_STATUSES `
      + `— assertCardStatus would refuse every such write`,
    );
  }
});

/** Drive the card-creation write path once per track and read back the status
 * it wrote, in card order. */
async function statusesWrittenOnCreate() {
  const writes = [];
  const deps = {
    now: () => 1_700_000_000_000,
    db: { prepare: (sql) => ({ run: (...values) => writes.push({ sql, values }) }) },
  };
  const workspace = { projectId: "proj_1", exploratory: false, rootPath: "/w", source: { hostId: "host_1" } };
  const input = { prompt: "Make checkout work", intent: "feature", attachments: null };
  const prepared = { displayName: "Checkout", environment: {}, roundFile: "round-1.md" };
  const track = (overrides = {}) => ({
    intent: "feature",
    seed: { dirHash: "hash_1" },
    research: false,
    explore: false,
    researchStrategy: null,
    exploreStage: null,
    ...overrides,
  });
  for (const [label, resolved] of [
    ["build", track()],
    ["research", track({ research: true })],
    ["explore", track({ explore: true })],
  ]) {
    await insertCard(deps, input, `card_${label}`, workspace, prepared, resolved, { id: "preset_1" }, null, null);
  }
  const statusIndex = CARD_COLUMNS.indexOf("status");
  return writes.map(({ values }) => values[statusIndex]);
}

test("the lightweight board's stored statuses are all card statuses", () => {
  // The lightweight tracks' column→status map is the second writer: a drag
  // back to Bucket goes through here, and that drag threw too.
  const columnStatuses = Object.entries(LIGHTWEIGHT_STATUS_BY_COLUMN);
  assert.equal(
    columnStatuses.length,
    LIGHTWEIGHT_COLUMNS.length,
    "every lightweight column has a stored status",
  );
  for (const [column, status] of columnStatuses) {
    assert.ok(
      isKnownCardStatus(status),
      `column ${column} writes cards.status=${JSON.stringify(status)}, which must be declared`,
    );
    assert.equal(
      lightweightColumnForStatus(status),
      column,
      `${status} reads back to the column it was written for`,
    );
  }
});

test("a status from another axis is refused, and the refusal names it", () => {
  // `approved` is a real status in this codebase — it is what an approved scope
  // map carries — and it is exactly the value most likely to be written to a
  // card by mistake. The refusal has to name the value AND the five options, or
  // the reader is left guessing which machine it came from.
  for (const wrong of ["approved", "running", "needs_input", "verified", "ready", "human-review"]) {
    assert.throws(
      () => assertCardStatus(wrong, "card update for card_1"),
      (error) => {
        assert.match(error.message, new RegExp(JSON.stringify(wrong).replace(/"/g, '\\"')), "names the value");
        assert.match(error.message, /draft, pending, in-progress, completed, archived/, "names the five that exist");
        assert.match(error.message, /card update for card_1/, "names where it happened");
        return true;
      },
      `${wrong} is not a card status`,
    );
  }
});

test("a write that does not touch the status is not asked about it", () => {
  // Most card updates change an output timestamp or a text field. A validator
  // that complained about an absent status would be noise on the hot path, so
  // absent and null both pass.
  assert.doesNotThrow(() => assertCardStatus(undefined, "card update for card_1"));
  assert.doesNotThrow(() => assertCardStatus(null, "card update for card_1"));
});

test("an unknown status falls back to itself, so nothing renders blank", () => {
  // A card on a status this build does not know must still say where it is.
  // Returning "" would render an empty pill and lose the fact entirely.
  assert.equal(cardStatusLabel("status_from_the_future"), "status_from_the_future");
  assert.equal(cardStatusLabel(""), "");
  assert.equal(cardStatusLabel(undefined), "");
});

test("every card write refuses a status that is not one of the five", async () => {
  // Drives the real choke point rather than the helper beside it. `writeCard` is
  // private, so this goes through the exported updater the app calls — a test of
  // the validator alone would pass while the wiring was absent.
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE cards (
      id TEXT PRIMARY KEY, status TEXT, last_assistant_text TEXT, updated_at INTEGER
    );
    CREATE TABLE inbox_events (
      id TEXT PRIMARY KEY, card_id TEXT, kind TEXT, resolved_at INTEGER
    );
  `);
  db.prepare("INSERT INTO cards (id, status, updated_at) VALUES ('card_1', 'in-progress', 0)").run();

  const update = createCardUpdater({
    db,
    bb: { realtime: { publish: () => {} } },
    now: () => 1_000,
    getCard: () => ({ id: "card_1", status: "in-progress", last_assistant_text: "out" }),
    recordInbox: () => {},
    recordErrorInbox: () => {},
    resolveInbox: () => {},
    resolveAllInbox: () => {},
  });

  assert.throws(
    () => update("card_1", { status: "approved" }),
    /Unknown card status "approved"/,
    "a status from the scope-map axis is refused at the write",
  );
  assert.throws(() => update("card_1", { status: "in_progress" }), /Unknown card status "in_progress"/);

  // The refused writes left the row alone — a validator that throws AFTER the
  // UPDATE would still have corrupted the card.
  assert.equal(db.prepare("SELECT status FROM cards WHERE id = 'card_1'").get().status, "in-progress");

  assert.doesNotThrow(() => update("card_1", { status: "completed" }));
  assert.equal(db.prepare("SELECT status FROM cards WHERE id = 'card_1'").get().status, "completed");
});

test("a finished card is past answering", async () => {
  // A Done card kept showing its expired question as an answerable form: the
  // completion resolves the inbox rows but the expired row stays
  // unanswered=0, and the detail served it back. Submitting wakes nothing the
  // card can still use, so terminal cards serve no expired questions.
  for (const status of ["completed", "archived"]) {
    assert.equal(isTerminalCardStatus(status), true, `${status} is past answering`);
  }
  for (const status of ["draft", "pending", "in-progress", null, undefined, "bogus"]) {
    assert.equal(isTerminalCardStatus(status), false, `${String(status)} can still be asked`);
  }
  // The guard short-circuits before any I/O — prepare itself throws, so reaching
  // the database at all fails the test, and the option resolver must never run
  // either. That is the behavioral form of the lib's early return.
  const mustNotTouch = () => { throw new Error("must not read"); };
  assert.deepEqual(
    await readOpenExpiredQuestions({
      db: { prepare: mustNotTouch },
      resolveAskOptions: mustNotTouch,
    }, { id: "card_1", status: "completed" }),
    [],
    "a terminal card serves no expired questions without touching storage",
  );
});

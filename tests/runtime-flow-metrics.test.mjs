import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { flowMetrics } from "../server/runtime/flow-metrics.ts";

/** The schema this test needs, and nothing else. */
const SCHEMA = `
  CREATE TABLE cards (
    id TEXT PRIMARY KEY, project_id TEXT, kind TEXT, name TEXT,
    display_name TEXT, status TEXT, activity TEXT, created_at INTEGER
  );
  CREATE TABLE card_stage_events (
    id INTEGER PRIMARY KEY, card_id TEXT, stage TEXT, entered_at INTEGER
  );
  CREATE TABLE inbox_events (
    card_id TEXT, kind TEXT, occurred_at INTEGER, read_at INTEGER, archived_at INTEGER,
    resolved_at INTEGER, holder_card_id TEXT, holder_file TEXT
  );
`;

/** The cards the two tests below read, and the stages they reached. */
function seed(db) {
  const card = db.prepare("INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  card.run("first", "project-a", "build", "First", null, "completed", "idle", 0);
  card.run("second", "project-a", "research", "Second", "Visible second", "completed", "idle", 0);
  card.run("other", "project-b", "explore", "Other", null, "completed", "idle", 0);
  card.run("blocked", "project-a", "build", "Blocked", null, "blocked", "idle", 0);
  card.run("no-done", "project-a", "build", "No done event", null, "completed", "idle", 0);
  const event = db.prepare("INSERT INTO card_stage_events (card_id, stage, entered_at) VALUES (?, ?, ?)");
  for (const [id, moved, done] of [["first", 10, 100], ["second", 50, 200], ["other", 100, 300]]) {
    event.run(id, "triage", 0);
    event.run(id, "execution", moved);
    event.run(id, "done", done);
  }
}

function fixture() {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  seed(db);
  // The trailing NULL is `resolved_at`: an unread, unresolved completion is a
  // review still being requested, which is what "retaining live attention"
  // means. A fixture that left the column out would pass by accident. Columns
  // are NAMED so a migration adding one does not silently change what this row
  // means.
  db.prepare(
    "INSERT INTO inbox_events (card_id, kind, occurred_at, read_at, archived_at, resolved_at) VALUES (?, 'completed', ?, NULL, NULL, NULL)",
  ).run("second", 250);
  return db;
}

// The one finished card inside the 150–250 done window, and its breakdown: no
// question, pause or error rows, so every minute of it is unexplained. The
// breakdown says so rather than calling the remainder work.
const SECOND_CARD = {
  cardId: "second",
  kind: "research",
  name: "Second",
  leadMs: 200,
  cycleMs: 150,
  doneAt: 200,
};
const SECOND_WAIT = {
  totalMs: 200,
  humanMs: 0,
  systemMs: 0,
  unattributedMs: 200,
  humanShare: 0,
  systemShare: 0,
  unattributedShare: 1,
};

test("flow metrics batches completed cards and filters by project and done window", () => {
  const db = fixture();
  try {
    const all = flowMetrics(db, {});
    assert.deepEqual(all.items.map((item) => item.cardId), ["first", "second", "other"]);
    assert.deepEqual(all.summary, {
      count: 3,
      leadP50Ms: 200,
      leadP90Ms: 300,
      cycleP50Ms: 150,
      cycleP90Ms: 200,
    });

    const window = flowMetrics(db, { projectId: "project-a", since: 150, until: 250, now: 1000 });
    assert.deepEqual(window.items, [{
      ...SECOND_CARD,
      wait: { ...SECOND_WAIT, attributedMs: 0 },
      reviewWaitMs: 750,
    }]);
    assert.deepEqual(window.summary, {
      count: 1,
      leadP50Ms: 200,
      leadP90Ms: 200,
      cycleP50Ms: 150,
      cycleP90Ms: 150,
    });
    assert.deepEqual(window.wait, { ...SECOND_WAIT, attributedMs: 0 });
    assert.deepEqual(window.attention, [
      { cardId: "second", kind: "research", name: "Visible second", reason: "review", waitMs: 750 },
      { cardId: "blocked", kind: "build", name: "Blocked", reason: "stuck", waitMs: null },
    ]);
  } finally {
    db.close();
  }
});

test("flow metrics returns null percentiles while retaining live attention", () => {
  const db = fixture();
  try {
    const result = flowMetrics(db, { projectId: "project-a", since: 400 });
    assert.deepEqual(result.items, []);
    assert.deepEqual(result.summary, {
      count: 0,
      leadP50Ms: null,
      leadP90Ms: null,
      cycleP50Ms: null,
      cycleP90Ms: null,
    });
    assert.equal(result.attention.length, 2);
  } finally {
    db.close();
  }
});

test("a question window reaches the breakdown, and an answered one stops counting", () => {
  const db = fixture();
  try {
    db.prepare(
      "INSERT INTO inbox_events (card_id, kind, occurred_at, read_at, archived_at, resolved_at) VALUES ('second', 'question', 40, NULL, NULL, 90)",
    ).run();
    const second = (now) => flowMetrics(db, { projectId: "project-a", now }).items
      .find((item) => item.cardId === "second").wait;
    const split = second(1000);
    assert.equal(split.humanMs, 50, "a question held the card for its open window");
    assert.equal(split.unattributedMs, 150, "and the rest is still unexplained");
    assert.equal(split.humanShare + split.systemShare + split.unattributedShare, 1, "the parts still partition the interval");

    db.prepare("UPDATE inbox_events SET resolved_at = NULL WHERE kind = 'question'").run();
    const open = second(1000);
    assert.equal(open.humanMs, 160, "an open question is charged to the card's own done time, not to the caller's clock");
  } finally {
    db.close();
  }
});

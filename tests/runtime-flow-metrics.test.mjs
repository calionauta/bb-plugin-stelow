import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { flowMetrics } from "../server/runtime/flow-metrics.ts";

function fixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE cards (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      kind TEXT,
      name TEXT,
      display_name TEXT,
      status TEXT,
      activity TEXT,
      created_at INTEGER
    );
    CREATE TABLE card_stage_events (
      id INTEGER PRIMARY KEY,
      card_id TEXT,
      stage TEXT,
      entered_at INTEGER
    );
    CREATE TABLE inbox_events (
      card_id TEXT,
      kind TEXT,
      read_at INTEGER,
      archived_at INTEGER
    );
  `);
  const card = db.prepare("INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  card.run("first", "project-a", "build", "First", null, "completed", "idle", 0);
  card.run("second", "project-a", "research", "Second", "Visible second", "completed", "idle", 0);
  card.run("other", "project-b", "explore", "Other", null, "completed", "idle", 0);
  card.run("blocked", "project-a", "build", "Blocked", null, "blocked", "idle", 0);
  card.run("no-done", "project-a", "build", "No done event", null, "completed", "idle", 0);
  const event = db.prepare("INSERT INTO card_stage_events (card_id, stage, entered_at) VALUES (?, ?, ?)");
  for (const [id, moved, done] of [
    ["first", 10, 100],
    ["second", 50, 200],
    ["other", 100, 300],
  ]) {
    event.run(id, "triage", 0);
    event.run(id, "execution", moved);
    event.run(id, "done", done);
  }
  db.prepare("INSERT INTO inbox_events VALUES (?, 'completed', NULL, NULL)").run("second");
  return db;
}

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

    const window = flowMetrics(db, { projectId: "project-a", since: 150, until: 250 });
    assert.deepEqual(window.items, [{
      cardId: "second",
      kind: "research",
      name: "Second",
      leadMs: 200,
      cycleMs: 150,
      doneAt: 200,
    }]);
    assert.deepEqual(window.summary, {
      count: 1,
      leadP50Ms: 200,
      leadP90Ms: 200,
      cycleP50Ms: 150,
      cycleP90Ms: 150,
    });
    assert.deepEqual(window.attention, [
      { cardId: "second", kind: "research", name: "Visible second", reason: "review" },
      { cardId: "blocked", kind: "build", name: "Blocked", reason: "stuck" },
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

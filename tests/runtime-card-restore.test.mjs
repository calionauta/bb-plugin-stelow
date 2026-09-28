import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { restoreCard, restoreTargetStatus } from "../server/runtime/card-restore.ts";
import { ensureInboxResolvedReasonColumn } from "../lib/inbox-events.mjs";
import { createCardOperationsHandlers } from "../server/runtime/card-operations.ts";

function schema() {
  const db = new Database(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE cards (id TEXT PRIMARY KEY);
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
  return db;
}

function harness({ cardValue, fresh = { ok: true, error: null } } = {}) {
  const calls = [];
  const db = schema();
  db.prepare("INSERT INTO cards VALUES (?)").run("card-1");
  const deps = {
    db,
    bb: { realtime: { publish: (...args) => calls.push(["publish", ...args]) } },
    now: () => 300,
    getCard: () => cardValue,
    updateCard: (...args) => calls.push(["update", ...args]),
    workers: {
      fresh: async (...args) => {
        calls.push(["fresh", ...args]);
        return fresh;
      },
      stop: async () => {},
    },
    errors: { cardNotFound: "not found" },
  };
  return { deps, calls, db };
}

test("restore target derives draft at triage and in-progress elsewhere", () => {
  assert.equal(restoreTargetStatus("triage"), "draft");
  assert.equal(restoreTargetStatus("execution"), "in-progress");
  assert.equal(restoreTargetStatus("verification"), "in-progress");
});

test("non-archived cards are refused with the named exit and nothing moves", async () => {
  const { deps, calls } = harness({ cardValue: { id: "card-1", status: "in-progress", stage: "execution", last_error: null } });
  const result = await restoreCard(deps, { cardId: "card-1" });
  assert.deepEqual(result, { ok: false, error: "This card is not archived — restoreCard only restores archived cards." });
  assert.deepEqual(calls, []);
});

test("missing cards are refused without spawning", async () => {
  const { deps, calls } = harness({ cardValue: undefined });
  assert.deepEqual(await restoreCard(deps, { cardId: "card-1" }), { ok: false, error: "not found" });
  assert.deepEqual(calls, []);
});

test("archived cards flip before spawn and publish only after the worker starts", async () => {
  const { deps, calls, db } = harness({
    cardValue: { id: "card-1", status: "archived", stage: "execution", last_error: "boom" },
  });
  db.prepare(
    "INSERT INTO inbox_events (id, card_id, kind, summary, dedupe_key, occurred_at, resolved_at, resolved_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run("evt_q", "card-1", "question", "Q?", "question:card-1:ask_1", 100, 200, "archived");
  assert.deepEqual(await restoreCard(deps, { cardId: "card-1" }), { ok: true, error: null });
  assert.deepEqual(calls[0], ["update", "card-1", { status: "in-progress" }, { restoreFromArchive: true }]);
  assert.deepEqual(calls[1], ["fresh", "card-1", "restart"]);
  assert.deepEqual(calls[2][0], "publish");
  assert.equal(db.prepare("SELECT resolved_at FROM inbox_events WHERE id = ?").get("evt_q").resolved_at, null);
});

test("a failed spawn rolls the status back instead of leaving a phantom wait", async () => {
  const { deps, calls } = harness({
    cardValue: { id: "card-1", status: "archived", stage: "execution", last_error: null },
    fresh: { ok: false, error: "spawn failed" },
  });
  assert.deepEqual(await restoreCard(deps, { cardId: "card-1" }), { ok: false, error: "spawn failed" });
  assert.deepEqual(calls, [
    ["update", "card-1", { status: "in-progress" }, { restoreFromArchive: true }],
    ["fresh", "card-1", "restart"],
    ["update", "card-1", { stage: "execution", status: "archived" }],
  ]);
});

test("dragging an archived card still refuses — terminality for automated paths does not move", async () => {
  const calls = [];
  const cardValue = { id: "card-1", kind: "build", status: "archived", stage: "execution", worker_thread_id: "thread-1" };
  const handlers = createCardOperationsHandlers({
    db: { prepare: () => ({ get: () => null }) },
    bb: { realtime: { publish: (...args) => calls.push(["publish", ...args]) } },
    now: () => 300,
    getCard: () => cardValue,
    workers: { fresh: async () => ({ ok: true, error: null }), stop: async () => {} },
    updateCard: (...args) => calls.push(["update", ...args]),
    releaseClaims: async () => {},
    recordStageEvent: () => {},
    cardStageSlug: async () => "execution",
    fetchPendingAsks: async () => [],
    openExpiredQuestionIds: () => [],
    logCardComment: () => "comment-1",
    resetAutoContinue: () => ({ count: 0, stage: null }),
    buildNudge: () => "continue",
    buildContinueInput: (text) => [{ type: "text", mentions: [], text }],
    splitRequestNudge: "propose split",
    phaseEntryStages: { execution: "execution" },
    errors: { cardNotFound: "not found", cardArchived: "archived" },
  });
  assert.deepEqual(await handlers.moveCard({ cardId: "card-1", status: "in-progress" }), {
    ok: false,
    error: "archived",
  });
  assert.deepEqual(calls, []);
});

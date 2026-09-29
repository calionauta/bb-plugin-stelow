import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { restoreCard, restoreTargetStatus } from "../server/runtime/card-restore.ts";
import { ensureInboxResolvedReasonColumn } from "../lib/inbox-events.mjs";
import { ensureInboxOccurrencesColumn } from "../lib/inbox-error-event.mjs";
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
ensureInboxOccurrencesColumn(db);
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
    logCardComment: (...args) => calls.push(["comment", ...args]),
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
  // The invariant is the ORDER, not an index: the publish must follow the
  // spawn, or the panel repaints a card that has no worker behind it yet. A
  // withheld-question trail sits between them and must not reorder them.
  const kinds = calls.map(([kind]) => kind);
  assert.ok(kinds.indexOf("publish") > kinds.indexOf("fresh"), "publish happens only after the worker starts");
  assert.equal(kinds[kinds.length - 1], "publish", "and it is the last thing restore does");
});

// A withheld question with no trail is a decision that vanished for no stated
// reason. The exit has to be named on the card, not just counted.
test("a withheld question is trailed with its exit, and a card without one is quiet", async () => {
  const withQuestion = harness({
    cardValue: { id: "card-1", status: "archived", stage: "execution", last_error: "boom" },
  });
  withQuestion.db.prepare(
    "INSERT INTO inbox_events (id, card_id, kind, summary, dedupe_key, occurred_at, resolved_at, resolved_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run("evt_q", "card-1", "question", "Q?", "question:card-1:ask_1", 100, 200, "archived");
  await restoreCard(withQuestion.deps, { cardId: "card-1" });
  const note = withQuestion.calls.find(([kind]) => kind === "comment");
  assert.ok(note, "the withheld question leaves a record");
  assert.match(note[5], /1 archived question\(s\) left closed/, "it says how many, and what they were");
  assert.match(note[5], /re-asks anything it still needs/, "and it names the exit rather than leaving homework unstated");

  const clean = harness({
    cardValue: { id: "card-1", status: "archived", stage: "execution", last_error: "boom" },
  });
  await restoreCard(clean.deps, { cardId: "card-1" });
  assert.equal(
    clean.calls.find(([kind]) => kind === "comment"),
    undefined,
    "a restore with nothing withheld says nothing — a trail line on every restore is noise",
  );
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

// Deps complete enough that REMOVING the guard would produce real writes rather
// than a crash. A terminality test whose fixtures are too thin to move a card
// passes for the wrong reason — the same way a drag to a non-existent board
// column proves the schema instead of the rule.
function moveHarness(cardValue) {
  const calls = [];
  const handlers = createCardOperationsHandlers({
    db: { prepare: () => ({ get: () => null }) },
    bb: { realtime: { publish: (...args) => calls.push(["publish", ...args]) } },
    now: () => 300,
    getCard: () => cardValue,
    workers: {
      fresh: async (...args) => {
        calls.push(["fresh", ...args]);
        return { ok: true, error: null };
      },
      stop: async () => {},
    },
    updateCard: (...args) => calls.push(["update", ...args]),
    releaseClaims: async () => {},
    recordStageEvent: () => {},
    cardStageSlug: async () => cardValue.stage,
    fetchPendingAsks: async () => [],
    openExpiredQuestionIds: () => [],
    logCardComment: () => "comment-1",
    resetAutoContinue: () => ({ count: 0, stage: null }),
    buildNudge: () => "continue",
    buildContinueInput: (text) => [{ type: "text", mentions: [], text }],
    splitRequestNudge: "propose split",
    phaseEntryStages: { analysis: "shape", planning: "shape", execution: "execution" },
    stagePhases: { shape: "analysis", critique: "planning", execution: "execution" },
    errors: { cardNotFound: "not found", cardArchived: "archived" },
  });
  return { handlers, calls };
}

test("dragging an archived card refuses on both tracks — terminality for automated paths does not move", async () => {
  // One card per kind, because the two tracks take different branches of the
  // move resolver: a phase target for build, a status target for lightweight. A
  // guard placed inside the resolver would cover one and miss the other, so
  // asserting only the build card would let that regression ship green.
  const build = { id: "card-1", kind: "build", status: "archived", stage: "execution", worker_thread_id: "thread-1" };
  const research = { id: "card-2", kind: "research", status: "archived", stage: "research", worker_thread_id: "thread-2" };

  for (const [cardValue, target] of [[build, "analysis"], [research, "doing"]]) {
    const { handlers, calls } = moveHarness(cardValue);
    assert.deepEqual(
      await handlers.moveCard({ cardId: cardValue.id, status: target }),
      { ok: false, error: "archived" },
      `${cardValue.kind} card dragged to ${target} must refuse`,
    );
    // Nothing at all: no status write, no worker spawn, no claim release.
    assert.deepEqual(calls, [], `${cardValue.kind} refusal must be inert`);
  }
});

test("an archived card dropped back on its own column is a no-op, not a violation", async () => {
  // The most common drag in this UI is nudging a card a few pixels and letting
  // go where it already sat. Answering "This card is archived" for a move that
  // changes nothing teaches people that the guard is noise.
  const cardValue = { id: "card-1", kind: "build", status: "archived", stage: "execution", worker_thread_id: "thread-1" };
  const { handlers, calls } = moveHarness(cardValue);
  assert.deepEqual(await handlers.moveCard({ cardId: "card-1", status: "archived" }), { ok: true, error: null });
  assert.deepEqual(calls, []);
});

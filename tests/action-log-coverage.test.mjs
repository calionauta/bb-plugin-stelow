import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { ensureActionLogTable, listActionLog } from "../lib/action-log.mjs";
import { createActionRecorder } from "../server/runtime/action-log-runtime.ts";
import { withActionRecorder } from "../server/runtime/action-log-rpc.ts";
import { questionWaitStart, recordCardAnswer } from "../server/runtime/question-answer-log.ts";
import { startReconciler } from "../server/runtime/reconciler.ts";

// The three signals wired into the flight recorder last, each with the rule a
// reader depends on:
//
//   question.answered   the dwell starts at the oldest OPEN question, and an
//                       unknown wait is null — never the epoch.
//   rpc.call            a thread-only input is attributed through the resolver;
//                       a resolver that throws costs the attribution, not the row.
//   card.tick           a tick that lost a phase says "partial" AND names it,
//                       while a clean tick says "ok" with no failed list.

const INBOX_SCHEMA = `CREATE TABLE inbox_events (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  occurred_at INTEGER NOT NULL,
  read_at INTEGER,
  archived_at INTEGER,
  resolved_at INTEGER,
  resolved_reason TEXT,
  severity INTEGER,
  severity_reasons TEXT,
  occurrences INTEGER
)`;

function inboxDb() {
  const db = new Database(":memory:");
  db.exec(INBOX_SCHEMA);
  return db;
}

function addEvent(db, { id, cardId, kind = "question", at, resolvedAt = null }) {
  db.prepare(
    "INSERT INTO inbox_events (id, card_id, kind, summary, dedupe_key, occurred_at, resolved_at) "
    + "VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, cardId, kind, id, `dedupe:${id}`, at, resolvedAt);
}

function collectingActions() {
  const recorded = [];
  return {
    recorded,
    record(entry) {
      recorded.push(entry);
      return { id: `act_${recorded.length}`, occurrences: 1, deduped: false };
    },
  };
}

test("questionWaitStart measures the oldest OPEN question, not the oldest one", () => {
  const db = inboxDb();
  try {
    addEvent(db, { id: "q_resolved_first", cardId: "card_1", at: 500, resolvedAt: 600 });
    addEvent(db, { id: "q_live_a", cardId: "card_1", at: 1_000 });
    addEvent(db, { id: "q_live_b", cardId: "card_1", at: 2_000 });
    // An open row of another kind must not define the wait: a pause that
    // predates the question is not time the person spent answering it.
    addEvent(db, { id: "pause_open", cardId: "card_1", kind: "paused", at: 100 });

    assert.equal(
      questionWaitStart({ db }, "card_1"),
      1_000,
      "the resolved 500 is skipped and the older of the two open questions wins",
    );
  } finally {
    db.close();
  }
});

test("questionWaitStart returns null when no question is open", () => {
  const db = inboxDb();
  try {
    addEvent(db, { id: "q_done", cardId: "card_1", at: 500, resolvedAt: 600 });
    assert.equal(
      questionWaitStart({ db }, "card_1"),
      null,
      "no open question is an unknown wait, not a wait starting at 0",
    );
    assert.equal(
      questionWaitStart({ db: { prepare() { throw new Error("no such table"); } } }, "card_1"),
      null,
      "an unreadable start is also unknown, never a thrown answer",
    );
  } finally {
    db.close();
  }
});

test("questionWaitStart does not read one card's wait from another card", () => {
  const db = inboxDb();
  try {
    addEvent(db, { id: "a_open", cardId: "card_a", at: 1_000 });
    addEvent(db, { id: "b_resolved", cardId: "card_b", at: 400, resolvedAt: 450 });
    addEvent(db, { id: "b_open", cardId: "card_b", at: 3_000 });

    assert.equal(questionWaitStart({ db }, "card_a"), 1_000);
    assert.equal(
      questionWaitStart({ db }, "card_b"),
      3_000,
      "B's resolved row is older, but B's wait is its open question",
    );
  } finally {
    db.close();
  }
});

test("recordCardAnswer records the card door's row with no dwell when the start is unknown", () => {
  const actions = collectingActions();
  recordCardAnswer({ actions }, "card_1", "thr_1", "live", 2, null);

  assert.equal(actions.recorded.length, 1, "one answered batch is one row");
  const row = actions.recorded[0];
  assert.equal(row.kind, "question.answered");
  assert.equal(row.outcome, "ok");
  assert.equal(row.cardId, "card_1");
  assert.equal(row.threadId, "thr_1");
  assert.deepEqual(row.detail, { via: "live", decisions: 2 });
  assert.equal(row.durationMs, null, "an unknown wait is null, never zero or epoch-sized");
});

test("recordCardAnswer measures the dwell from the wait start", () => {
  const actions = collectingActions();
  recordCardAnswer({ actions }, "card_1", null, "expired", 1, Date.now() - 5_000);

  const row = actions.recorded[0];
  assert.equal(row.detail.via, "expired", "the recovery door names itself");
  assert.ok(row.durationMs >= 4_000, `a 5 s wait cannot read ${row.durationMs} ms`);
  assert.ok(row.durationMs < 15_000, `a 5 s wait cannot read ${row.durationMs} ms`);
});

test("recordCardAnswer without a recorder is a no-op, not a throw", () => {
  assert.doesNotThrow(() => recordCardAnswer({}, "card_1", null, "live", 1, null));
});

test("withActionRecorder attributes a thread-only input through the resolver", async () => {
  const actions = collectingActions();
  const wrapped = withActionRecorder(
    { "card.by-worker-thread": async () => ({ ok: true }) },
    actions,
    () => 5_000,
    (threadId) => (threadId === "thr_9" ? "card_resolved" : null),
  );

  assert.deepEqual(await wrapped["card.by-worker-thread"]({ threadId: "thr_9" }), { ok: true });
  const row = actions.recorded[0];
  assert.equal(row.kind, "rpc.call");
  assert.equal(row.cardId, "card_resolved", "the resolver names the card the contract omitted");
  assert.equal(row.threadId, "thr_9");
});

test("a resolver that throws costs the attribution, never the row", async () => {
  const actions = collectingActions();
  const wrapped = withActionRecorder(
    { "card.by-worker-thread": async () => ({ ok: true }) },
    actions,
    () => 5_000,
    () => {
      throw new Error("database is locked");
    },
  );

  await wrapped["card.by-worker-thread"]({ threadId: "thr_9" });
  assert.equal(actions.recorded.length, 1, "the invocation is still recorded");
  const row = actions.recorded[0];
  assert.equal(row.outcome, "ok");
  assert.equal(row.cardId, null, "an unreadable lookup loses the card, not the event");
  assert.equal(row.threadId, "thr_9", "the thread is still there to join on");
});

test("without a resolver a thread-only input still records the row", async () => {
  const actions = collectingActions();
  const wrapped = withActionRecorder(
    { "card.by-worker-thread": async () => ({ ok: true }) },
    actions,
    () => 5_000,
  );

  await wrapped["card.by-worker-thread"]({ threadId: "thr_9" });
  assert.equal(actions.recorded.length, 1);
  assert.equal(actions.recorded[0].cardId, null);
  assert.equal(actions.recorded[0].threadId, "thr_9");
});

// A database that answers every statement with nothing, and throws on exactly
// the live-card query. That is the smallest injection that fails one phase:
// dropping only `cards` in a real sqlite fixture would reach the same place,
// but this keeps the test about the tick's failure bookkeeping rather than
// about a schema a migration did not create.
function reconcilerDb(failLiveQuery) {
  return {
    open: true,
    prepare(sql) {
      if (failLiveQuery() && sql.includes("SELECT id FROM cards")) {
        throw new Error("no such table: cards");
      }
      return { all: () => [], get: () => undefined, run: () => ({ changes: 0 }) };
    },
    transaction: (run) => () => run(),
  };
}

test("a partial tick records which phase threw, and a clean tick records ok", () => {
  const log = new Database(":memory:");
  ensureActionLogTable(log);
  const actions = createActionRecorder({ db: log, now: () => 9_000 });
  let failLiveQuery = true;
  let clock = 1_000;
  const errors = [];
  const reconciler = startReconciler({
    db: reconcilerDb(() => failLiveQuery),
    now: () => (clock += 5),
    syncThreadState: async () => {},
    scopeProgress: { sync: async () => {}, prune: () => {} },
    maybeBumpSeverity: async () => {},
    notifyClaimWaiters: async () => {},
    onError: (phase) => { errors.push(phase); },
    actions,
    scheduler: { setInterval: () => 1, clearInterval: () => {} },
  });

  try {
    reconciler.tick();
    assertPartialTick(log, errors);
    failLiveQuery = false;
    reconciler.tick();
    assertCleanTick(log);
  } finally {
    reconciler.dispose();
    log.close();
  }
});

function assertPartialTick(log, errors) {
  const partial = listActionLog(log, { outcome: "partial" });
  assert.equal(partial.length, 1, "one tick that lost a phase is one row");
  assert.equal(partial[0].kind, "card.tick");
  assert.equal(partial[0].cause, "card.tick");
  const detail = JSON.parse(partial[0].detail);
  assert.deepEqual(
    detail.failed,
    ["reconcile live cards"],
    "the row names the phase, so a reader does not have to open the host log",
  );
  assert.equal(
    typeof detail.phases["reconcile live cards"],
    "number",
    "the row also says how long each phase took",
  );
  assert.equal(typeof partial[0].durationMs, "number");
  assert.ok(partial[0].durationMs > 0, "the tick's elapsed time is measured, not hardcoded");
  assert.deepEqual(errors, ["reconcile live cards"], "the host log is told once, by name");
}

function assertCleanTick(log) {
  const ok = listActionLog(log, { outcome: "ok", kind: "card.tick" });
  assert.equal(ok.length, 1, "the clean tick is not folded onto the partial one");
  assert.equal(ok[0].occurrences, 1);
  const detail = JSON.parse(ok[0].detail);
  assert.equal("failed" in detail, false, "a clean tick carries no failed list");
  assert.deepEqual(
    Object.keys(detail.phases).sort(),
    ["reconcile live cards", "release expired claims", "release terminal claims", "renew live claims", "sweep inbox aging"],
    "every phase reports its own duration, even on a clean tick",
  );
}

console.log("action log coverage test ok: question wait, answer dwell, resolver attribution, partial tick");

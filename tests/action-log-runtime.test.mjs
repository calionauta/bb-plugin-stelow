import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { ensureActionLogTable, listActionLog } from "../lib/action-log.mjs";
import { createActionRecorder } from "../server/runtime/action-log-runtime.ts";
import { withActionRecorder } from "../server/runtime/action-log-rpc.ts";

function freshDb() {
  const db = new Database(":memory:");
  ensureActionLogTable(db);
  return db;
}

test("the kill switch writes nothing and reports itself as disabled", () => {
  const db = freshDb();
  const recorder = createActionRecorder({ db, now: () => 1_000, enabled: false });

  assert.equal(recorder.enabled, false);
  assert.equal(recorder.record({ kind: "rpc.call", outcome: "ok" }), null);
  assert.equal(listActionLog(db).length, 0, "a disabled recorder leaves no row");
  assert.equal(recorder.list().length, 0, "reads still work against the empty table");
});

test("STELOW_ACTION_LOG=0 disables a recorder built without an explicit flag", () => {
  const previous = process.env.STELOW_ACTION_LOG;
  process.env.STELOW_ACTION_LOG = "0";
  try {
    const recorder = createActionRecorder({ db: freshDb(), now: () => 1_000 });
    assert.equal(recorder.enabled, false, "the environment switch is read at construction");
  } finally {
    if (previous === undefined) delete process.env.STELOW_ACTION_LOG;
    else process.env.STELOW_ACTION_LOG = previous;
  }
});

test("an enabled recorder writes the entry and returns the row summary", () => {
  const db = freshDb();
  const recorder = createActionRecorder({ db, now: () => 1_000 });

  const written = recorder.record({
    kind: "cli.call",
    actor: "agent",
    outcome: "refused",
    cause: "cli.usage",
    cardId: "card_1",
    detail: { verb: "done" },
  });
  assert.deepEqual(written, { id: written.id, occurrences: 1, deduped: false });
  const rows = listActionLog(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].at, 1_000, "the injected clock stamps the row");
  assert.equal(rows[0].cardId, "card_1");
  assert.equal(rows[0].cause, "cli.usage");
  assert.deepEqual(JSON.parse(rows[0].detail), { verb: "done" });

  const repeat = recorder.record({
    kind: "cli.call",
    actor: "agent",
    outcome: "refused",
    cause: "cli.usage",
    cardId: "card_1",
  });
  assert.equal(repeat.occurrences, 2, "the wrapper keeps the lib's dedupe");
  assert.equal(recorder.summarize().length, 1);
});

test("a broken database never throws out of record and reports once per distinct message", () => {
  const failures = [];
  let prepares = 0;
  const db = {
    prepare() {
      prepares += 1;
      throw new Error(prepares <= 3 ? "database is locked" : "disk I/O error");
    },
  };
  const recorder = createActionRecorder({
    db,
    now: () => 1_000,
    onFailure: (message) => failures.push(message),
  });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(
      recorder.record({ kind: "rpc.call", outcome: "ok" }),
      null,
      "a write failure reads as a missing row, never as a thrown error",
    );
  }
  assert.deepEqual(failures, [
    "action log: database is locked",
    "action log: disk I/O error",
  ], "one report per distinct message, not one per failure");
});

test("the RPC wrapper records one rpc.call row without the input payload", async () => {
  const db = freshDb();
  const actions = createActionRecorder({ db, now: () => 5_000 });
  const input = {
    cardId: "card_1",
    threadId: "thr_1",
    prompt: "SECRET PROMPT THAT MUST NOT BE COPIED",
    text: "SECRET BODY",
  };
  const handlers = {
    "card.get": async () => ({ ok: true }),
  };
  const wrapped = withActionRecorder(handlers, actions, () => 5_000);

  assert.deepEqual(await wrapped["card.get"](input), { ok: true });

  const rows = listActionLog(db);
  assert.equal(rows.length, 1, "one invocation, one row");
  assert.equal(rows[0].kind, "rpc.call");
  assert.equal(rows[0].layer, "intent");
  assert.equal(rows[0].surface, "rpc");
  assert.equal(rows[0].actor, "client");
  assert.equal(rows[0].outcome, "ok");
  assert.equal(rows[0].cause, null, "a success names no condition");
  assert.equal(rows[0].cardId, "card_1", "the card is taken from input.cardId");
  assert.equal(rows[0].threadId, "thr_1");
  assert.equal(rows[0].durationMs, 0);

  const detail = JSON.parse(rows[0].detail);
  assert.equal(detail.name, "card.get", "the stored detail names the handler");
  assert.equal("prompt" in detail, false, "the input prompt is not copied into detail");
  assert.equal("text" in detail, false, "the input body is not copied into detail");
  assert.ok(!rows[0].detail.includes("SECRET"), "no input payload reaches the row");
  assert.ok(!JSON.stringify(rows[0]).includes("SECRET"), "and no other column copies it either");
});

test("the RPC wrapper records an error cause and rethrows the original error", async () => {
  const db = freshDb();
  const actions = createActionRecorder({ db, now: () => 7_000 });
  const original = new Error("card not found");
  const handlers = {
    "card.done": async () => {
      throw original;
    },
  };
  const wrapped = withActionRecorder(handlers, actions, () => 7_000);

  let caught;
  try {
    await wrapped["card.done"]({ cardId: "card_2", threadId: "thr_2", text: "SECRET BODY" });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught, original, "the handler's error object is rethrown unchanged");

  const rows = listActionLog(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, "error");
  assert.equal(rows[0].cause, "rpc.not-found", "the cause is a code derived from the error");
  assert.equal(rows[0].cardId, "card_2");
  const detail = JSON.parse(rows[0].detail);
  assert.equal(detail.name, "card.done");
  assert.equal(detail.message, "card not found");
  assert.ok(!rows[0].detail.includes("SECRET"), "an error row does not copy the input either");
});

test("the RPC wrapper keeps the generic error cause for an unnamed failure", async () => {
  const db = freshDb();
  const actions = createActionRecorder({ db, now: () => 7_000 });
  const wrapped = withActionRecorder({
    "card.nope": async () => {
      throw new Error("kaboom");
    },
  }, actions, () => 7_000);

  await assert.rejects(() => wrapped["card.nope"]({}), /kaboom/);
  assert.equal(listActionLog(db)[0].cause, "rpc.error");
});

test("withActionRecorder returns a new bag and leaves the input bag alone", async () => {
  const db = freshDb();
  const actions = createActionRecorder({ db, now: () => 9_000 });
  const original = async () => "ran";
  const handlers = { ping: original, note: "not a function" };
  const before = Object.keys(handlers);

  const wrapped = withActionRecorder(handlers, actions, () => 9_000);

  assert.notEqual(wrapped, handlers, "the returned bag is a new object");
  assert.deepEqual(Object.keys(wrapped), before, "the bag keeps every handler");
  assert.notEqual(wrapped.ping, original, "handlers are wrapped, not reused");
  assert.equal(wrapped.note, "not a function", "non-function entries are copied through");
  assert.equal(handlers.ping, original, "the caller's handler is not replaced");
  assert.deepEqual(Object.keys(handlers), before, "wrapping adds no keys to the caller's bag");

  assert.equal(await wrapped.ping(), "ran");
  assert.equal(listActionLog(db)[0].cardId, null, "no input means no card attribution");
  assert.deepEqual(Object.keys(handlers), before, "invoking the wrapper does not mutate the bag");
});

console.log("action log runtime test ok: kill switch, failure isolation, RPC wrapping");

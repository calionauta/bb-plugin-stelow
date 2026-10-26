// Behavior: a card question is THIS plugin's own renderer, not every pending
// interaction the host returns for a thread. `threads.interactions.list` also
// lists the built-in `ask-user-question` plugin's form; treating that as a
// card question makes a foreign payload look answerable here, and answering it
// sends the wrong value shape. This file drives the real createQuestionInbox
// against a thin fake host, so the filter is exercised where it runs.
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createQuestionInbox } from "../server/runtime/question-inbox.ts";
import { QUESTION_RENDERER_ID } from "../lib/question-batch.mjs";

const ownPayload = () => ({
  data: {
    question: "Pick one",
    multiple: false,
    kind: "standard",
    options: [{ label: "A", description: "first" }],
  },
});

function interaction(id, status, pluginId, rendererId, payload) {
  return { id, status, origin: { kind: "plugin", pluginId, rendererId }, payload };
}

// Everything the host can put on one thread: our pending ask, the native
// plugin's ask, our own already-resolved ask, and another plugin's ask.
function threadInteractions() {
  return [
    interaction("pint_own", "pending", "stelow", QUESTION_RENDERER_ID, ownPayload()),
    interaction("pint_native", "pending", "ask-user-question", "ask-user-question", {
      data: {
        questions: [{
          id: "q0",
          prompt: "Native question?",
          multiSelect: false,
          options: [{ label: "A", description: "first" }],
        }],
      },
    }),
    interaction("pint_own_resolved", "resolved", "stelow", QUESTION_RENDERER_ID, ownPayload()),
    interaction("pint_other", "pending", "other-plugin", "other-renderer", ownPayload()),
  ];
}

function makeInbox({ list = async () => threadInteractions() } = {}) {
  const db = new Database(":memory:");
  db.exec(
    `CREATE TABLE expired_questions (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      thread_id TEXT,
      question TEXT,
      multiple INTEGER NOT NULL DEFAULT 0,
      kind TEXT,
      locale TEXT,
      options TEXT,
      expired_at INTEGER NOT NULL,
      answered INTEGER NOT NULL DEFAULT 0
    )`,
  );
  const synced = [];
  const inbox = createQuestionInbox({
    db,
    bb: {
      pluginId: "stelow",
      sdk: { threads: { interactions: { list } } },
    },
    syncPendingQuestionInbox: (card, ids, question) => {
      synced.push({ card, ids, question });
    },
  });
  return { db, inbox, synced };
}

const card = { id: "card_1", worker_thread_id: "thr_1" };

test("fetchPendingAsks keeps only this plugin's own pending renderer", async () => {
  const { db, inbox } = makeInbox();
  const asks = await inbox.fetchPendingAsks("thr_1");
  assert.ok(Array.isArray(asks), "a readable thread returns a list, not null");
  assert.equal(asks.length, 1, "exactly one of the four interactions is a card question");
  assert.equal(asks[0].id, "pint_own", "the surviving ask is our own pending interaction");
  const ids = asks.map((entry) => entry.id);
  for (const excluded of ["pint_native", "pint_own_resolved", "pint_other"]) {
    assert.ok(!ids.includes(excluded), `${excluded} must not be treated as a card question`);
  }
  db.close();
});

test("countOpenQuestions counts only our live ask, not foreign or resolved ones", async () => {
  const { db, inbox } = makeInbox();
  const counts = await inbox.countOpenQuestions([card]);
  assert.ok(counts instanceof Map, "counts come back per card");
  assert.deepEqual(
    counts.get("card_1"),
    { expired: 0, live: 1 },
    "the native, resolved, and other-plugin interactions add nothing to the live count",
  );
  db.close();
});

test("syncOpenQuestionInbox syncs our interaction id only", async () => {
  const { db, inbox, synced } = makeInbox();
  const syncedIds = await inbox.syncOpenQuestionInbox(card);
  assert.deepEqual(syncedIds, ["pint_own"], "the inbox owns exactly the pending own ask");
  assert.equal(synced.length, 1, "the callback is invoked once per sync");
  assert.equal(synced[0].card.id, "card_1", "the callback receives the card it was asked about");
  assert.deepEqual(synced[0].ids, ["pint_own"], "the native interaction id is never handed to the inbox");
  assert.ok(!synced[0].ids.includes("pint_native"), "the built-in plugin's id cannot leak into the card's inbox");
  assert.deepEqual(
    synced[0].question,
    { summary: "Pick one", count: 1, kind: null },
    "the row line describes our question, one item, no split",
  );
  db.close();
});

test("a failed interaction read is unknown, never an empty inbox", async () => {
  const { db, inbox } = makeInbox({
    list: async () => {
      throw new Error("host unavailable");
    },
  });
  assert.equal(
    await inbox.fetchPendingAsks("thr_1"),
    null,
    "a poll hiccup keeps the existing state instead of claiming the question vanished",
  );
  db.close();
});

console.log("question inbox own-plugin test ok: native, resolved, and foreign asks excluded");

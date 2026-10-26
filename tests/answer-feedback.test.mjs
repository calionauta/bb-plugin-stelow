import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  answerFeedbackBlock,
  answerFeedbackHolds,
  commentDeliveryLine,
} from "../lib/answer-feedback.mjs";
import {
  markCommentsCarried,
  openExpiredCount,
  pendingAnswerComments,
} from "../server/runtime/answer-feedback.ts";
import { createCardMutationHandlers } from "../server/runtime/card-mutations.ts";
import { ensureColumns } from "../lib/sqlite-columns.mjs";
import { ensureCommentDeliveryColumn } from "../server/core-migrations.ts";

/**
 * A comment written while the card waits on an answer belongs to that answer.
 *
 * What regresses if these fail: the comment wakes the worker mid-read, so the
 * person's picks arrive as a second turn and the first turn acts on half a
 * thought — and the composer keeps telling them it was "sent to the agent"
 * when the comment is only parked on the card.
 */

function store() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE comments (
    id TEXT PRIMARY KEY, card_id TEXT NOT NULL, target TEXT NOT NULL,
    target_id TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL,
    created_at INTEGER NOT NULL)`);
  db.exec("CREATE TABLE expired_questions (id TEXT PRIMARY KEY, card_id TEXT, answered INTEGER NOT NULL DEFAULT 0)");
  db.exec("ALTER TABLE comments ADD COLUMN delivered_at INTEGER");
  return db;
}

function seed(db, rows) {
  const insert = db.prepare(
    "INSERT INTO comments (id, card_id, target, target_id, author, body, created_at) VALUES (?, 'card_1', 'card', 'card_1', ?, ?, ?)",
  );
  rows.forEach(([id, author, body], index) => insert.run(id, author, body, index));
}

test("the hold decision: an answer is still expected", () => {
  assert.equal(answerFeedbackHolds({ activity: "awaiting-answer" }), true);
  assert.equal(answerFeedbackHolds({ activity: "awaiting-answer", openExpired: 0 }), true);
  // A timed-out ask is answered later, so a comment during it belongs to that
  // answer even though the card no longer reads `awaiting-answer`.
  assert.equal(answerFeedbackHolds({ activity: "idle", openExpired: 2 }), true);
  assert.equal(answerFeedbackHolds({ activity: "running", openExpired: 0 }), false);
  assert.equal(answerFeedbackHolds({}), false);
  assert.equal(answerFeedbackHolds(null), false);
});

test("the block carries the comments verbatim, under one heading", () => {
  assert.equal(answerFeedbackBlock([]), null);
  assert.equal(answerFeedbackBlock(["   "]), null);
  assert.equal(answerFeedbackBlock(null), null);
  const block = answerFeedbackBlock(["Re design/a.md:\n\n> the quote", "Re b.md:\n\nkeep it"]);
  assert.match(block, /^## Feedback written while answering/);
  assert.match(block, /### Comment 1\n\nRe design\/a\.md:\n\n> the quote/);
  assert.match(block, /### Comment 2\n\nRe b\.md:\n\nkeep it/);
  // The composer already formats the quote; a second formatter here would be a
  // second author of the same words.
  assert.doesNotMatch(block, /^>{3}/m);
});

test("the composer's line never claims a send that did not happen", () => {
  assert.equal(commentDeliveryLine("sent", null), null);
  const rides = commentDeliveryLine("rides-answer", null);
  assert.match(rides, /will go with your answer/);
  assert.doesNotMatch(rides, /sent to the agent/);
  const queued = commentDeliveryLine("queued", null);
  assert.match(queued, /Comment saved\./);
  assert.match(queued, /no action needed/);
});

test("pending comments are the user's, and marking one carried retires it", () => {
  const db = store();
  seed(db, [["c1", "user", "first"], ["c2", "agent", "trail"], ["c3", "user", "second"]]);
  const pending = pendingAnswerComments(db, "card_1");
  // The agent's own trail comments never ride: feeding them back would make the
  // worker answer itself.
  assert.deepEqual(pending.ids, ["c1", "c3"]);
  assert.match(pending.block, /first/);
  assert.match(pending.block, /second/);
  assert.doesNotMatch(pending.block, /trail/);

  markCommentsCarried(db, pending.ids, 99);
  assert.deepEqual(pendingAnswerComments(db, "card_1").ids, []);
  assert.equal(pendingAnswerComments(db, "card_1").block, null);
  // Marking again writes nothing, so a retried answer cannot double-stamp.
  markCommentsCarried(db, pending.ids, 100);
  assert.equal(db.prepare("SELECT delivered_at FROM comments WHERE id = 'c1'").get().delivered_at, 99);
});

test("only open recovery questions count as an expected answer", () => {
  const db = store();
  db.prepare("INSERT INTO expired_questions (id, card_id, answered) VALUES ('q1', 'card_1', 0)").run();
  db.prepare("INSERT INTO expired_questions (id, card_id, answered) VALUES ('q2', 'card_1', 1)").run();
  assert.equal(openExpiredCount(db, "card_1"), 1);
  assert.equal(openExpiredCount(db, "card_2"), 0);
});

// The upgrade case: a column added as null says "no answer has carried this
// comment" about every comment the card ever collected, so the first answer after
// the upgrade would send the card's whole history to the worker. What regresses
// if this fails: either the history rides (no backfill) or the comments genuinely
// waiting are stamped by a restart (an unconditional backfill).
test("the delivery column backfills history once, and never a waiting comment", () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE comments (id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at INTEGER NOT NULL)`);
  db.prepare("INSERT INTO comments (id, body, created_at) VALUES ('old', 'history', 5)").run();
  ensureCommentDeliveryColumn(db);
  assert.equal(db.prepare("SELECT delivered_at FROM comments WHERE id = 'old'").get().delivered_at, 5);

  // Written after the migration and waiting for the next answer; a second boot
  // must leave it pending or it never rides.
  db.prepare("INSERT INTO comments (id, body, created_at) VALUES ('waiting', 'now', 9)").run();
  ensureCommentDeliveryColumn(db);
  assert.equal(db.prepare("SELECT delivered_at FROM comments WHERE id = 'waiting'").get().delivered_at, null);
});

test("the comments column is additive and safe to re-run", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE comments (id TEXT PRIMARY KEY)");
  ensureColumns(db, "comments", [["delivered_at", "INTEGER"]]);
  ensureColumns(db, "comments", [["delivered_at", "INTEGER"]]);
  assert.deepEqual(
    db.prepare("PRAGMA table_info(comments)").all().map((column) => column.name),
    ["id", "delivered_at"],
  );
});

function commentHarness(activity, send, threadId = "thread_1") {
  const calls = { sends: [], updates: [] };
  const db = store();
  const handlers = createCardMutationHandlers({
    db,
    bb: {
      sdk: {
        files: { read: async () => ({ content: "" }), write: async () => undefined },
        threads: {
          send: async (input) => {
            calls.sends.push(input);
            return send();
          },
        },
      },
      realtime: { publish: () => undefined },
    },
    now: () => 10,
    getCard: () => ({
      id: "card_1",
      name: "Card",
      status: "in-progress",
      stage: "shape",
      kind: "build",
      activity,
      worker_thread_id: threadId,
      last_assistant_text: "working",
      dir_hash: null,
    }),
    cardWorkspace: async () => ({ path: "/project", hostId: null }),
    workflowStateDir: async () => "/project/.stelow/run",
    logCardComment: (_cardId, _target, _targetId, _author, body) => {
      db.prepare(
        "INSERT INTO comments (id, card_id, target, target_id, author, body, created_at) VALUES ('c1', 'card_1', 'card', 'card_1', 'user', ?, 1)",
      ).run(body);
      return "c1";
    },
    markReviewSatisfied: async () => ({ marked: false }),
    updateCard: (_cardId, values) => calls.updates.push(values),
    errors: { cardNotFound: "missing", cardArchived: "archived" },
  });
  return { calls, db, handlers };
}

const COMMENT = { cardId: "card_1", target: "card", targetId: "card_1", body: "Re a.md: the quote" };

test("a comment during an open ask is saved and never wakes the worker", async () => {
  const { calls, db, handlers } = commentHarness("awaiting-answer", () => ({ delivery: "sent" }));
  const result = await handlers.addCardComment(COMMENT);
  assert.equal(result.error, null);
  assert.equal(result.delivery, "rides-answer");
  assert.match(result.deliveryLine, /will go with your answer/);
  assert.equal(calls.sends.length, 0, "sending now would wake the worker mid-read");
  // Saved, and still pending for the answer that will carry it.
  assert.deepEqual(pendingAnswerComments(db, "card_1").ids, ["c1"]);
  assert.deepEqual(calls.updates, [], "the card does not move for a parked comment");
});

test("a comment with no ask open is sent and stamped carried", async () => {
  const { calls, db, handlers } = commentHarness("running", () => ({ delivery: "sent" }));
  const result = await handlers.addCardComment(COMMENT);
  assert.equal(result.delivery, "sent");
  assert.equal(result.deliveryLine, null);
  assert.equal(calls.sends.length, 1);
  assert.deepEqual(pendingAnswerComments(db, "card_1").ids, []);
});

test("a comment the host queues is not stamped carried", async () => {
  const { calls, db, handlers } = commentHarness("running", () => ({
    delivery: "queued",
    queuedMessage: { waitingOn: { kind: "plugin", reason: "4 of 4 running on host alpha" } },
  }));
  const result = await handlers.addCardComment(COMMENT);
  assert.equal(result.delivery, "queued");
  assert.match(result.deliveryLine, /4 of 4 running on host alpha/);
  // The host dispatches it itself, so it is on its way — but stamping it carried
  // would claim a delivery that has not happened.
  assert.deepEqual(pendingAnswerComments(db, "card_1").ids, ["c1"]);
  assert.equal(calls.updates[0].activity, "held");
});

// The route-level half of the hold rule: `answerFeedbackHolds` is tested on its
// own, but nothing pinned that the COMMENT PATH asks it with the recovery rows.
// What regresses if this fails: a comment on an idle card with an open recovery
// question is sent immediately and wakes the worker mid-read.
test("a comment waits on an idle card that still has a recovery question", async () => {
  const { calls, db, handlers } = commentHarness("idle", () => ({ delivery: "sent" }));
  db.prepare("INSERT INTO expired_questions (id, card_id, answered) VALUES ('q1', 'card_1', 0)").run();
  const result = await handlers.addCardComment(COMMENT);
  assert.equal(result.delivery, "rides-answer");
  assert.equal(calls.sends.length, 0);
});

// A comment on a scope or a task is the card's record; the worker is not woken by
// it. It used to report `delivery: null` with no line, which made the composer
// fall back to "Comment sent to the agent" — a claim about a send that never
// happened.
test("a comment that woke nothing says so instead of claiming a send", async () => {
  const { calls, handlers } = commentHarness("running", () => ({ delivery: "sent" }));
  const result = await handlers.addCardComment({ ...COMMENT, target: "scope", targetId: "s1" });
  assert.equal(result.error, null);
  assert.equal(result.delivery, "saved");
  assert.match(result.deliveryLine, /Nothing was sent to the worker/);
  assert.equal(calls.sends.length, 0);
});

test("a card with no live worker reports a saved comment, not a sent one", async () => {
  const { calls, handlers } = commentHarness("idle", () => ({ delivery: "sent" }), null);
  const result = await handlers.addCardComment(COMMENT);
  assert.equal(result.error, null);
  assert.equal(result.delivery, "saved");
  assert.equal(calls.sends.length, 0, "there is nobody to wake");
});

// The migration is exported and order-dependent on `createBaseTables`. A guard is
// cheaper than a crash in a caller that runs it first on a fresh database.
test("the delivery migration tolerates a database without the comments table", () => {
  const db = new Database(":memory:");
  assert.doesNotThrow(() => ensureCommentDeliveryColumn(db));
});

// The race the module's own docstring names: a comment written while the answer
// is being sent is not in the set that answer read, so it cannot be stamped by
// it. What regresses if this fails: the comment is marked carried by an answer
// that never contained it, and it is silently lost.
test("a comment written after the answer read rides the next answer", () => {
  const db = store();
  seed(db, [["c1", "user", "before the answer"]]);
  const read = pendingAnswerComments(db, "card_1");
  // ...the person submits, and types one more while it is in flight.
  db.prepare(
    "INSERT INTO comments (id, card_id, target, target_id, author, body, created_at) VALUES ('c2', 'card_1', 'card', 'card_1', 'user', 'after the read', 5)",
  ).run();
  markCommentsCarried(db, read.ids, 42);
  assert.deepEqual(pendingAnswerComments(db, "card_1").ids, ["c2"]);
});

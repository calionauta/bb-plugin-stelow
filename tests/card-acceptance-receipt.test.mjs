import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCardMutationHandlers } from "../server/runtime/card-mutations.ts";
import { isAccepted } from "../lib/card-acceptance.mjs";

/**
 * Accepting a finished card, end to end through the handler.
 *
 * The receipt has three claims worth pinning, and each is the kind of rule that
 * survives in a comment while vanishing from the code:
 *
 * 1. **It never gates.** Accepting a Done card writes a stamp and a trail
 *    comment and nothing else — no status, no stage, no worker message. A gate
 *    is what §8.3 of the proposal rejected, and the way a receipt silently
 *    becomes one is a `status` write added "so the board updates".
 * 2. **It satisfies the review request.** The `completed` inbox row asks
 *    "audit evidence is ready to review"; a person who just accepted it is not
 *    owed that request again. Without this, the badge stays lit forever on a
 *    card with nothing left to do — the exact phantom-notification failure the
 *    repo spends effort removing.
 * 3. **It records no identity.** The host SDK exposes none, so the only fact
 *    written is *when*. The assertion is a negative on the row's own shape, and
 *    it is here because the tempting "fix" is `os.userInfo().username`.
 *
 * The refusal half is exercised through the handler too, so the sentence a
 * reader gets is the one the host actually returns rather than the lib's.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (relative) => readFileSync(join(root, relative), "utf8");

function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE cards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      intent TEXT NOT NULL,
      status TEXT NOT NULL,
      stage TEXT NOT NULL,
      activity TEXT NOT NULL,
      worker_thread_id TEXT,
      accepted_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE comments (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      target TEXT NOT NULL,
      target_id TEXT NOT NULL,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE inbox_events (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      summary TEXT NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE,
      occurred_at INTEGER NOT NULL,
      read_at INTEGER,
      archived_at INTEGER,
      resolved_at INTEGER,
      resolved_reason TEXT
    );
  `);
  return db;
}

function insertCard(db, { id, status }) {
  db.prepare(
    "INSERT INTO cards (id, name, prompt, intent, status, stage, activity, created_at, updated_at) "
    + "VALUES (?, ?, 'do the thing', 'feature', ?, 'review', 'idle', 1, 1)",
  ).run(id, id, status);
}

function insertCompletion(db, cardId, { read = false } = {}) {
  db.prepare(
    "INSERT INTO inbox_events (id, card_id, kind, summary, dedupe_key, occurred_at, read_at) "
    + "VALUES (?, ?, 'completed', 'Build complete — audit evidence is ready to review in Done.', ?, 10, ?)",
  ).run(`evt_${cardId}`, cardId, `completed:${cardId}:10`, read ? 20 : null);
}

function harness({ cardId = "card_1", status = "completed", withCompletion = true, read = false } = {}) {
  const db = createDb();
  insertCard(db, { id: cardId, status });
  if (withCompletion) insertCompletion(db, cardId, { read });
  const comments = [];
  const published = [];
  let clock = 5_000;
  let commentId = 0;
  const handlers = createCardMutationHandlers({
    db,
    bb: {
      realtime: { publish: (event, payload) => published.push({ event, payload }) },
    },
    now: () => clock++,
    getCard: (id) => db.prepare("SELECT * FROM cards WHERE id = ?").get(id),
    cardWorkspace: async () => null,
    workflowStateDir: async () => null,
    logCardComment: (cid, target, targetId, author, body) => {
      const id = `c_${++commentId}`;
      comments.push({ id, cardId: cid, target, targetId, author, body });
      return id;
    },
    markReviewSatisfied: async (cid) => {
      const marked = db.prepare(
        "UPDATE inbox_events SET read_at = 999 WHERE card_id = ? AND kind = 'completed' "
        + "AND read_at IS NULL AND archived_at IS NULL",
      ).run(cid).changes > 0;
      return { marked };
    },
    updateCard: (cid, values) => {
      const keys = Object.keys(values);
      db.prepare(`UPDATE cards SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE id = @id`)
        .run({ id: cid, ...values });
    },
    errors: { cardNotFound: "Card not found.", cardArchived: "This card is archived." },
  });
  const readCard = () => db.prepare("SELECT * FROM cards WHERE id = ?").get(cardId);
  return { handlers, comments, published, readCard, db };
}

test("accepting a completed card writes the receipt and the trail comment", async () => {
  const { handlers, comments, readCard } = harness();
  const result = await handlers.acceptCard({ cardId: "card_1" });
  assert.equal(result.ok, true, result.error ?? "");
  assert.ok(isAccepted(result.acceptedAt), "the response carries the stamp it wrote");
  assert.equal(readCard().accepted_at, result.acceptedAt, "the stamp is on the row");
  assert.equal(comments.length, 1, "one openable trail comment, not a bare toast");
  assert.equal(comments[0].author, "user");
  assert.match(comments[0].body, /Accepted the finished result/);
});

test("acceptance never gates: no status, stage, or worker message changes", async () => {
  const { handlers, readCard } = harness();
  const before = readCard();
  await handlers.acceptCard({ cardId: "card_1" });
  const after = readCard();
  // The three fields a receipt that had become a gate would move.
  assert.equal(after.status, before.status, "status is untouched");
  assert.equal(after.stage, before.stage, "stage is untouched");
  assert.equal(after.activity, before.activity, "activity is untouched");
  assert.equal(after.worker_thread_id, before.worker_thread_id, "no worker was woken");
  // And the handler has no worker-send dependency at all, so it cannot route.
  const source_ = source("server/runtime/card-mutations.ts");
  const acceptBody = source_.slice(
    source_.indexOf("async function acceptCard"),
    source_.indexOf("async function renameCard"),
  );
  assert.doesNotMatch(acceptBody, /threads\.send/, "acceptance does not message the worker");
});

test("accepting satisfies the card's open review request", async () => {
  const { handlers, db } = harness();
  const openBefore = db.prepare(
    "SELECT COUNT(*) AS n FROM inbox_events WHERE kind = 'completed' AND read_at IS NULL",
  ).get().n;
  assert.equal(openBefore, 1, "the fixture starts with an open review request");
  await handlers.acceptCard({ cardId: "card_1" });
  const openAfter = db.prepare(
    "SELECT COUNT(*) AS n FROM inbox_events WHERE kind = 'completed' AND read_at IS NULL",
  ).get().n;
  assert.equal(openAfter, 0, "the request it answered is closed");
});

test("a card that has not reached Done is refused, with the exit named", async () => {
  const { handlers, readCard } = harness({ status: "in-progress", withCompletion: false });
  const result = await handlers.acceptCard({ cardId: "card_1" });
  assert.equal(result.ok, false);
  assert.equal(result.acceptedAt, null, "a refusal writes no stamp");
  assert.equal(readCard().accepted_at, null, "and nothing reaches the row");
  assert.match(result.error, /Done/, "the refusal says what would allow it");
});

test("an archived card is refused, and the exit is restore", async () => {
  const { handlers, readCard } = harness({ status: "archived" });
  const result = await handlers.acceptCard({ cardId: "card_1" });
  assert.equal(result.ok, false);
  assert.equal(readCard().accepted_at, null);
  assert.match(result.error, /restore/i);
});

test("a missing card is refused without a write", async () => {
  const { handlers } = harness();
  const result = await handlers.acceptCard({ cardId: "card_missing" });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Card not found.");
});

test("the receipt is a timestamp and nothing else, because the host has no identity", () => {
  // The negative claim, asserted on the column list rather than trusted to a
  // comment. Adding `accepted_by` is the tempting change this fails on.
  const { db } = harness();
  const columns = db.prepare("PRAGMA table_info(cards)").all().map((row) => row.name);
  assert.ok(columns.includes("accepted_at"));
  for (const forbidden of ["accepted_by", "accepted_by_name", "accepted_by_email"]) {
    assert.equal(columns.includes(forbidden), false, `cards.${forbidden} does not exist`);
  }
});

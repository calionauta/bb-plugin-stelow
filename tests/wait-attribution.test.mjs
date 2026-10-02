import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  attributeCardWait,
  reviewWaitMs,
  shareOf,
  splitWaitWindows,
  unionLengthMs,
} from "../lib/wait-attribution.mjs";

/**
 * The wait breakdown exists to answer one question honestly: of the time a card
 * spent, how much was a person's, how much was the machine's, and how much does
 * the data not explain? These tests are the guards for the three ways that
 * answer goes wrong — a sum instead of a union (a share above 100%), a cause
 * invented for the residual, and an open window charged to a clock nobody
 * measured.
 */

const HOUR = 3_600_000;

test("overlapping windows are counted once, and the human wins the overlap", () => {
  // A question arrives and supersedes an open pause: the same hour is both.
  // Summing the two would report 2h of a 1h interval — a 200% share.
  const split = splitWaitWindows({
    startAt: 0,
    endAt: HOUR,
    windows: [
      { kind: "paused", start: 0, end: HOUR },
      { kind: "question", start: 0, end: HOUR },
    ],
  });
  assert.equal(split.totalMs, HOUR, "the interval is the interval");
  assert.equal(split.humanMs, HOUR, "the person's hour is the person's");
  assert.equal(split.systemMs, 0, "the superseded pause adds nothing on top");
  assert.equal(split.unattributedMs, 0, "nothing is left over");
  assert.equal(split.humanShare + split.systemShare + split.unattributedShare, 1, "shares sum to one");
});

test("the three parts are disjoint and never exceed the whole", () => {
  const split = splitWaitWindows({
    startAt: 0,
    endAt: 10 * HOUR,
    windows: [
      { kind: "question", start: HOUR, end: 3 * HOUR }, // 2h human
      { kind: "paused", start: 2 * HOUR, end: 5 * HOUR }, // 3h, 1h overlapping
      { kind: "error", start: 8 * HOUR, end: null }, // open → to endAt, 2h
    ],
  });
  assert.equal(split.humanMs, 2 * HOUR, "human windows union to their own length");
  assert.equal(split.systemMs, 4 * HOUR, "system is the union minus the human overlap");
  assert.equal(split.attributedMs, 6 * HOUR, "attributed is one union, not a sum");
  assert.equal(split.unattributedMs, 4 * HOUR, "the residual is the remainder, not a guess");
  assert.equal(
    split.humanMs + split.systemMs + split.unattributedMs,
    split.totalMs,
    "the parts partition the interval",
  );
  assert.ok(split.humanShare <= 1 && split.systemShare <= 1, "no share can exceed 100%");
});

test("an open window is charged to the caller's interval, never to a hidden clock", () => {
  // Same rows, two intervals: the open question is not the same duration in both.
  const short = splitWaitWindows({
    startAt: 0,
    endAt: 2 * HOUR,
    windows: [{ kind: "question", start: HOUR, end: null }],
  });
  const long = splitWaitWindows({
    startAt: 0,
    endAt: 5 * HOUR,
    windows: [{ kind: "question", start: HOUR, end: null }],
  });
  assert.equal(short.humanMs, HOUR, "an open window ends where the caller says it ends");
  assert.equal(long.humanMs, 4 * HOUR, "and it stretches with the caller's interval");
});

test("windows outside the interval, unknown kinds and junk change nothing", () => {
  const split = splitWaitWindows({
    startAt: 10 * HOUR,
    endAt: 12 * HOUR,
    windows: [
      { kind: "question", start: 0, end: HOUR }, // entirely before: no part of this interval
      { kind: "paused", start: 11 * HOUR, end: 20 * HOUR }, // clipped to 11h–12h
      { kind: "completed", start: 10 * HOUR, end: 12 * HOUR }, // a review request, not a wait
      { kind: "mystery", start: 10 * HOUR, end: 12 * HOUR }, // unknown cause is not guessed at
      null,
      "nonsense",
    ],
  });
  assert.equal(split.humanMs, 0, "a window that ended before the interval is not part of it");
  assert.equal(split.systemMs, HOUR, "a window past the end is clipped, not counted whole");
  assert.equal(split.unattributedMs, HOUR, "everything else stays unexplained, including unknown kinds");
});

test("a degenerate interval reports zero rather than a fabricated share", () => {
  const split = splitWaitWindows({ startAt: 5 * HOUR, endAt: 5 * HOUR, windows: [] });
  assert.deepEqual(split, {
    totalMs: 0,
    humanMs: 0,
    systemMs: 0,
    attributedMs: 0,
    unattributedMs: 0,
    humanShare: 0,
    systemShare: 0,
    unattributedShare: 0,
  }, "no interval has no parts — never a division by zero wearing a number");
  assert.equal(shareOf(1, 0), 0, "a share of nothing is nothing");
  assert.equal(unionLengthMs([]), 0, "an empty union is empty");
});

test("the query reads a card's own rows and the review clock from the same completion rule", () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE inbox_events (
    id TEXT PRIMARY KEY, card_id TEXT NOT NULL, kind TEXT NOT NULL, occurred_at INTEGER NOT NULL,
    read_at INTEGER, resolved_at INTEGER, archived_at INTEGER
  );`);
  const insert = db.prepare(
    "INSERT INTO inbox_events (id, card_id, kind, occurred_at, read_at, resolved_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  insert.run("q", "card", "question", 1 * HOUR, null, 3 * HOUR, null);
  insert.run("p", "card", "paused", 2 * HOUR, null, 5 * HOUR, null);
  insert.run("c", "card", "completed", 9 * HOUR, null, null, null);
  insert.run("other", "elsewhere", "question", 1 * HOUR, null, 5 * HOUR, null);

  const split = attributeCardWait(db, { cardId: "card", startAt: 0, endAt: 10 * HOUR });
  assert.equal(split.humanMs, 2 * HOUR, "the question window is the person's");
  // Union of question (1h–3h) and pause (2h–5h) is 1h–5h; the human hour of
  // overlap belongs to the question, so system is 4h − 2h.
  assert.equal(split.systemMs, 2 * HOUR, "the pause adds only the part the question did not cover");
  assert.equal(split.unattributedMs, 6 * HOUR, "and the rest is honestly unexplained");
  assert.equal(split.totalMs, 10 * HOUR, "the whole is the interval asked about");

  // Another card's rows never leak into this one's breakdown.
  assert.equal(
    attributeCardWait(db, { cardId: "elsewhere", startAt: 0, endAt: 10 * HOUR }).humanMs,
    4 * HOUR,
    "each card is attributed from its own rows",
  );

  assert.equal(reviewWaitMs(db, { cardId: "card", nowMs: 12 * HOUR }), 3 * HOUR, "review wait runs from the unread completion");
  db.prepare("UPDATE inbox_events SET read_at = ? WHERE id = 'c'").run(10 * HOUR);
  assert.equal(reviewWaitMs(db, { cardId: "card", nowMs: 12 * HOUR }), null, "opening the card ends the review wait");
  assert.equal(reviewWaitMs(db, { cardId: "nowhere", nowMs: 12 * HOUR }), null, "a card with no completion has no review wait");
  db.close();
});

console.log("wait attribution test ok: union split, disjoint parts, honest residual, review clock");

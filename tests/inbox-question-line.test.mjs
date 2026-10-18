/**
 * The question line an Inbox row carries: stored at mint, read back, and
 * absent when nobody captured it.
 *
 * Split out of `inbox-flows.test.mjs` when that file crossed its line budget.
 * The concern is its own: `inbox-flows` is the event LIFECYCLE (dedupe, resolve,
 * archive, escalation), and this is one column pair's round trip through it.
 *
 * The two halves are both the point. A row that carries the question must read
 * it back, and a caller that cannot name the question must mint exactly the row
 * it minted before — null rather than an empty string, so the client's fallback
 * is a null check rather than a string sniff, and a legacy row never renders a
 * blank line where a sentence used to be.
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  ensureInboxQuestionColumns,
  ensureInboxResolvedReasonColumn,
  listInboxEvents,
  syncQuestionInboxEvents,
} from "../lib/inbox-events.mjs";
import { ensureInboxOccurrencesColumn } from "../lib/inbox-error-event.mjs";

// The question line a question row carries has to survive the round trip, and
// has to be ABSENT when nobody captured it — the two halves are what let a
// legacy row fall back to the generic sentence instead of rendering blank.
{
  const lineDb = new Database(":memory:");
  lineDb.exec(`
    CREATE TABLE cards (id TEXT PRIMARY KEY, name TEXT NOT NULL, display_name TEXT, project_id TEXT NOT NULL, kind TEXT);
    CREATE TABLE inbox_events (
      id TEXT PRIMARY KEY, card_id TEXT NOT NULL, kind TEXT NOT NULL,
      summary TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, occurred_at INTEGER NOT NULL,
      read_at INTEGER, archived_at INTEGER, resolved_at INTEGER,
      severity INTEGER NOT NULL DEFAULT 1, severity_reasons TEXT NOT NULL DEFAULT '[]',
      holder_card_id TEXT, holder_file TEXT,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    );
  `);
  ensureInboxResolvedReasonColumn(lineDb);
  ensureInboxOccurrencesColumn(lineDb);
  ensureInboxQuestionColumns(lineDb);
  lineDb.prepare("INSERT INTO cards VALUES (?, ?, ?, ?, ?)").run("card_q", "Map", "Map", "project_1", "build");

  syncQuestionInboxEvents(lineDb, {
    cardId: "card_q",
    interactionIds: ["ask_1"],
    occurredAt: 5,
    createId: () => "evt_q1",
    summary: "The agent is waiting for your answer to continue.",
    questionSummary: "Which storage should the map be built from?",
    questionCount: 3,
  });
  const carried = listInboxEvents(lineDb, false).find((row) => row.id === "evt_q1");
  assert.equal(carried.question_summary, "Which storage should the map be built from?", "the ask is stored on the row at mint time");
  assert.equal(carried.question_count, 3, "and so is how many questions it covers");

  // A caller that cannot name the question (the answer door, a legacy path)
  // must still mint exactly the row it used to: null, not an empty string, so
  // the client's fallback is a null check rather than a string sniff.
  syncQuestionInboxEvents(lineDb, {
    cardId: "card_q",
    interactionIds: ["ask_2"],
    occurredAt: 6,
    createId: () => "evt_q2",
    summary: "The agent is waiting for your answer to continue.",
  });
  const bare = listInboxEvents(lineDb, false).find((row) => row.id === "evt_q2");
  assert.equal(bare.question_summary, null, "a row minted without a question reads null, never blank");
  assert.equal(bare.question_count, null, "and so does its count");

  // Whitespace is not a question either: storing "  " would make the client
  // render an empty line instead of falling back to the sentence it has.
  syncQuestionInboxEvents(lineDb, {
    cardId: "card_q",
    interactionIds: ["ask_3"],
    occurredAt: 7,
    createId: () => "evt_q3",
    summary: "The agent is waiting for your answer to continue.",
    questionSummary: "   ",
    questionCount: 0,
  });
  const blank = listInboxEvents(lineDb, false).find((row) => row.id === "evt_q3");
  assert.equal(blank.question_summary, null, "whitespace is stored as null, so the fallback fires");
  assert.equal(blank.question_count, null, "a count of zero is not a count");

  // Re-syncing the SAME row must not churn the line it already carries: the
  // insert is `OR IGNORE`, so the first capture wins and a later poll cannot
  // rewrite history under a reader.
  syncQuestionInboxEvents(lineDb, {
    cardId: "card_q",
    interactionIds: ["ask_1"],
    occurredAt: 8,
    createId: () => "evt_q1_again",
    summary: "The agent is waiting for your answer to continue.",
    questionSummary: "A different question entirely",
  });
  const resynced = listInboxEvents(lineDb, false).find((row) => row.id === "evt_q1");
  assert.equal(resynced.question_summary, "Which storage should the map be built from?", "a re-sync leaves the captured ask alone");
  lineDb.close();
}


console.log("inbox question line test ok: stored at mint, read back, null when uncaptured");

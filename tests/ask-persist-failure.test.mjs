import assert from "node:assert/strict";
import {
  persistFailureInboxEvent,
  persistFailureTrailLine,
  shouldRecordPersistFailure,
} from "../lib/ask-persist-failure.mjs";

/**
 * A failed question-persist must leave a record on the card, not only a log line.
 *
 * The failure, described in the README as a runbook before it was a feature: a worker asks,
 * the answer times out, and the write of the expired-question rows fails — a `SQLITE_BUSY`
 * that outlives both retries, a closed handle, a full disk. `blockOnAnswer` marks the card
 * `awaiting-answer` before the blocking wait and sets it back to running when the call
 * ends, which happens BEFORE the persist is attempted. So a failed persist left a card that
 * was idle, had no pending question, and carried no trace of what happened — the only
 * evidence being a plugin-log line nobody reads.
 *
 * That is a phantom wait by this project's own rule ("any user-facing wait needs a live
 * question behind it"; "a phantom wait is a bug"), and these pins hold the record that
 * replaces it.
 */

// --- 1. Only a real failure is recorded. ------------------------------------
assert.equal(
  shouldRecordPersistFailure({ persisted: true, error: null }),
  false,
  "a persist that succeeded records nothing — a retry that worked is not an incident",
);
assert.equal(
  shouldRecordPersistFailure({ persisted: true, error: "SQLITE_BUSY: database is locked" }),
  false,
  "and neither does a failure the second attempt fixed",
);
assert.equal(
  shouldRecordPersistFailure({ persisted: false, error: "SQLITE_BUSY: database is locked" }),
  true,
  "a persist that never landed is recorded",
);
assert.equal(
  shouldRecordPersistFailure({ persisted: false, error: "Error: disk I/O error" }),
  true,
  "and so is a non-retryable one",
);

// --- 2. The failure path never throws, whatever it is handed. ---------------
// This runs from a failure handler, where throwing is the worst possible response: it would
// replace the failure it was reporting with an unrelated one.
for (const bad of [
  { persisted: false, error: null },
  { persisted: false, error: undefined },
  { persisted: false, error: "" },
  { persisted: false, error: "   " },
  { persisted: false, error: 42 },
]) {
  assert.doesNotThrow(() => shouldRecordPersistFailure(bad), `does not throw on ${JSON.stringify(bad)}`);
  assert.equal(shouldRecordPersistFailure(bad), false, "and an unusable error is not recorded rather than asserted about");
}

// --- 3. The trail line tells a reader the three things they need. -----------
const line = persistFailureTrailLine({
  cardId: "card_1",
  threadId: "thr_1",
  error: "interrupted storage after cancel reason \"persist\"; SQLITE_BUSY: database is locked",
});
assert.match(line, /could not be recorded/, "it says what happened");
assert.match(
  line,
  /NOT pending on this card/,
  "and that the question is not waiting — the fact the old card state actively contradicted",
);
assert.match(line, /SQLITE_BUSY/, "it names the cause");
assert.match(
  line,
  /Nothing was lost/,
  "and says nothing was lost: the question never landed, so there is nothing to recover — a reader's first fear is lost work",
);
assert.match(
  line,
  /send any message on worker thread thr_1/,
  "and gives the one action that recovers it, naming WHICH thread — a card with restarts has "
    + "more than one in its history, so 'the worker thread' is a place a reader cannot find",
);
assert.match(line, /will re-ask once/, "and says the worker is not gone");

// --- 4. The inbox event is deduped per card, not per error. -----------------
// The same broken handle fails on every ask. A row per attempt would be inflation rather
// than attention — the same reasoning `upsertPausedEvent` records for paused rows.
const first = persistFailureInboxEvent({ cardId: "card_1", error: "SQLITE_BUSY: database is locked" });
const second = persistFailureInboxEvent({ cardId: "card_1", error: "Error: disk I/O error" });
assert.equal(first.dedupeKey, second.dedupeKey, "two failures on one card are one inbox entry, whatever the error text");
assert.notEqual(
  persistFailureInboxEvent({ cardId: "card_2", error: first.summary }).dedupeKey,
  first.dedupeKey,
  "while a failure on another card is its own entry — the card is what a person acts on",
);
assert.equal(first.kind, "error", "the event is an error, so the inbox treats it as one");
assert.deepEqual(first.card, { id: "card_1" }, "the recorder's first argument is the card object it expects");
assert.match(first.summary, /could not be recorded/, "the summary says what happened");
assert.match(first.summary, /send any message on the worker thread/, "and names the recovery, so the inbox is actionable without opening the card");

// --- 5. The two surfaces agree about the cause. -----------------------------
// A trail line naming a `SQLITE_BUSY` while the inbox says nothing about it would send a
// reader looking for a second problem.
const error = 'interrupted storage after cancel reason "persist"; SQLITE_BUSY: database is locked';
assert.ok(
  persistFailureTrailLine({ cardId: "card_1", threadId: "thr_1", error }).includes("SQLITE_BUSY"),
  "the trail names the cause",
);
assert.ok(
  persistFailureInboxEvent({ cardId: "card_1", error }).summary.includes("SQLITE_BUSY"),
  "and so does the inbox event",
);

console.log(
  "ask persist failure ok: recorded on the card and in the inbox, deduped per card, "
    + "naming the cause, the fact nothing was lost, and the action that resumes",
);

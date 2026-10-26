import assert from "node:assert/strict";
import test from "node:test";
import {
  answerDeliveryCardPatch,
  answerDeliveryLine,
  answerDeliveryOf,
} from "../lib/answer-delivery.mjs";

/**
 * The answer and its delivery are two facts, and this module is the only place
 * they are worded.
 *
 * What regresses if these fail: the answer door goes back to reporting one
 * boolean for three outcomes, so a queued dispatch reads as a resume and a
 * refused one reads as a success. `server/runtime/thread-send.ts` documents the
 * same collapse costing a card its whole auto-continue budget; these tests are
 * the answer door's half of that rule.
 */

test("a dispatched resume says nothing at all", () => {
  const verdict = answerDeliveryOf({ delivery: "sent" });
  assert.deepEqual(verdict, { delivery: "sent", hold: null, error: null });
  // The happy path is not narrated: the card's own activity is the receipt, and
  // a second line confirming it would be noise on every answer.
  assert.equal(answerDeliveryLine(verdict), null);
  assert.equal(answerDeliveryCardPatch(verdict, null), null);
});

test("a queued dispatch is a hold, worded from the host's record", () => {
  const verdict = answerDeliveryOf({ delivery: "queued", hold: { kind: "capacity", holderId: "alpha", reason: "4 of 4 running on host alpha", queued: 1 } });
  assert.equal(verdict.delivery, "queued");
  const line = answerDeliveryLine(verdict);
  assert.match(line, /^The answer is saved\./);
  // The hold's own sentence is reused, never re-claimed here: the host counts
  // live slots that nothing in this module can recompute.
  assert.match(line, /4 of 4 running on host alpha/);
  assert.match(line, /no action needed/);
  // `held`, not `running`: the card stops claiming a turn nobody started.
  assert.equal(answerDeliveryCardPatch(verdict, "last words").activity, "held");
  assert.equal(answerDeliveryCardPatch(verdict, "last words").last_assistant_text, "last words");
});

test("a queued dispatch with no hold row still reads as a queue", () => {
  // The host queued the message without naming a wait. The row exists, so it is
  // a hold; only the reason is missing, and the line degrades rather than
  // claiming delivery or inventing a cause.
  const verdict = answerDeliveryOf({ delivery: "queued", hold: null });
  const line = answerDeliveryLine(verdict);
  assert.match(line, /^The answer is saved\./);
  assert.match(line, /holding the worker's next message/);
  assert.doesNotMatch(line, /delivered/i);
});

test("a refused dispatch names the host's words and the way out", () => {
  const verdict = answerDeliveryOf({ delivery: "refused", error: "thread 1 is gone" });
  const line = answerDeliveryLine(verdict);
  assert.match(line, /thread 1 is gone/);
  // A refusal without an exit is a deadlock with a good error message, and the
  // answers do not have to be re-entered — the send does.
  assert.match(line, /Resume the card/);
  assert.match(line, /do not need re-entering/);
  assert.equal(answerDeliveryCardPatch(verdict, null).activity, "idle");
});

test("a refused dispatch with no reason still refuses", () => {
  const verdict = answerDeliveryOf({ delivery: "refused" });
  assert.equal(verdict.delivery, "refused");
  assert.equal(verdict.error, null);
  const line = answerDeliveryLine(verdict);
  assert.match(line, /was not woken/);
  assert.match(line, /Resume the card/);
});

test("an unreadable dispatch is reported as unread, never as delivered", () => {
  // A caller that hands over a dispatch in a shape this module does not know
  // measured nothing. Rendering that as `sent` would be a confident lie in the
  // safe direction, which is still a lie; rendering it as `refused` would invent
  // a failure the host never reported.
  const verdict = answerDeliveryOf(undefined);
  assert.deepEqual(verdict, { delivery: null, hold: null, error: null });
  assert.match(answerDeliveryLine(verdict), /did not say/);
  // An attempt nobody could read claims no activity either way.
  assert.equal(answerDeliveryCardPatch(verdict, null).activity, "idle");
  // A card still waiting on the person is neither running nor idle: the open
  // question is the truth about what comes next.
  assert.equal(answerDeliveryCardPatch({ delivery: "refused" }, null, true), null);
  assert.equal(answerDeliveryCardPatch({ delivery: "queued" }, "words", true), null);
  // Nothing was attempted at all: the answer patch's own activity stands.
  assert.equal(answerDeliveryCardPatch(null, null), null);
});

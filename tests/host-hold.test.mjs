import assert from "node:assert/strict";
import test from "node:test";
import { HELD_ACTIVITY, holdSentence, holdUpdates, hostHold } from "../lib/host-hold.mjs";

// The rows the host hands back. `waitingOn` is the only field that decides
// whether a message is held, and it is the field the plugin used to ignore.
const row = (waitingOn) => ({ id: "qmsg_1", content: [], createdAt: 1, waitingOn });
const capacity = row({
  kind: "plugin",
  pluginId: "concurrency-limit",
  reason: "4 of 4 running on host ubuntu-8gb-hel1-1",
});

test("an empty or absent queue is not a hold", () => {
  assert.equal(hostHold([]), null);
  assert.equal(hostHold(null), null);
  assert.equal(hostHold(undefined), null);
  assert.equal(hostHold("not a list"), null);
  assert.equal(hostHold([row(null)]), null, "a dispatched row is not held");
  assert.equal(hostHold([{}]), null, "a row with no waitingOn is not held");
});

test("a held row reads as the host's own record, not a paraphrase", () => {
  // The reason counts live slots. Nothing here can recompute them, so the
  // record keeps the host's words rather than inventing a second truth.
  assert.deepEqual(hostHold([capacity]), {
    kind: "capacity",
    holderId: "concurrency-limit",
    reason: "4 of 4 running on host ubuntu-8gb-hel1-1",
    queued: 1,
  });
});

test("each wait kind is named, and none of them reads as homework", () => {
  const cases = [
    [capacity, /Waiting on the host: 4 of 4 running on host ubuntu-8gb-hel1-1\./],
    [row({ kind: "host-offline", hostName: "ubuntu-8gb-hel1-1" }), /Waiting on host ubuntu-8gb-hel1-1 to come back/],
    [row({ kind: "interaction" }), /permission request in the worker thread/],
    [row({ kind: "time" }), /host's clock/],
    [row({ kind: "turn-starting" }), /holding this card's next message/],
  ];
  for (const [held, pattern] of cases) {
    const sentence = holdSentence(hostHold([held]));
    assert.match(sentence, pattern, `kind ${held.waitingOn.kind}`);
    assert.match(sentence, /no action needed/, "a hold never implies the reader must act");
  }
  assert.equal(hostHold([row({ kind: "host-offline", hostName: "box" })]).holderId, "box");
});

test("a kind the host adds tomorrow degrades to the generic hold, not to no hold", () => {
  // The row exists, so the host has not dispatched it — that much is true
  // whatever the kind is called. Dropping the card back to `running` because a
  // new kind is unrecognised is the exact lie this module exists to remove.
  const future = hostHold([row({ kind: "some-future-wait", detail: "x" })]);
  assert.equal(future.kind, "queued");
  assert.match(holdSentence(future), /holding this card's next message/);
});

test("a queue deeper than one is named, because that is the pile-up", () => {
  assert.doesNotMatch(holdSentence(hostHold([capacity])), /messages are queued/);
  const piled = holdSentence(hostHold([capacity, { ...capacity, id: "qmsg_2" }, { ...capacity, id: "qmsg_3" }]));
  assert.match(piled, /3 messages are queued behind it/);
  assert.match(piled, /no action needed/, "naming the pile must not turn it into homework");
});

test("no hold means no sentence, so a caller cannot invent one", () => {
  assert.equal(holdSentence(null), null);
});

test("holding a card moves activity only, never board position", () => {
  // Same contract as questionWaitUpdates: `status` is durable progress and a
  // transport wait is not progress. A `status` key here is how a card gets
  // dragged into a column it never reached.
  assert.deepEqual(Object.keys(holdUpdates("last words")).sort(), ["activity", "last_assistant_text"]);
  assert.equal(holdUpdates("last words").activity, HELD_ACTIVITY);
  assert.equal(holdUpdates(null).last_assistant_text, null);
});

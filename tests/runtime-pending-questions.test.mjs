import test from "node:test";
import assert from "node:assert/strict";
import { createPendingQuestions } from "../server/runtime/pending-questions.ts";

test("pending question projection expands one ask into answerable cards", async () => {
  const seen = [];
  const fetch = createPendingQuestions({
    fetchPendingAsks: async (threadId) => {
      assert.equal(threadId, "thr-1");
      return [{
        id: "ask-1",
        expiresAt: 42,
        payload: {
          title: "Choose",
          question: "Pick one",
          options: [{ label: "A", description: "first" }],
        },
      }];
    },
    getCardByWorkerThread: () => ({ worker_thread_id: "thr-1" }),
    resolveAskOptions: async (card, options) => {
      seen.push({ card, options });
      return [{ label: "A", artifact: { path: "plan.md" } }];
    },
  });

  const questions = await fetch("thr-1");
  assert.equal(questions.length, 1);
  assert.equal(questions[0].id, "ask-1");
  assert.equal(questions[0].expiresAt, 42);
  assert.deepEqual(questions[0].options[0], {
    label: "A",
    artifact: { path: "plan.md" },
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].card.worker_thread_id, "thr-1");
});

test("a failed ask read is unknown, never an empty list", async () => {
  // This assertion used to read `[]` here and certify the bug: a poll hiccup
  // and "nothing open" were the same answer, so the detail hero dropped the
  // wait and `done` closed a card over a live question. `null` is the whole
  // distinction — the caller keeps the state it already had.
  const unavailable = createPendingQuestions({
    fetchPendingAsks: async () => null,
    getCardByWorkerThread: () => null,
    resolveAskOptions: async () => [],
  });
  assert.equal(await unavailable("thr-1"), null, "a failed live read is unknown, not zero");
  assert.deepEqual(await unavailable(null), [], "no thread is a known zero: there is nothing to read");

  // The fixture needs a real option, or `expandInteractionQuestions` drops the
  // malformed ask and this case asserts an empty list without ever reaching the
  // throwing seam — which is what the old version of this test did.
  const broken = createPendingQuestions({
    fetchPendingAsks: async () => [{
      id: "ask-2",
      payload: { title: "Broken", question: "Pick", options: [{ label: "A" }] },
    }],
    getCardByWorkerThread: () => null,
    resolveAskOptions: async () => {
      throw new Error("artifact read failed");
    },
  });
  assert.equal(await broken("thr-2"), null, "a projection that throws is unknown, not zero");

  // The positive control: a readable card with no asks is still an empty list,
  // so `null` cannot spread into "nothing is ever open".
  const empty = createPendingQuestions({
    fetchPendingAsks: async () => [],
    getCardByWorkerThread: () => ({ worker_thread_id: "thr-3" }),
    resolveAskOptions: async () => [],
  });
  assert.deepEqual(await empty("thr-3"), [], "a successful read with no asks is a known zero");
});

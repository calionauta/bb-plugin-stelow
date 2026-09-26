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

test("failed interaction reads and projection errors fail soft to no questions", async () => {
  const unavailable = createPendingQuestions({
    fetchPendingAsks: async () => null,
    getCardByWorkerThread: () => null,
    resolveAskOptions: async () => [],
  });
  assert.deepEqual(await unavailable("thr-1"), []);
  assert.deepEqual(await unavailable(null), []);

  const broken = createPendingQuestions({
    fetchPendingAsks: async () => [{
      id: "ask-2",
      payload: { title: "Broken", question: "Pick", options: [] },
    }],
    getCardByWorkerThread: () => null,
    resolveAskOptions: async () => {
      throw new Error("artifact read failed");
    },
  });
  assert.deepEqual(await broken("thr-2"), []);
});

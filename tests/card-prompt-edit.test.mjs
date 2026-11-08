import assert from "node:assert/strict";
import test from "node:test";
import { createCardMutationHandlers } from "../server/runtime/card-mutations.ts";

function row(overrides = {}) {
  return {
    id: "card_1",
    project_id: "proj_1",
    name: "do-the-thing",
    display_name: "Do the thing",
    prompt: "Do the thing",
    intent: "feature",
    status: "draft",
    stage: "triage",
    activity: "idle",
    worker_thread_id: null,
    kind: "build",
    dir_hash: null,
    ...overrides,
  };
}

const STARTED_ERR = "This card already started — its description is locked.";
const COMPLETED_ERR = "This card is completed — its description is locked.";
const TOO_LONG_ERR = "The description is over 20,000 characters.";

function harness(reads) {
  const calls = [];
  const queue = Array.isArray(reads) ? [...reads] : null;
  const live = queue ? null : reads;
  const db = {
    prepare(sql) {
      calls.push(["prepare", sql]);
      return {
        run: (prompt, displayName, updatedAt, id) => {
          calls.push(["run", prompt, displayName, updatedAt, id]);
          if (live) {
            live.prompt = prompt;
            live.display_name = displayName;
            live.updated_at = updatedAt;
          }
        },
      };
    },
  };
  const handlers = createCardMutationHandlers({
    db,
    bb: { realtime: { publish: (event, payload) => calls.push(["publish", event, payload]) } },
    now: () => 100,
    getCard: queue ? () => queue.shift() : () => live,
    cardWorkspace: async () => null,
    workflowStateDir: async () => null,
    logCardComment: () => "comment_1",
    markReviewSatisfied: async () => ({ marked: false }),
    updateCard: () => undefined,
    errors: { cardNotFound: "Card not found.", cardArchived: "This card is archived." },
  });
  return { calls, handlers };
}

test("parked draft card accepts a prompt edit and publishes", async () => {
  const card = row();
  const { calls, handlers } = harness(card);
  const result = await handlers.updateCardPrompt({ cardId: card.id, prompt: "  Do the better thing  " });
  assert.deepEqual(result, { ok: true, error: null });
  assert.equal(card.prompt, "Do the better thing");
  assert.equal(card.updated_at, 100);
  assert.ok(calls.some(([name, event, payload]) => name === "publish" && event === "card-state" && payload.cardId === card.id));
});

test("parked pending research card accepts a prompt edit", async () => {
  const card = row({ status: "pending", kind: "research", stage: "research" });
  const { handlers } = harness(card);
  assert.deepEqual(await handlers.updateCardPrompt({ cardId: card.id, prompt: "New question" }), { ok: true, error: null });
  assert.equal(card.prompt, "New question");
});

test("started card with a worker is refused with ERR_CARD_STARTED", async () => {
  const card = row({ status: "in-progress", activity: "running", worker_thread_id: "thread_1" });
  const { calls, handlers } = harness(card);
  const result = await handlers.updateCardPrompt({ cardId: card.id, prompt: "Rewrite history" });
  assert.deepEqual(result, { ok: false, error: STARTED_ERR });
  assert.equal(card.prompt, "Do the thing");
  assert.equal(calls.some(([name]) => name === "run"), false);
});

test("in-progress card without a worker handle is still refused", async () => {
  const card = row({ status: "in-progress", activity: "running", worker_thread_id: null });
  const { handlers } = harness(card);
  assert.deepEqual(await handlers.updateCardPrompt({ cardId: card.id, prompt: "Rewrite history" }), { ok: false, error: STARTED_ERR });
  assert.equal(card.prompt, "Do the thing");
});

test("completed card without a worker is still refused", async () => {
  const card = row({ status: "completed", activity: "idle", worker_thread_id: null });
  const { handlers } = harness(card);
  assert.deepEqual(await handlers.updateCardPrompt({ cardId: card.id, prompt: "Rewrite history" }), { ok: false, error: COMPLETED_ERR });
  assert.equal(card.prompt, "Do the thing");
});

test("archived card is refused with the archived precedent", async () => {
  const card = row({ status: "archived", worker_thread_id: null });
  const { handlers } = harness(card);
  assert.deepEqual(await handlers.updateCardPrompt({ cardId: card.id, prompt: "Rewrite history" }), { ok: false, error: "This card is archived." });
  assert.equal(card.prompt, "Do the thing");
});

test("empty and over-length prompts are refused with the draft preserved", async () => {
  const card = row();
  const { handlers } = harness(card);
  assert.deepEqual(await handlers.updateCardPrompt({ cardId: card.id, prompt: "   " }), { ok: false, error: "The description is empty." });
  assert.deepEqual(await handlers.updateCardPrompt({ cardId: card.id, prompt: `x${"y".repeat(20_000)}` }), { ok: false, error: TOO_LONG_ERR });
  assert.equal(card.prompt, "Do the thing");
});

test("a Start landing mid-edit wins the race", async () => {
  const parked = row();
  const started = row({ status: "in-progress", activity: "running", worker_thread_id: "thread_9" });
  const { calls, handlers } = harness([parked, started]);
  const result = await handlers.updateCardPrompt({ cardId: parked.id, prompt: "Too late" });
  assert.deepEqual(result, { ok: false, error: STARTED_ERR });
  assert.equal(calls.some(([name]) => name === "run"), false);
});

test("padded-but-legal input passes; truly over-long input is refused", async () => {
  const card = row();
  const { handlers } = harness(card);
  const padded = `${"x".repeat(19_995)}${" ".repeat(10)}`;
  assert.deepEqual(await handlers.updateCardPrompt({ cardId: card.id, prompt: padded }), { ok: true, error: null });
  assert.equal(card.prompt, "x".repeat(19_995));
});

test("parked-status card with a worker handle is still refused", async () => {
  const card = row({ status: "draft", activity: "running", worker_thread_id: "thread_7" });
  const { handlers } = harness(card);
  assert.deepEqual(await handlers.updateCardPrompt({ cardId: card.id, prompt: "Rewrite history" }), { ok: false, error: STARTED_ERR });
  assert.equal(card.prompt, "Do the thing");
});

test("missing card reports not found", async () => {
  const { handlers } = harness(null);
  assert.deepEqual(await handlers.updateCardPrompt({ cardId: "gone", prompt: "hi" }), { ok: false, error: "Card not found." });
});

test("prompt save refreshes a still-heuristic title synchronously", async () => {
  const card = row({ display_name: "Do the thing", prompt: "Do the thing" });
  const { handlers } = harness(card);
  assert.deepEqual(await handlers.updateCardPrompt({ cardId: card.id, prompt: "Do the better thing now" }), { ok: true, error: null });
  assert.equal(card.prompt, "Do the better thing now");
  assert.equal(card.display_name, "Do the better thing now");
});

test("prompt save leaves a human-set title untouched", async () => {
  const card = row({ display_name: "My custom title", prompt: "Do the thing" });
  const { handlers } = harness(card);
  assert.deepEqual(await handlers.updateCardPrompt({ cardId: card.id, prompt: "Do the better thing now" }), { ok: true, error: null });
  assert.equal(card.prompt, "Do the better thing now");
  assert.equal(card.display_name, "My custom title");
});

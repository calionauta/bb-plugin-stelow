import assert from "node:assert/strict";
import { test } from "node:test";
import { createCardLifecycleHandlers } from "../server/runtime/card-lifecycle.ts";
import { lifecycleRpcContract } from "../server/lifecycle-rpc-contract.ts";
import { describeBulkDelete } from "../lib/bulk-delete-outcome.mjs";

/**
 * Bulk delete of archived cards.
 *
 * The single-card delete already refuses anything not archived and already
 * refuses when a native run will not stop. The bulk version's own risk is
 * different: a loop that stops at the first refusal, or that reports a single
 * "done", would leave the reader believing a column is empty when it is not —
 * and there is no undo. So what is pinned here is the REPORTING: every id comes
 * back accounted for, as either deleted or failed-with-a-reason, and one bad
 * card never cancels the rest.
 */

function card(id, overrides = {}) {
  return {
    id,
    project_id: "proj_1",
    name: id,
    display_name: id,
    prompt: "Do a thing",
    intent: "feature",
    status: "archived",
    stage: "completed",
    activity: "idle",
    worker_thread_id: null,
    worker_preset_id: null,
    preset_restart_pending: 0,
    dir_hash: null,
    auto_continue_count: 0,
    auto_continue_stage: null,
    spawn_retry_count: 0,
    spawn_retry_thread: null,
    attachments: "[]",
    workspace_kind: "project",
    workspace_path: null,
    workspace_host_id: null,
    kind: "build",
    research_strategy: null,
    research_strategies: null,
    explore_stage: null,
    last_error: null,
    last_assistant_text: null,
    last_idle_at: null,
    environment_label: null,
    created_at: 1,
    updated_at: 2,
    ...overrides,
  };
}

function deps(cards, options = {}) {
  const calls = [];
  const table = new Map(Object.entries(cards));
  const handlers = createCardLifecycleHandlers({
    db: { prepare: () => ({ all: () => [], get: () => undefined, run: () => undefined }) },
    bb: { realtime: { publish: (...event) => calls.push(event) } },
    getCard: (cardId) => table.get(cardId),
    cardWorkspace: async () => null,
    workflowStateDir: async () => null,
    workers: { stop: async () => {}, deleteCard: (cardId) => calls.push(["delete", cardId]) },
    stopOwnedRuns: async (cardId) => {
      calls.push(["stopOwnedRuns", cardId]);
      return options.runWillNotStop?.includes(cardId) ? false : true;
    },
    cancelScopeBatches: () => {},
    updateCard: () => {},
    releaseClaims: async () => {},
    removeCardPreset: () => {},
    logCardComment: () => "comment",
    runGitIn: async () => ({ ok: true, stdout: "" }),
    exploratoryScope: "/tmp/exploratory",
    discardEvidence: async () => ({}),
    discardEligibility: () => ({ eligible: false, action: "none", reason: null }),
    discardConfirm: () => ({ title: "", body: "" }),
    discardTrail: () => "",
    errors: { cardNotFound: "Card not found." },
  });
  return { calls, handlers };
}

test("a bulk delete reports every id as deleted or failed, and deletes them all", async () => {
  const { calls, handlers } = deps({ card_a: card("card_a"), card_b: card("card_b"), card_c: card("card_c") });
  const result = await handlers.deleteArchivedCards({ cardIds: ["card_a", "card_b", "card_c"] });
  assert.deepEqual(result, { deleted: ["card_a", "card_b", "card_c"], failed: [] });
  assert.deepEqual(
    calls.filter(([name]) => name === "delete").map(([, id]) => id),
    ["card_a", "card_b", "card_c"],
    "each card is actually deleted, in the order the reader saw them",
  );
});

test("one refused card does not cancel the rest, and is named with its reason", async () => {
  // card_b is still live — a stale panel can hand the server a set that changed
  // between the dialog and the click. The others must still go, and the refusal
  // must be visible rather than absorbed into a count.
  const { calls, handlers } = deps({
    card_a: card("card_a"),
    card_b: card("card_b", { status: "in-progress" }),
    card_c: card("card_c"),
  });
  const result = await handlers.deleteArchivedCards({ cardIds: ["card_a", "card_b", "card_c"] });
  assert.deepEqual(result.deleted, ["card_a", "card_c"], "the live card is skipped, the rest are not");
  assert.deepEqual(result.failed, [
    { cardId: "card_b", error: "Only archived cards can be deleted. Archive it first." },
  ]);
  assert.equal(
    calls.some(([name, id]) => name === "delete" && id === "card_b"),
    false,
    "the refused card was never touched — no rows, no run files, no preset",
  );
});

test("a card whose native run will not stop is reported, not counted as deleted", async () => {
  const { handlers } = deps(
    { card_a: card("card_a"), card_b: card("card_b") },
    { runWillNotStop: ["card_b"] },
  );
  const result = await handlers.deleteArchivedCards({ cardIds: ["card_a", "card_b"] });
  assert.deepEqual(result.deleted, ["card_a"]);
  assert.deepEqual(result.failed, [
    {
      cardId: "card_b",
      error: "The native workflow could not be stopped; the card was not deleted.",
    },
  ]);
});

test("an unknown id is reported rather than thrown, so one bad id cannot abort the batch", async () => {
  const { handlers } = deps({ card_a: card("card_a") });
  const result = await handlers.deleteArchivedCards({ cardIds: ["card_ghost", "card_a"] });
  assert.deepEqual(result.deleted, ["card_a"], "the real card still went");
  assert.deepEqual(result.failed, [{ cardId: "card_ghost", error: "Card not found." }]);
});

test("the output contract requires a string reason, which is why the batch substitutes one", async () => {
  // `deleteCard` returns `error: string | null`, but this RPC's output declares
  // `failed[].error` as a plain string. A null passed through would fail
  // response validation, and the reader would get one opaque error for the
  // WHOLE batch instead of a per-card reason — the exact failure this reporting
  // shape exists to prevent. So the substitution is load-bearing, and the
  // contract is what makes it necessary; pinned here because the nullable half
  // of the single-card result is otherwise untested.
  const perCard = lifecycleRpcContract.deleteCard.output;
  assert.equal(perCard.safeParse({ deleted: false, error: null }).success, true,
    "the single-card result genuinely admits a null error — the batch must cope");
  const batch = lifecycleRpcContract.deleteArchivedCards.output;
  assert.equal(batch.safeParse({ deleted: [], failed: [{ cardId: "c", error: null }] }).success, false,
    "and the batch must not admit one, or the whole response is refused");
  assert.equal(batch.safeParse({ deleted: [], failed: [{ cardId: "c", error: "reason" }] }).success, true);
});

test("a null reason reaching the report still reads as a sentence", async () => {
  // Defensive end of the same chain: whatever slips past the schema, the
  // wording must not render a bare "Still there: 1 —" that sends the reader
  // round the loop with nothing to act on.
  const out = describeBulkDelete({ deleted: [], failed: [{ cardId: "c", error: null }] }, 1);
  assert.equal(out.tone, "error");
  assert.match(out.message, /The card was not deleted\./, "a substitute reason, never an empty gap");
});

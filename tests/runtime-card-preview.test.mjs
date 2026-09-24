import assert from "node:assert/strict";
import test from "node:test";
import { createCardPreview } from "../server/runtime/card-preview.ts";

function harness(checkout = { path: "/worker", hostId: "thr-1", source: "worker worktree" }) {
  const calls = [];
  const runtime = {
    view: async (target, origin) => ({ target, origin }),
    start: async (target) => ({ ok: true, target }),
    stop: async (target) => ({ ok: true, target }),
    share: async (target) => ({ ok: true, target }),
  };
  const preview = createCardPreview({
    getCard: (id) => id === "card-1" ? { name: "Feature" } : undefined,
    cardCheckout: async (card) => {
      calls.push(["checkout", card.name]);
      return checkout;
    },
    runtime,
    cardNotFoundError: "Card not found",
  });
  return { calls, preview };
}

test("card preview resolves the worker checkout before dispatch", async () => {
  const { calls, preview } = harness();
  const result = await preview.view("card-1", "http://app");

  assert.deepEqual(calls, [["checkout", "Feature"]]);
  assert.deepEqual(result, {
    target: {
      checkout: "/worker",
      hostId: "thr-1",
      slug: "Feature",
      source: "worker worktree",
    },
    origin: "http://app",
  });
});

test("missing checkout refuses mutations and reports an unavailable view", async () => {
  const { preview } = harness(null);
  assert.equal((await preview.view("card-1")).available, false);
  assert.deepEqual(await preview.start("card-1"), {
    ok: false,
    error: "Workspace path is unavailable.",
  });
  assert.deepEqual(await preview.stop("card-1"), {
    ok: false,
    error: "Workspace path is unavailable.",
  });
  assert.deepEqual(await preview.share("card-1"), {
    ok: false,
    error: "Workspace path is unavailable.",
  });
});

test("unknown cards fail before checkout resolution", async () => {
  const { calls, preview } = harness();
  await assert.rejects(() => preview.start("missing"), /Card not found/);
  assert.deepEqual(calls, []);
});

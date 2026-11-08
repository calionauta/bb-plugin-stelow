import assert from "node:assert/strict";
import test from "node:test";
import { createCardDetailHandler } from "../server/runtime/card-detail.ts";
import { card, detailDeps } from "./helpers/card-detail-fixture.mjs";

test("card detail carries the frozen technical acceptance beside the human receipt", async () => {
  const HEAD = "a".repeat(40);
  const snapshot = JSON.stringify({
    baseline: { "npm test": 0 },
    testMap: ["node tests/a.test.mjs"],
    redProof: { failed_command: "node tests/a.test.mjs", exit_code: 1, output_excerpt: "not ok" },
    freezeSha: HEAD,
  });
  const noQuestions = { fetchPendingQuestions: async () => [] };
  const frozen = card({ dir_hash: "h1" });
  const withFrozen = await createCardDetailHandler(detailDeps(frozen, {
    ...noQuestions,
    cardWorkspace: async () => ({ path: "/w", hostId: null }),
    stateDir: async () => "/w/.stelow/state",
    verifiedHeadSha: () => HEAD,
    bb: {
      sdk: {
        projects: { get: async () => ({ name: "Project" }) },
        files: {
          read: async ({ path }) => (String(path).endsWith("frozen-acceptance.json") ? { content: snapshot } : { content: "" }),
          listPaths: async () => ({ paths: [] }),
        },
        threads: { get: async () => ({ environmentId: "env_1" }) },
      },
      realtime: { publish: () => undefined },
    },
  }))({ cardId: frozen.id });
  assert.equal(withFrozen.card.frozenTestMap.length, 1);
  assert.equal(withFrozen.card.frozenTestMap[0].test, "node tests/a.test.mjs");
  assert.equal(withFrozen.card.freezeSha, HEAD);
  assert.equal(withFrozen.card.currentHeadSha, HEAD);

  const bare = card({ dir_hash: "h1" });
  const withoutFrozen = await createCardDetailHandler(detailDeps(bare, {
    ...noQuestions,
    cardWorkspace: async () => ({ path: "/w", hostId: null }),
  }))({ cardId: bare.id });
  assert.equal(withoutFrozen.card.frozenTestMap, null);
  assert.equal(withoutFrozen.card.freezeSha, null);
  assert.equal(withoutFrozen.card.currentHeadSha, null);
});

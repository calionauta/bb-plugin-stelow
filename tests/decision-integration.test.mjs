import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDecisionReceipt } from "../lib/decision-receipts.mjs";
import { capReads, formatDecisionReads, receiptsForScopes } from "../lib/decision-coverage.mjs";
import { freshnessOf } from "../lib/decision-freshness.mjs";
import { requiresChallenge } from "../lib/decision-challenge.mjs";
import { resolveLive } from "../lib/decision-lineage.mjs";
import { loadDecisionReceipts, markSuperseded, saveDecisionReceipt } from "../server/runtime/decision-store.ts";

// The unit tests fake the filesystem. This runs the REAL chain through real
// files in a temp state dir — decide, persist, reload, serve, challenge,
// supersede, go stale — so a wire-format drift between any two halves fails
// here instead of in a live card.
const root = mkdtempSync(join(tmpdir(), "stelow-decision-e2e-"));
const stateDir = join(root, ".stelow", "e2e");
const files = {
  read: async ({ path }) => ({ content: readFileSync(path, "utf8") }),
  write: async ({ path, content }) => {
    writeFileSync(path, content);
    return { outcome: "ok" };
  },
};

try {
  // 1. Decide and persist: winner, losers, scopes, authorized versions.
  const first = buildDecisionReceipt(
    { selectedId: "opt-5", rejectedOptionIds: ["opt-3"], scopeIds: ["s1"] },
    { id: "r-1", shapeVersion: "v7" },
  );
  assert.equal(first.ok, true);
  const { default: mkdir } = await import("node:fs");
  mkdir.mkdirSync(stateDir, { recursive: true });
  assert.deepEqual(await saveDecisionReceipt(files, root, stateDir, first.receipt), { ok: true });

  // 2. Reload from disk and serve: the run on s1 must read r-1.
  const stored = await loadDecisionReceipts(files, stateDir);
  assert.equal(stored.length, 1);
  const served = receiptsForScopes(stored, ["s1"]);
  assert.deepEqual(served.map((r) => r.id), ["r-1"]);
  const { served: capped, omittedIds } = capReads(served);
  assert.match(formatDecisionReads(capped, omittedIds), /r-1/);

  // 3. Fresh at the authorized versions; stale after a shape bump.
  const current = { shapeVersion: "v7", touchedScopeIds: [] };
  assert.equal(freshnessOf(stored[0], current), "current");
  assert.equal(freshnessOf(stored[0], { ...current, shapeVersion: "v8" }), "stale");

  // 4. Reviving opt-3 without a challenge refuses; naming it records.
  const { live } = resolveLive(stored);
  const hit = requiresChallenge({ scopeIds: ["s1"], optionIds: ["opt-3"] }, live, { challengeReceiptIds: [] });
  assert.deepEqual(hit, { receiptId: "r-1", reason: "proposes rejected option opt-3" });
  assert.equal(
    requiresChallenge({ scopeIds: ["s1"], optionIds: ["opt-3"] }, live, { challengeReceiptIds: ["r-1"] }),
    null,
  );

  // 5. A superseding decision retires r-1; only r-2 stays live.
  const second = buildDecisionReceipt(
    { selectedId: "opt-3", scopeIds: ["s1"], supersedes: ["r-1"], challengeId: "r-1" },
    { id: "r-2", shapeVersion: "v8" },
  );
  assert.equal(second.ok, true);
  await saveDecisionReceipt(files, root, stateDir, second.receipt);
  await markSuperseded(files, root, stateDir, ["r-1"], "r-2");
  const after = await loadDecisionReceipts(files, stateDir);
  const resolved = resolveLive(after);
  assert.deepEqual(resolved.live.map((r) => r.id), ["r-2"]);
  assert.deepEqual(resolved.superseded.map((r) => r.id), ["r-1"]);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("decision-integration: ok");

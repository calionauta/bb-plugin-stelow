import assert from "node:assert/strict";
import { loadDecisionReceipts, markSuperseded, saveDecisionReceipt } from "../server/runtime/decision-store.ts";
import { buildDecisionReceipt } from "../lib/decision-receipts.mjs";

function fakeFiles(initial = null) {
  let content = initial;
  return {
    files: {
      read: async () => {
        if (content === null) throw new Error("missing");
        return { content };
      },
      write: async ({ content: next }) => {
        content = next;
        return { outcome: "ok" };
      },
    },
    get content() {
      return content;
    },
  };
}

const dir = "/state/abc";
const root = "/repo";

// Missing file reads as empty, never throws.
const empty = fakeFiles(null);
assert.deepEqual(await loadDecisionReceipts(empty.files, dir), []);

// Corrupt file reads as empty too.
const corrupt = fakeFiles("{oops");
assert.deepEqual(await loadDecisionReceipts(corrupt.files, dir), []);

// Save persists; reload recovers the receipt.
const store = fakeFiles(null);
const built = buildDecisionReceipt({ selectedId: "opt-5", scopeIds: ["s1"] }, { id: "r-1", shapeVersion: "v1" });
assert.equal(built.ok, true);
assert.deepEqual(await saveDecisionReceipt(store.files, root, dir, built.receipt), { ok: true });
const reloaded = await loadDecisionReceipts(store.files, dir);
assert.equal(reloaded.length, 1);
assert.equal(reloaded[0].selectedId, "opt-5");

// Invalid receipts refuse with the reason, nothing is written.
const bad = await saveDecisionReceipt(store.files, root, dir, { kind: "junk" });
assert.equal(bad.ok, false);
assert.equal((await loadDecisionReceipts(store.files, dir)).length, 1);

// Supersession marks the chain; unknown ids are ignored.
await markSuperseded(store.files, root, dir, ["r-1", "ghost"], "r-2");
const chained = await loadDecisionReceipts(store.files, dir);
assert.equal(chained[0].supersededBy, "r-2");
await markSuperseded(store.files, root, dir, [], "r-3");

console.log("decision-store: ok");

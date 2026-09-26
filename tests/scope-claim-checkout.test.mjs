import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { acquireScopeClaims, ensureCardClaimsTables } from "../lib/card-claims.mjs";
import { resolveClaimCheckout, resolveClaimKey } from "../lib/card-claim-key.mjs";

const db = new Database(":memory:");
ensureCardClaimsTables(db);
const T0 = 3_000_000;

// Same file in two different managed-worktree checkouts: no false conflict.
const left = acquireScopeClaims(db, {
  cardId: "card-a",
  batchId: "batch-wt",
  scopeId: "scope-a",
  files: ["src/same.ts"],
  checkoutPath: "/wt/card-a",
  sourcePath: "/repo",
  nowMs: T0,
});
const right = acquireScopeClaims(db, {
  cardId: "card-b",
  batchId: "batch-wt",
  scopeId: "scope-b",
  files: ["src/same.ts"],
  checkoutPath: "/wt/card-b",
  sourcePath: "/repo",
  nowMs: T0 + 1,
});
assert.equal(left.ok, true, "worktree A acquires");
assert.equal(right.ok, true, "worktree B acquires the same relative path without conflict");

// Same file twice in the SAME checkout conflicts.
const clash = acquireScopeClaims(db, {
  cardId: "card-b",
  batchId: "batch-wt",
  scopeId: "scope-c",
  files: ["src/same.ts"],
  effectiveCheckout: "/wt/card-b",
  nowMs: T0 + 2,
});
assert.equal(clash.ok, false, "same checkout still conflicts");
assert.equal(clash.code, "CONFLICT", "same-checkout refusal is CONFLICT");

// The key derivation itself: effective checkout wins, source is fallback.
assert.equal(resolveClaimCheckout({ checkoutPath: "/wt/card-a", sourcePath: "/repo" }), "/wt/card-a", "checkout wins");
assert.equal(resolveClaimCheckout({ worktreePath: "/wt/card-a", sourcePath: "/repo" }), "/wt/card-a", "worktree wins");
assert.equal(resolveClaimCheckout({ sourcePath: "/repo" }), "/repo", "source is the fallback");
assert.equal(resolveClaimKey({ checkoutPath: "/wt/card-a", sourcePath: "/repo" }), "/wt/card-a", "legacy key agrees");

// Mutation guard: reverting the claim key to project source would collapse
// both worktrees onto /repo and false-conflict. Distinct checkouts must
// stay distinct keys.
assert.notEqual(
  resolveClaimCheckout({ checkoutPath: "/wt/card-a", sourcePath: "/repo" }),
  resolveClaimCheckout({ checkoutPath: "/wt/card-b", sourcePath: "/repo" }),
  "distinct worktrees resolve to distinct keys (source-keying would fail this)",
);

console.log("scope-claim-checkout: ok");

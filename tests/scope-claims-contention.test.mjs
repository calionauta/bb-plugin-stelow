import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { acquireScopeClaims, ensureCardClaimsTables, liveClaimsForWorkspace } from "../lib/card-claims.mjs";

const db = new Database(":memory:");
ensureCardClaimsTables(db);
const WS = "/repo/checkout";
const T0 = 2_000_000;

// All-or-nothing: first scope acquires both files.
const first = acquireScopeClaims(db, {
  cardId: "card-1",
  batchId: "batch-1",
  scopeId: "scope-a",
  files: ["src/a.ts", "src/b.ts"],
  effectiveCheckout: WS,
  nowMs: T0,
});
assert.equal(first.ok, true, "first scope acquires");
assert.equal(first.acquired.length, 2, "both files acquired atomically");

// Sibling scope of the SAME card on the same file is a distinct holder:
// it must refuse with CONFLICT naming the holder, never silent sharing.
const sibling = acquireScopeClaims(db, {
  cardId: "card-1",
  batchId: "batch-1",
  scopeId: "scope-b",
  files: ["src/a.ts"],
  effectiveCheckout: WS,
  nowMs: T0 + 1,
});
assert.equal(sibling.ok, false, "sibling scope refuses");
assert.equal(sibling.code, "CONFLICT", "refusal code is CONFLICT");
assert.equal(sibling.acquired.length, 0, "all-or-nothing: nothing acquired on conflict");
assert.equal(sibling.conflicts.length, 1, "conflict names the file");
assert.ok(
  String(sibling.conflicts[0].holder).includes("scope-a"),
  `conflict names the holding scope (got ${sibling.conflicts[0].holder})`,
);
assert.equal(sibling.conflicts[0].file, "src/a.ts", "conflict names the file");

// Conflict parks the waiter: BB-LOCK-BLOCKED payload, per-file dedupe key,
// agent-only nudge, no retry loop.
assert.equal(sibling.park.length, 1, "waiter parks exactly once");
assert.match(sibling.park[0].stderr, /BB-LOCK-BLOCKED/, "park payload is machine-readable");
assert.match(sibling.park[0].stderr, /do not retry in a loop/, "park forbids spin loops");
assert.equal(sibling.park[0].dedupeKey, "lock-blocked:card-1:src/a.ts", "dedupe key is per card per file");
assert.equal(sibling.park[0].visibility, "agent-only", "nudge never pages the human");

// A foreign card also conflicts (not just siblings).
const foreign = acquireScopeClaims(db, {
  cardId: "card-2",
  batchId: "batch-1",
  scopeId: "scope-c",
  files: ["src/b.ts"],
  effectiveCheckout: WS,
  nowMs: T0 + 2,
});
assert.equal(foreign.ok, false, "foreign card refuses a held file");
assert.ok(String(foreign.conflicts[0].holder).includes("card-1"), "foreign refusal names the holder card");

// Live claims still show only the first holder (no silent sharing happened).
const live = liveClaimsForWorkspace(db, { workspacePath: WS, nowMs: T0 + 3 });
assert.equal(live.filter((row) => row.file_path === "src/a.ts").length, 1, "one live holder per file");
assert.equal(live.find((row) => row.file_path === "src/a.ts").card_id, "card-1", "holder is unchanged");

// Mutation guard: keying the holder by bare cardId (ignoring scope) would
// let the sibling renew instead of conflict. Exactly one of the two same-card
// acquires may hold the file.
assert.equal(first.ok !== sibling.ok, true, "same-card sibling scopes never co-hold a file");

console.log("scope-claims-contention: ok");

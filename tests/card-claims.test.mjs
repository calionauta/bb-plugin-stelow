import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  CLAIM_TTL_MS,
  acquireWorkspaceClaims,
  addClaimWaiters,
  checkWorkspaceClaims,
  clearClaimWaiters,
  ensureCardClaimsTables,
  liveClaimsForWorkspace,
  normalizeClaimPath,
  releaseAllCardClaims,
  releaseWorkspaceClaims,
  sweepExpiredClaims,
  waitersForFiles,
} from "../lib/card-claims.mjs";

const db = new Database(":memory:");
ensureCardClaimsTables(db);
ensureCardClaimsTables(db);

const WS = "/repo/checkout";
const T0 = 1_000_000;

// Path normalization: the registry key can never escape the workspace.
assert.equal(normalizeClaimPath("src/a.ts"), "src/a.ts");
assert.equal(normalizeClaimPath("./src/a.ts"), "src/a.ts");
assert.equal(normalizeClaimPath("src//b/../b/c.ts"), "src/b/c.ts");
assert.equal(normalizeClaimPath("/abs/leading/slash.ts"), "abs/leading/slash.ts");
assert.equal(normalizeClaimPath("../escape.ts"), null, "parent escape is refused");
assert.equal(normalizeClaimPath("src/../../escape.ts"), null, "nested escape is refused");
assert.equal(normalizeClaimPath(""), null, "empty claims nothing");
assert.equal(normalizeClaimPath("   "), null, "blank claims nothing");
assert.equal(normalizeClaimPath(null), null, "non-string claims nothing");

// First acquire wins; same-card acquire is an idempotent heartbeat renewal.
let first = acquireWorkspaceClaims(db, { cardId: "card_a", workspacePath: WS, files: ["src/a.ts", "src/b.ts"], scope: "scope-1", nowMs: T0 });
assert.equal(first.acquired.length, 2, "fresh files are acquired");
assert.equal(first.conflicts.length, 0, "no conflicts on a free workspace");
assert.ok(first.acquired[0].fencing >= 1, "acquire hands out a fencing token");

let conflict = acquireWorkspaceClaims(db, { cardId: "card_b", workspacePath: WS, files: ["src/a.ts"], scope: "scope-2", nowMs: T0 + 1 });
assert.equal(conflict.acquired.length, 0, "a live foreign claim refuses");
assert.equal(conflict.conflicts.length, 1, "the refusal names the conflict");
assert.equal(conflict.conflicts[0].heldBy, "card_a", "the refusal names the holder");
assert.equal(conflict.conflicts[0].file, "src/a.ts", "the refusal names the file");

let own = acquireWorkspaceClaims(db, { cardId: "card_a", workspacePath: WS, files: ["src/a.ts", "src/a.ts"], scope: "scope-1", nowMs: T0 + 2 });
assert.equal(own.renewed.length, 1, "duplicate same-card acquire renews once");
assert.equal(own.conflicts.length, 0, "a card never conflicts with itself");

// Different workspaces are independent registries.
let other = acquireWorkspaceClaims(db, { cardId: "card_b", workspacePath: "/other/checkout", files: ["src/a.ts"], nowMs: T0 + 3 });
assert.equal(other.acquired.length, 1, "same path in another workspace is a different claim");

// Expired claims are stolen, and the steal names the previous holder.
let stolen = acquireWorkspaceClaims(db, { cardId: "card_b", workspacePath: WS, files: ["src/a.ts"], scope: "scope-2", nowMs: T0 + CLAIM_TTL_MS + 10 });
assert.equal(stolen.stolen.length, 1, "an expired claim is stolen");
assert.equal(stolen.stolen[0].previousHolder, "card_a", "the steal names the crashed holder");
assert.ok(stolen.stolen[0].fencing > first.acquired[0].fencing, "a steal advances the fencing epoch");

// Check is read-only room state and renews the caller's own leases.
let seen = checkWorkspaceClaims(db, { cardId: "card_c", workspacePath: WS, files: ["src/a.ts", "src/free.ts"], nowMs: T0 + 4 });
assert.deepEqual(seen.free, ["src/free.ts"], "check reports exactly the free files");
assert.equal(seen.conflicts[0].heldBy, "card_b", "check names the live holder");
const before = db.prepare("SELECT expires_at FROM card_claims WHERE workspace_path = ? AND file_path = ?").get(WS, "src/b.ts").expires_at;
checkWorkspaceClaims(db, { cardId: "card_a", workspacePath: WS, files: ["src/b.ts"], nowMs: T0 + 5000 });
const after = db.prepare("SELECT expires_at FROM card_claims WHERE workspace_path = ? AND file_path = ?").get(WS, "src/b.ts").expires_at;
assert.ok(after > before, "check from the owner renews the lease (heartbeat)");

// Waiters: blocked cards register, release wakes exactly them.
addClaimWaiters(db, { cardId: "card_c", workspacePath: WS, files: ["src/a.ts", "src/other.ts"], nowMs: T0 + 5 });
addClaimWaiters(db, { cardId: "card_c", workspacePath: WS, files: ["src/a.ts"], nowMs: T0 + 6 });
let waiters = waitersForFiles(db, { workspacePath: WS, files: ["src/a.ts"] });
assert.equal(waiters.length, 1, "duplicate waiter registration stays idempotent");
assert.equal(waiters[0].card_id, "card_c", "the waiter is found by file");
assert.equal(waitersForFiles(db, { workspacePath: WS, files: ["src/unrelated.ts"] }).length, 0, "unrelated files wake nobody");

let released = releaseWorkspaceClaims(db, { cardId: "card_b", workspacePath: WS, files: ["src/a.ts"] });
assert.equal(released.length, 1, "scoped release drops exactly the named file");
assert.equal(clearClaimWaiters(db, { cardId: "card_c", workspacePath: WS, files: ["src/a.ts"] }), 1, "woken waiters clear");
assert.equal(waitersForFiles(db, { workspacePath: WS, files: ["src/a.ts"] }).length, 0, "cleared waiters are gone");

// A foreign card can never release another card's claim.
assert.equal(releaseWorkspaceClaims(db, { cardId: "card_c", workspacePath: WS, files: ["src/b.ts"] }).length, 0, "release is owner-only");

// Terminal-state release drops everything the card holds, everywhere.
acquireWorkspaceClaims(db, { cardId: "card_z", workspacePath: WS, files: ["src/z1.ts"], nowMs: T0 + 7 });
acquireWorkspaceClaims(db, { cardId: "card_z", workspacePath: "/other/checkout", files: ["src/z2.ts"], nowMs: T0 + 7 });
let terminal = releaseAllCardClaims(db, "card_z");
assert.equal(terminal.length, 2, "done/archived/canceled releases every workspace");
assert.equal(liveClaimsForWorkspace(db, { workspacePath: WS, nowMs: T0 + 8 }).filter((row) => row.card_id === "card_z").length, 0, "nothing survives a terminal release");

// The reconcile sweep reaps only expired claims and reports them for waiter notify.
releaseAllCardClaims(db, "card_a");
releaseAllCardClaims(db, "card_b");
const T1 = T0 + 10 * CLAIM_TTL_MS;
acquireWorkspaceClaims(db, { cardId: "card_old", workspacePath: WS, files: ["src/old.ts"], nowMs: T1 });
acquireWorkspaceClaims(db, { cardId: "card_new", workspacePath: WS, files: ["src/new.ts"], nowMs: T1 + CLAIM_TTL_MS + 5000 });
let swept = sweepExpiredClaims(db, T1 + CLAIM_TTL_MS + 6000);
assert.equal(swept.length, 1, "only the expired claim is reaped");
assert.equal(swept[0].file, "src/old.ts", "the sweep names the file for waiter notify");
assert.equal(swept[0].previousHolder, "card_old", "the sweep names the crashed holder");
assert.equal(liveClaimsForWorkspace(db, { workspacePath: WS, nowMs: T1 + CLAIM_TTL_MS + 6000 }).some((row) => row.file_path === "src/new.ts"), true, "live claims survive the sweep");

console.log("card-claims: ok");

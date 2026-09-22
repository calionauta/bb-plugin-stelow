import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  acquireWorkspaceClaims,
  addClaimWaiters,
  checkWorkspaceClaims,
  clearClaimWaiters,
  ensureCardClaimsTables,
  liveClaimsForWorkspace,
  matchScopeClaims,
  releaseAllCardClaims,
  releaseWorkspaceClaims,
  sweepExpiredClaims,
  waitersForFiles,
} from "../lib/card-claims.mjs";
import { isClaimTerminal } from "../lib/card-terminal.mjs";

// Full claim lifecycle at the lib level, mirroring exactly the calls
// server.ts makes. Each block names the server path it guards.

// --- Terminal release matrix (moveCard / cancelCard / deleteCard / done) ----
{
  const db = new Database(":memory:");
  ensureCardClaimsTables(db);
  const WS = "/repo/checkout";
  const T0 = 2_000_000;
  for (const status of ["completed", "archived", "blocked"]) {
    assert.equal(isClaimTerminal(status), true, `${status} is claim-terminal`);
    acquireWorkspaceClaims(db, { cardId: "holder", workspacePath: WS, files: ["src/a.ts"], nowMs: T0 });
    // Server terminal paths all funnel into releaseAllCardClaims(holder).
    const released = releaseAllCardClaims(db, "holder");
    assert.equal(released.length, 1, `${status}: terminal release drops the claim`);
    assert.equal(liveClaimsForWorkspace(db, { workspacePath: WS, nowMs: T0 }).length, 0, `${status}: nothing live remains`);
  }
  for (const status of ["draft", "pending", "in-progress"]) {
    assert.equal(isClaimTerminal(status), false, `${status} is not claim-terminal`);
  }
}

// --- Blocked → release → waiter resume (notifyClaimWaiters contract) ---------
{
  const db = new Database(":memory:");
  ensureCardClaimsTables(db);
  const WS = "/repo/checkout";
  const T0 = 3_000_000;
  const a = acquireWorkspaceClaims(db, { cardId: "card_a", workspacePath: WS, files: ["src/a.ts"], scope: "scope-1", nowMs: T0 });
  assert.equal(a.conflicts.length, 0, "first acquirer holds the file");
  const b = acquireWorkspaceClaims(db, { cardId: "card_b", workspacePath: WS, files: ["src/a.ts"], scope: "scope-9", nowMs: T0 });
  assert.equal(b.conflicts.length, 1, "sibling card hits a live foreign claim");
  assert.equal(b.conflicts[0].heldBy, "card_a", "the conflict names the holder");
  addClaimWaiters(db, { cardId: "card_b", workspacePath: WS, files: ["src/a.ts"], scope: "scope-9", nowMs: T0 });
  assert.equal(waitersForFiles(db, { workspacePath: WS, files: ["src/a.ts"] }).length, 1, "waiter is registered");
  // check() heartbeat must not clear someone else's hold.
  const seen = checkWorkspaceClaims(db, { cardId: "card_b", workspacePath: WS, files: ["src/a.ts"], nowMs: T0 });
  assert.equal(seen.conflicts.length, 1, "room check still sees the wall");
  // Holder releases (lock release / done / archive / sweep): the exact rows
  // notifyClaimWaiters needs to wake precisely the blocked cards.
  const released = releaseWorkspaceClaims(db, { cardId: "card_a", workspacePath: WS, files: ["src/a.ts"] });
  assert.deepEqual(released, [{ workspacePath: WS, file: "src/a.ts" }], "release names workspace + file for waiter lookup");
  const woken = waitersForFiles(db, { workspacePath: WS, files: released.map((row) => row.file) });
  assert.deepEqual(woken.map((row) => row.card_id), ["card_b"], "exactly the blocked card wakes");
  clearClaimWaiters(db, { cardId: "card_b", workspacePath: WS, files: ["src/a.ts"] });
  const retry = acquireWorkspaceClaims(db, { cardId: "card_b", workspacePath: WS, files: ["src/a.ts"], nowMs: T0 + 1 });
  assert.equal(retry.conflicts.length, 0, "waiter re-acquires after release");
}

// --- Ghost holders never block live cards (acquire-path reap) ---------------
{
  const db = new Database(":memory:");
  ensureCardClaimsTables(db);
  const WS = "/repo/checkout";
  const T0 = 4_000_000;
  acquireWorkspaceClaims(db, { cardId: "ghost", workspacePath: WS, files: ["src/g.ts"], nowMs: T0 });
  // Server deletes claims whose holder is archived/gone before re-acquiring;
  // a foreign card can never release another card's claim, so the host does
  // the delete directly (same statement shape as server.ts).
  const foreign = releaseWorkspaceClaims(db, { cardId: "live", workspacePath: WS, files: ["src/g.ts"] });
  assert.equal(foreign.length, 0, "a foreign card releases nothing");
  db.prepare("DELETE FROM card_claims WHERE workspace_path = ? AND file_path = ? AND card_id = ?").run(WS, "src/g.ts", "ghost");
  const retry = acquireWorkspaceClaims(db, { cardId: "live", workspacePath: WS, files: ["src/g.ts"], nowMs: T0 + 1 });
  assert.equal(retry.conflicts.length, 0, "ghost claim reaped, live card proceeds");
}

// --- Expired claims are swept and reported for waiter notify ----------------
{
  const db = new Database(":memory:");
  ensureCardClaimsTables(db);
  const WS = "/repo/checkout";
  const T0 = 5_000_000;
  acquireWorkspaceClaims(db, { cardId: "crashed", workspacePath: WS, files: ["src/old.ts"], ttlMs: 60_000, nowMs: T0 });
  acquireWorkspaceClaims(db, { cardId: "live", workspacePath: WS, files: ["src/new.ts"], nowMs: T0 + 61_000 });
  addClaimWaiters(db, { cardId: "waiter", workspacePath: WS, files: ["src/old.ts"], nowMs: T0 + 61_000 });
  const swept = sweepExpiredClaims(db, T0 + 61_000);
  assert.equal(swept.length, 1, "only the expired claim is reaped");
  assert.deepEqual(
    swept.map((row) => ({ workspacePath: row.workspacePath, file: row.file })),
    [{ workspacePath: WS, file: "src/old.ts" }],
    "the sweep names workspace + file for waiter notify",
  );
  assert.equal(
    waitersForFiles(db, { workspacePath: WS, files: ["src/old.ts"] }).length, 1,
    "waiters survive the sweep until the host notifies them",
  );
  assert.equal(liveClaimsForWorkspace(db, { workspacePath: WS, nowMs: T0 + 61_000 }).length, 1, "live claims survive");
}

// --- Scope matching: one rule for claimed projection and lapsed probe ----
{
  const db = new Database(":memory:");
  ensureCardClaimsTables(db);
  const WS = "/repo/match";
  const T0 = 5_000_000;
  acquireWorkspaceClaims(db, { cardId: "c1", workspacePath: WS, files: ["src/a.ts"], scope: "scope-1", nowMs: T0 });
  const live = liveClaimsForWorkspace(db, { workspacePath: WS, nowMs: T0 });
  assert.equal(matchScopeClaims(live, { ownerId: "c1", scopeId: "scope-1", files: [], nowMs: T0 }).length, 1, "scope tag matches");
  assert.equal(matchScopeClaims(live, { ownerId: "c1", scopeId: "scope-9", files: ["src/a.ts"], nowMs: T0 }).length, 1, "file overlap matches");
  assert.equal(matchScopeClaims(live, { ownerId: "c1", scopeId: "scope-9", files: ["src/z.ts"], nowMs: T0 }).length, 0, "unrelated misses");
  assert.equal(matchScopeClaims(live, { ownerId: "c2", scopeId: "scope-1", files: [], nowMs: T0 }).length, 0, "foreign cards miss");
  assert.equal(matchScopeClaims(live, { ownerId: "c1", scopeId: "scope-1", files: [], nowMs: T0 + 1_900_000 }).length, 0, "expired leases miss");
  assert.deepEqual(matchScopeClaims(null, { ownerId: "c1", scopeId: "scope-1" }), [], "junk rows miss");
}

console.log("claims-lifecycle: ok");

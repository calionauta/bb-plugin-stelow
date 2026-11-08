import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  CLAIM_TTL_MS,
  ensureCardClaimsTables,
  liveClaimsForWorkspace,
  normalizeClaimPath,
  uniqueFiles,
} from "../lib/card-claims.mjs";
import { acquireScopeClaims } from "../lib/scope-claims.mjs";
import { lockBlockDedupeKey, lockBlockSummary } from "../lib/lock-blocked.mjs";
import {
  acquireScopeMergeLock,
  isScopeMergeLocked,
} from "../lib/scope-merge.mjs";

// Lock-protocol contract: the exact surface the worker, the user, and the
// waiter-resume path all depend on. TTL is one value everywhere (1800s, per
// file-locking.md); the blocked copy derives from the record so the sentence
// and the holder id cannot disagree.
assert.equal(CLAIM_TTL_MS, 30 * 60 * 1000, "registry TTL is 30 minutes");

assert.equal(normalizeClaimPath("docs/brief.md"), "docs/brief.md", "a workspace-relative path passes");
assert.equal(normalizeClaimPath("/tmp/brief.md"), "tmp/brief.md", "a leading slash is stripped to workspace-relative");
assert.equal(normalizeClaimPath("../brief.md"), null, "traversal above the root refuses");
assert.equal(normalizeClaimPath(null), null, "junk refuses");
assert.deepEqual(uniqueFiles(["a.md", "a.md", "b.md"]), ["a.md", "b.md"], "duplicate claims dedupe");

assert.equal(
  lockBlockDedupeKey({ cardId: "c1", file: "docs/brief.md" }),
  "lock-blocked:c1:docs/brief.md",
  "the dedupe key is per card per file",
);
assert.match(
  lockBlockSummary({ file: "docs/brief.md", holderName: "Checkout", expiresAt: Date.now() + 1000 }),
  /no action needed/i,
  "the copy promises automatic resume, because it is automatic",
);

// --- The merge lock's one failure model, pinned -----------------------------
// `lib/scope-merge.mjs` states a model that differs from the claims registry on
// purpose, because the two answer different questions: the registry says which
// card may write which file (persisted, keyed by workspace+file, leased so a
// crashed holder's files free up); this lock says one batch's parent merge does
// not interleave with itself, inside one process. Each consequence below is
// asserted so the model cannot drift into something the docstring does not say.
// Unifying the two means changing this block and that docstring in one commit —
// which is the point: the divergence is a decision, not an accident.

// 1. Process-local and not durable. A second instance of the module — another
// process, a hot-reload, a second daemon — neither sees this lock nor is
// refused by it. No part of the batch lifecycle may assume otherwise.
{
  const batch = "batch-process-local";
  const held = acquireScopeMergeLock(batch);
  assert.ok(held, "this instance takes the lock");
  const secondInstance = await import("../lib/scope-merge.mjs?second-process");
  const outsider = secondInstance.acquireScopeMergeLock(batch);
  assert.ok(outsider, "a second module instance is not refused: cross-process exclusion is not promised");
  outsider.release();
  assert.equal(isScopeMergeLocked(batch), true, "and the first instance still holds its own");
  held.release();
  assert.equal(isScopeMergeLocked(batch), false, "releasing frees it for the next attempt");
}

// 2. It never expires. A lock nobody released wedges its batch until the
// process ends, which is the cost of having no clock: every acquisition must
// release in a `finally`, and nothing may park work behind it waiting for a
// lease to lapse the way it may behind a file claim.
{
  const batch = "batch-no-expiry";
  const held = acquireScopeMergeLock(batch);
  assert.ok(held, "first acquisition holds");
  assert.equal(acquireScopeMergeLock(batch), null, "a second attempt is refused while the first is unreleased");
  held.release();
  assert.ok(acquireScopeMergeLock(batch), "and admitted again only because someone released it");
}

// 3. It grants no file exclusivity and writes no claim row. Holding the merge
// lock for a batch must not stop another card from claiming a file, and must
// not appear as a claim the user never made: the registry stays the only
// arbiter of files, and the card's own room never shows a phantom holder.
{
  const db = new Database(":memory:");
  ensureCardClaimsTables(db);
  const lock = acquireScopeMergeLock("batch-files");
  const claim = acquireScopeClaims(db, {
    cardId: "card-other",
    batchId: "batch-files",
    scopeId: "scope-x",
    files: ["src/x.ts"],
    effectiveCheckout: "/repo",
    nowMs: 1_000,
  });
  const live = liveClaimsForWorkspace(db, { workspacePath: "/repo", nowMs: 1_000 });
  lock.release();
  assert.equal(claim.ok, true, "the merge lock does not refuse a file claim");
  assert.deepEqual(
    live.map((row) => row.file_path),
    ["src/x.ts"],
    "and the lock itself is not in the registry: one row, the claim that was actually asked for",
  );
}

console.log("lock-protocol-contract: ok");

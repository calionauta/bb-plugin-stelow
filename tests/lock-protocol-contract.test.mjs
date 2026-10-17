import assert from "node:assert/strict";
import {
  CLAIM_TTL_MS,
  normalizeClaimPath,
  uniqueFiles,
} from "../lib/card-claims.mjs";
import { lockBlockDedupeKey, lockBlockSummary } from "../lib/lock-blocked.mjs";

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

console.log("lock-protocol-contract: ok");

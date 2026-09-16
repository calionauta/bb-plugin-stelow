import assert from "node:assert/strict";
import { anyStale, stalenessOf } from "../lib/question-staleness.mjs";

// No baseline (pre-ledger questions, label-only options): silence, never a
// verdict. Staleness must prove itself from a snapshot.
assert.equal(stalenessOf(null, { sha256: "abc", headSha: "h2" }), null, "no snapshot means no verdict");
assert.equal(stalenessOf(undefined, { sha256: "abc", headSha: "h2" }), null, "undefined snapshot means no verdict");
assert.equal(stalenessOf({ artifactSha256: "", gitRoot: null, headSha: null }, { sha256: "abc", headSha: null }), null, "an empty baseline hash means no verdict");

// Fresh: same document, same HEAD (or no Git on either side).
assert.equal(
  stalenessOf({ artifactSha256: "abc", gitRoot: "/repo", headSha: "h1" }, { sha256: "abc", headSha: "h1" }),
  null,
  "unchanged document at the same HEAD is fresh",
);
assert.equal(
  stalenessOf({ artifactSha256: "abc", gitRoot: null, headSha: null }, { sha256: "abc", headSha: null }),
  null,
  "non-Git checkouts compare the document only",
);

// The document was revised after the ask — even when the checkout did not move.
assert.deepEqual(
  stalenessOf({ artifactSha256: "abc", gitRoot: "/repo", headSha: "h1" }, { sha256: "def", headSha: "h1" }),
  { docRevised: true, docRemoved: false, checkoutMoved: false },
  "a revised document flags on its own",
);

// The document can no longer be read at its recorded path.
assert.deepEqual(
  stalenessOf({ artifactSha256: "abc", gitRoot: "/repo", headSha: "h1" }, { sha256: null, headSha: "h1" }),
  { docRevised: false, docRemoved: true, checkoutMoved: false },
  "an unreadable document reads as removed, not revised",
);
assert.deepEqual(
  stalenessOf({ artifactSha256: "abc", gitRoot: null, headSha: null }, null),
  { docRevised: false, docRemoved: true, checkoutMoved: false },
  "a failed observation reads as removed",
);

// The checkout moved under a byte-identical document: still worth naming,
// since the plan may assume code that changed.
assert.deepEqual(
  stalenessOf({ artifactSha256: "abc", gitRoot: "/repo", headSha: "h1" }, { sha256: "abc", headSha: "h2" }),
  { docRevised: false, docRemoved: false, checkoutMoved: true },
  "a moved HEAD flags even when the document is untouched",
);

// Both at once stay one verdict with both flags.
assert.deepEqual(
  stalenessOf({ artifactSha256: "abc", gitRoot: "/repo", headSha: "h1" }, { sha256: "def", headSha: "h2" }),
  { docRevised: true, docRemoved: false, checkoutMoved: true },
  "revision plus move combine without a second verdict",
);

// A one-sided Git identity cannot prove movement: no false positives from
// non-Git checkouts, shallow clones, or unreadable HEADs.
assert.equal(
  stalenessOf({ artifactSha256: "abc", gitRoot: null, headSha: null }, { sha256: "abc", headSha: "h2" }),
  null,
  "no baseline HEAD means no movement verdict",
);
assert.equal(
  stalenessOf({ artifactSha256: "abc", gitRoot: "/repo", headSha: "h1" }, { sha256: "abc", headSha: null }),
  null,
  "an unreadable current HEAD means no movement verdict",
);

assert.equal(anyStale([null, null]), false, "all fresh means no notice");
assert.equal(
  anyStale([null, { docRevised: true, docRemoved: false, checkoutMoved: false }]),
  true,
  "one stale verdict raises the notice",
);
assert.equal(anyStale([]), false, "no questions means no notice");
assert.equal(anyStale(null), false, "non-arrays never raise");

console.log("question staleness test ok: baselines, revisions, removals, moves");

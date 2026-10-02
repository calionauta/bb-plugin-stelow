import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { reviewExcerptRecords, reviewCoversFingerprint } from "../lib/review-verdict.mjs";
import { summarizeExcerpts } from "../lib/review-truncation.mjs";

// The counter (tests/review-truncation.test.mjs) is only honest if the records
// it reads were actually written. A writer and a reader that disagree in
// either direction produce a metric that is confidently wrong: an unparsed line
// reports zero truncations, and a mistruncated flag reports whole documents as
// cut. So this file pins the SHAPE, the way the record is written, and the
// round trip — the writer's exact line format against the reader's exact regex.

// The line `cli-review-verdict.ts` writes, in all three modes. If this format
// changes, this file must change with it — that coupling is the point.
const written = {
  whole: "Excerpt: whole, 800 of 800 chars, whole",
  contract: "Excerpt: contract, 11000 of 40000 chars, truncated",
  head: "Excerpt: head, 12000 of 60000 chars, truncated",
};

const document = (excerptLine) => [
  "# Review 2026-10-02T01:00",
  "Card: Example",
  "Reviewer thread: thr_1",
  "Preset: Reviewer",
  "Status: pass",
  "Fingerprint: abc123",
  excerptLine,
  "",
  "Review verdict: pass — 0 finding(s), 0 failing.",
  "",
  "## Verdict",
  "",
  "```json",
  "{ \"status\": \"pass\", \"findings\": [] }",
  "```",
].join("\n");

// --- Round trip: every mode survives write -> read -> count. ----------------
const files = [
  { name: "review-1.md", content: document(written.whole) },
  { name: "review-2.md", content: document(written.contract) },
  { name: "review-3.md", content: document(written.head) },
];
const counted = summarizeExcerpts(reviewExcerptRecords(files));
assert.equal(counted.counted, 3, "every written record is read back");
assert.equal(counted.truncated, 2, "the two cut records are counted as cuts");
assert.equal(counted.headCuts, 1, "and the opening cut is distinguished from the contract cut");
assert.deepEqual(counted.byMode, { whole: 1, contract: 1, head: 1 });

// The numbers must survive exactly, not merely survive: a reader that swapped
// sent/original would report a 3-5x miscount with the right shape.
const [first, second, third] = reviewExcerptRecords(files);
assert.equal(first.excerpt.originalChars, 800);
assert.equal(second.excerpt.sentChars, 11000);
assert.equal(second.excerpt.originalChars, 40000);
assert.equal(third.excerpt.originalChars, 60000);

// --- A record predating the field is skipped, never zero-filled. -------------
// Zero-filling would report every legacy review as one that read its whole
// document — an invented fact about work nobody measured.
const legacy = reviewExcerptRecords([
  { name: "review-old.md", content: document("") },
  { name: "review-unknown.md", content: document("Excerpt: unknown") },
  { name: "review-garbage.md", content: document("Excerpt: contract, many of some chars, maybe") },
  { name: "review-empty.md", content: "" },
  { name: "review-null.md", content: null },
]);
assert.deepEqual(legacy, [], "an absent or unreadable Excerpt line yields no record at all");

// The gate's own reader must be untouched by a record gaining a header line.
assert.equal(reviewCoversFingerprint(files, "abc123"), true, "a passing review still satisfies the gate");
assert.equal(reviewCoversFingerprint(files, "different"), false, "a mismatched fingerprint still does not");

// --- The WRITER, pinned. ----------------------------------------------------
// Everything above hand-writes the document, so it would stay green with the
// writer deleted — the reader and the counter would both be perfect and the
// metric would report zero truncations forever, which is exactly the bug this
// closes. The line's format is a contract between two modules in different
// directories, so it is pinned where the two meet.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const verdictWriter = readFileSync(join(root, "server/runtime/cli/cli-review-verdict.ts"), "utf8");
const reviewCaller = readFileSync(join(root, "server/runtime/cli/cli-review.ts"), "utf8");

assert.match(
  verdictWriter,
  /Excerpt: \$\{excerpt\.selected\}, \$\{excerpt\.sentChars\} of \$\{excerpt\.originalChars\} chars, \$\{excerpt\.truncated \? "truncated" : "whole"\}/,
  "the review record writes the Excerpt header the metric parses, in the exact shape the reader expects",
);
assert.match(verdictWriter, /: "Excerpt: unknown"/, "a review with no excerpt says so rather than implying it saw everything");
assert.match(
  reviewCaller,
  /recordVerdict\(deps, card, spawned\.threadId, reviewPresetRow\.name, subject, polled\.output, permissionNote, excerpt\)/,
  "the excerpt the prompt already computed is handed to the recorder, or the record is written without it",
);

console.log("review excerpt record ok: what the review writes is what the metric counts");

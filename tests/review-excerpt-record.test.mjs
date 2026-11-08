import assert from "node:assert/strict";
import { reviewExcerptRecords, reviewCoversFingerprint } from "../lib/review-verdict.mjs";
import { summarizeExcerpts } from "../lib/review-truncation.mjs";
import { recordVerdict } from "../server/runtime/cli/cli-review-verdict.ts";

// The counter (tests/review-truncation.test.mjs) is only honest if the records
// it reads were actually written. A writer and a reader that disagree in
// either direction produce a metric that is confidently wrong: an unparsed line
// reports zero truncations, and a mistruncated flag reports whole documents as
// cut. So this file DRIVES the writer — `recordVerdict` — and reads its output
// back with the reader's own regex, proving the round trip rather than pinning
// the line format as a string.

/** Record one review through the real writer and hand back the durable file it
 * wrote. The excerpt is the only input that varies; the rest is a passing
 * review with no findings, so the shape under test is the Excerpt header. */
async function written(excerpt) {
  let content = null;
  const card = { id: "card_1", name: "Example", display_name: null, dir_hash: "h", project_id: "p1" };
  const deps = {
    cardWorkspace: async () => ({ path: "/repo" }),
    workflowStateDir: async () => "/repo/.stelow/card_1",
    bb: {
      sdk: {
        files: {
          mkdir: async () => undefined,
          write: async ({ content: next }) => { content = next; },
        },
      },
    },
    logCardComment: () => "c",
  };
  await recordVerdict(
    deps,
    card,
    "thr_1",
    "Reviewer",
    { artifactText: "", contractLabel: "contract", evidence: "verified", fingerprint: "abc123", contract: null },
    "```json\n{ \"verdict\": \"pass\", \"findings\": [] }\n```",
    "",
    excerpt,
  );
  assert.ok(content, "the writer must have written the review document");
  return content;
}

// --- Round trip: every mode survives write -> read -> count. ----------------
const files = [
  { name: "review-1.md", content: await written({ selected: "whole", sentChars: 800, originalChars: 800, truncated: false }) },
  { name: "review-2.md", content: await written({ selected: "contract", sentChars: 11000, originalChars: 40000, truncated: true }) },
  { name: "review-3.md", content: await written({ selected: "head", sentChars: 12000, originalChars: 60000, truncated: true }) },
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

// --- A record the writer made without an excerpt is skipped, never zero-filled.
// Zero-filling would report every legacy review as one that read its whole
// document — an invented fact about work nobody measured. Driving the writer's
// null branch proves the "unknowable" line is what the reader refuses.
{
  const unknown = await written(null);
  assert.match(unknown, /^Excerpt: unknown$/m, "the writer says unknown rather than implying it saw everything");
  const legacy = reviewExcerptRecords([
    { name: "review-unknown.md", content: unknown },
    { name: "review-garbage.md", content: "Excerpt: contract, many of some chars, maybe" },
    { name: "review-empty.md", content: "" },
    { name: "review-null.md", content: null },
  ]);
  assert.deepEqual(legacy, [], "an absent or unreadable Excerpt line yields no record at all");
}

// The gate's own reader must be untouched by a record gaining a header line.
assert.equal(reviewCoversFingerprint(files, "abc123"), true, "a passing review still satisfies the gate");
assert.equal(reviewCoversFingerprint(files, "different"), false, "a mismatched fingerprint still does not");

console.log("review excerpt record ok: what the review writes is what the metric counts");

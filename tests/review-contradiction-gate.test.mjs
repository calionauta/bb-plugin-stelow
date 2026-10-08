import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseReviewOutput, reviewCoversFingerprint } from "../lib/review-verdict.mjs";

// Chain test: reviewer output → verdict → record → done-gate coverage.
// A contradictory pass must travel the whole chain as a non-covering
// human-review; a clean pass must still cover. The record format is pinned
// where writer and reader meet, so this cannot go green with the writer
// deleted (see review-excerpt-record.test.mjs for the precedent).
const ARTIFACT = "## Outcome\n- The scope ships one slice\n";
const CONTRADICTORY = '```json\n{"verdict": "pass", "findings": ['
  + '{"criterion": "scope fits", "quote": "- The scope ships one slice",'
  + ' "verdict": "FAIL", "repair": "narrow scope"}]}\n```';
const CLEAN = '```json\n{"verdict": "pass", "findings": ['
  + '{"criterion": "scope fits", "quote": "- The scope ships one slice",'
  + ' "verdict": "PASS", "repair": "none"}]}\n```';

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const writer = readFileSync(
  join(root, "server/runtime/cli/cli-review-verdict.ts"),
  "utf8",
);
assert.match(writer, /Status: \$\{status\}/, "record status is the parsed status, verbatim");
assert.match(
  writer,
  /status: verdict\.parsed\.status, findings: verdict\.parsed\.findings/,
  "record persists the parsed verdict, findings included",
);

// The record status line, rendered the way the writer renders it.
function recordFor(parsed, fingerprint) {
  return [
    "Card: Example",
    `Status: ${parsed.status}`,
    `Fingerprint: ${fingerprint}`,
    "",
    JSON.stringify({ status: parsed.status, findings: parsed.findings }),
  ].join("\n");
}

const thrown = parseReviewOutput(CONTRADICTORY, ARTIFACT);
const thrownFiles = [{ name: "review-a.md", content: recordFor(thrown, "fp-1") }];
assert.equal(thrown.status, "human-review", "contradictory output parses as human-review");
assert.equal(reviewCoversFingerprint(thrownFiles, "fp-1"), false, "thrown-out approval never covers");

const clean = parseReviewOutput(CLEAN, ARTIFACT);
const cleanFiles = [{ name: "review-b.md", content: recordFor(clean, "fp-1") }];
assert.equal(clean.status, "pass", "clean pass parses as pass");
assert.equal(reviewCoversFingerprint(cleanFiles, "fp-1"), true, "clean pass still covers its fingerprint");
assert.equal(reviewCoversFingerprint(cleanFiles, "fp-2"), false, "stale fingerprint stays uncovered");

console.log("review contradiction gate ok: verdict travels verdict to record to gate");
